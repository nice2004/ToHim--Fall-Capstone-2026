/**
 * Prayer reminders on the device: local notifications, occurrence math for the Calendar,
 * an offline copy of the list, and "Add to Google Calendar" links.
 *
 * Reminders are stored on the server with a wall-clock date ("YYYY-MM-DD") and time ("HH:MM")
 * in the user's own timezone. Notifications are scheduled locally from that list, so every
 * device the user signs in on gets them after refreshReminders() runs.
 */
import { Platform, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { reminderAPI } from './api';
import { getSyncState, setSyncState } from './localDb';

export const REPEAT_LABELS = { once: 'Once', daily: 'Daily', weekly: 'Weekly' };

const CHANNEL_ID = 'prayer-reminders';
const NOTIFICATION_SOURCE = 'tohim-reminder';
const CACHE_KEY = 'reminders_cache';
// For a repeating reminder that hasn't started yet we schedule its first few dates one by one
// (native repeating triggers can't take a start date). The next refresh after the start date
// switches it to a true repeating notification.
const FUTURE_START_OCCURRENCES = 14;

// ----- Date helpers (all local time) -----

export const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const toTimeKey = (hour, minute) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const parseDateKey = (key) => {
  const [y, m, d] = String(key).split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
};

const parseTimeKey = (key) => {
  const [hour, minute] = String(key || '08:00').split(':').map(Number);
  return { hour: hour || 0, minute: minute || 0 };
};

/** The Date of a reminder's first (start) occurrence, in local time. */
export const reminderStart = (reminder) => {
  const date = parseDateKey(reminder.remind_date);
  const { hour, minute } = parseTimeKey(reminder.remind_time);
  date.setHours(hour, minute, 0, 0);
  return date;
};

/** Whether the reminder fires on the given local calendar day (YYYY-MM-DD). */
export const occursOn = (reminder, dateKey) => {
  const start = String(reminder.remind_date).split('T')[0];
  if (reminder.repeat === 'once') return dateKey === start;
  if (dateKey < start) return false;
  if (reminder.repeat === 'daily') return true;
  return parseDateKey(dateKey).getDay() === parseDateKey(start).getDay();
};

/** Next time this reminder fires at or after `from`, or null if it's a past one-time reminder. */
export const nextOccurrence = (reminder, from = new Date()) => {
  const start = reminderStart(reminder);
  if (start >= from) return start;
  if (reminder.repeat === 'once') return null;
  const step = reminder.repeat === 'daily' ? 1 : 7;
  const next = new Date(from);
  next.setHours(start.getHours(), start.getMinutes(), 0, 0);
  if (reminder.repeat === 'weekly') {
    next.setDate(next.getDate() + ((start.getDay() - next.getDay() + 7) % 7));
  }
  while (next < from) next.setDate(next.getDate() + step);
  return next;
};

export const formatReminderTime = (reminder) =>
  reminderStart(reminder).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

/** e.g. "Fridays at 8:00 AM", "Every day at 7:00 AM", "Fri, Oct 16 at 8:00 AM" */
export const describeSchedule = (reminder) => {
  const start = reminderStart(reminder);
  const time = formatReminderTime(reminder);
  if (reminder.repeat === 'daily') return `Every day at ${time}`;
  if (reminder.repeat === 'weekly') {
    return `${start.toLocaleDateString('en-US', { weekday: 'long' })}s at ${time}`;
  }
  return `${start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
};

// ----- Server list + offline copy -----

async function cacheReminders(reminders) {
  try {
    await setSyncState(CACHE_KEY, JSON.stringify(reminders || []));
  } catch (err) {
    console.warn('[Reminders] Could not cache reminders:', err?.message || err);
  }
}

export async function getCachedReminders() {
  try {
    const raw = await getSyncState(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Fetch reminders from the server, cache them, and reschedule this device's notifications.
 * Falls back to the cached list when offline. Never prompts for notification permission.
 */
export async function refreshReminders() {
  let reminders;
  let offline = false;
  try {
    const data = await reminderAPI.getAll();
    reminders = data.reminders || [];
    await cacheReminders(reminders);
  } catch (err) {
    offline = true;
    reminders = await getCachedReminders();
  }
  try {
    await syncReminderNotifications(reminders);
  } catch (err) {
    console.warn('[Reminders] Could not schedule notifications:', err?.message || err);
  }
  return { reminders, offline };
}

// ----- Local notifications -----

let handlerInstalled = false;

/** Show reminder notifications even while the app is open. Safe to call more than once. */
export function initReminderNotifications() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Prayer reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch((err) => console.warn('[Reminders] Channel setup failed:', err?.message || err));
  }
}

/** Ask for permission (only call from a user action, e.g. saving a reminder). */
export async function ensureNotificationPermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain === false) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return !!requested.granted;
}

const reminderContent = (reminder) => ({
  title: 'Time to pray',
  body: reminder.title,
  data: { source: NOTIFICATION_SOURCE, reminderId: reminder.id },
});

async function scheduleReminder(reminder, now) {
  const start = reminderStart(reminder);
  const { hour, minute } = parseTimeKey(reminder.remind_time);
  const content = reminderContent(reminder);
  const schedule = (trigger) =>
    Notifications.scheduleNotificationAsync({ content, trigger: { ...trigger, channelId: CHANNEL_ID } });

  if (reminder.repeat === 'once') {
    if (start > now) await schedule({ type: Notifications.SchedulableTriggerInputTypes.DATE, date: start });
    return;
  }

  if (start <= now) {
    if (reminder.repeat === 'daily') {
      await schedule({ type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute });
    } else {
      // expo weekday: 1 = Sunday ... 7 = Saturday
      await schedule({
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: start.getDay() + 1,
        hour,
        minute,
      });
    }
    return;
  }

  const step = reminder.repeat === 'daily' ? 1 : 7;
  for (let i = 0; i < FUTURE_START_OCCURRENCES; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i * step);
    await schedule({ type: Notifications.SchedulableTriggerInputTypes.DATE, date });
  }
}

/** Replace this device's scheduled reminder notifications with ones built from `reminders`. */
export async function syncReminderNotifications(reminders) {
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n?.content?.data?.source === NOTIFICATION_SOURCE)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );

  const now = new Date();
  for (const reminder of reminders || []) {
    if (reminder.notify === false) continue; // "Notify me" turned off: calendar only
    await scheduleReminder(reminder, now);
  }
}

/** On logout: stop this device's reminders and forget the cached list. */
export async function clearReminderNotifications() {
  await cacheReminders([]);
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n?.content?.data?.source === NOTIFICATION_SOURCE)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

// ----- Google Calendar -----

const toGoogleStamp = (date) =>
  `${toDateKey(date).replace(/-/g, '')}T${toTimeKey(date.getHours(), date.getMinutes()).replace(':', '')}00`;

/**
 * A Google Calendar "create event" link pre-filled with this reminder (and its repeat rule).
 * The user reviews and saves it in Google Calendar; nothing is sent until they do.
 */
export function buildGoogleCalendarUrl(reminder) {
  const start = reminderStart(reminder);
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const params = [
    ['action', 'TEMPLATE'],
    ['text', reminder.title],
    ['dates', `${toGoogleStamp(start)}/${toGoogleStamp(end)}`],
    ['details', reminder.person_name ? `Prayer reminder for ${reminder.person_name} from ToHim` : 'Prayer reminder from ToHim'],
  ];
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timeZone) params.push(['ctz', timeZone]);
  if (reminder.repeat === 'daily') params.push(['recur', 'RRULE:FREQ=DAILY']);
  if (reminder.repeat === 'weekly') params.push(['recur', 'RRULE:FREQ=WEEKLY']);
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://calendar.google.com/calendar/render?${query}`;
}

export async function addReminderToGoogleCalendar(reminder) {
  await Linking.openURL(buildGoogleCalendarUrl(reminder));
}
