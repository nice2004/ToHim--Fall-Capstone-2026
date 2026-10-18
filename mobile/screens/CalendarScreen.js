import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  SafeAreaView,
  Modal,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { calendarAPI, personAPI } from '../services/api';
import { cacheCalendarEvents, getCachedCalendarEvents } from '../services/localDb';
import { getLastSyncAt } from '../services/syncService';
import { RADIUS } from '../theme';
import { useTheme } from '../context/ThemeContext';
import GlassSurface from '../components/GlassSurface';
import ReminderEditor from '../components/ReminderEditor';
import {
  refreshReminders,
  occursOn,
  nextOccurrence,
  describeSchedule,
  formatReminderTime,
  addReminderToGoogleCalendar,
} from '../services/reminders';

const REMINDER_COLOR = '#AF52DE';

// How far ahead the "Upcoming" list under the month grid looks, and how many items it shows.
const UPCOMING_WINDOW_DAYS = 60;
const UPCOMING_LIMIT = 8;

// The calendar shows when a prayer request is happening ("presentation on Monday"), which the
// server stores as 'referenced' events. 'session' events only mark the day a request was
// recorded, so they're left off the grid and the Upcoming list.
const isHappeningDate = (event) => event.event_type !== 'session';

// Format a Date as YYYY-MM-DD in local timezone (not UTC)
const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function CalendarScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedDateEvents, setSelectedDateEvents] = useState([]);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [offlineNotice, setOfflineNotice] = useState(null);
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [editEventDate, setEditEventDate] = useState('');
  const [editEventSummary, setEditEventSummary] = useState('');
  const [isSavingEventEdit, setIsSavingEventEdit] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editYear, setEditYear] = useState(new Date().getFullYear());
  const [editMonth, setEditMonth] = useState(new Date().getMonth() + 1);
  const [editDay, setEditDay] = useState(new Date().getDate());
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [isOpeningRequest, setIsOpeningRequest] = useState(false);
  const [reminders, setReminders] = useState([]);
  // { reminder } to edit, or { defaults } to create; null when the editor is closed
  const [reminderEditor, setReminderEditor] = useState(null);

  const loadEvents = useCallback(async () => {
    // Declared outside try so the offline fallback in catch can reuse the same range.
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const startDate = toDateKey(new Date(year, month, 1));
    const endDate = toDateKey(new Date(year, month + 1, 0));

    try {
      setIsLoading(true);
      const response = await calendarAPI.getEvents(startDate, endDate);
      const eventList = response.events || [];
      setEvents(eventList.filter(isHappeningDate));
      await cacheCalendarEvents(eventList);
      setOfflineNotice(null);
    } catch (error) {
      console.error('[CalendarScreen] Error loading events:', error);
      const cached = await getCachedCalendarEvents(startDate, endDate);
      setEvents(cached.filter(isHappeningDate));
      const lastSyncAt = await getLastSyncAt();
      if (cached.length > 0) {
        setOfflineNotice(
          lastSyncAt
            ? `Offline data shown (last synced ${new Date(lastSyncAt).toLocaleString()})`
            : 'Offline data shown'
        );
      } else {
        Alert.alert('Error', 'Failed to load calendar events');
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentDate]);

  // Dates coming up from today, independent of which month is on screen.
  const loadUpcoming = useCallback(async () => {
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + UPCOMING_WINDOW_DAYS);
    const startDate = toDateKey(start);
    const endDate = toDateKey(end);
    let list;
    try {
      const response = await calendarAPI.getEvents(startDate, endDate);
      list = response.events || [];
      await cacheCalendarEvents(list);
    } catch (error) {
      console.warn('[CalendarScreen] Upcoming events unavailable, using cache:', error?.message || error);
      try {
        list = await getCachedCalendarEvents(startDate, endDate);
      } catch {
        list = [];
      }
    }
    const sorted = list.filter(isHappeningDate).sort((a, b) =>
      String(a.event_date).split('T')[0].localeCompare(String(b.event_date).split('T')[0])
    );
    setUpcomingEvents(sorted.slice(0, UPCOMING_LIMIT));
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const loadReminders = useCallback(async () => {
    const { reminders: list } = await refreshReminders();
    setReminders(list);
  }, []);

  useEffect(() => {
    loadUpcoming();
    loadReminders();
  }, [loadUpcoming, loadReminders]);

  // Refetch events when the Calendar tab gains focus so the just-recorded session
  // (and its dates) show up immediately instead of only after changing month.
  useEffect(() => {
    if (!navigation) return undefined;
    const unsubscribe = navigation.addListener('focus', () => {
      loadEvents();
      loadUpcoming();
      loadReminders();
    });
    return unsubscribe;
  }, [navigation, loadEvents, loadUpcoming, loadReminders]);

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }
    return days;
  };

  // Helper to format date as YYYY-MM-DD in local timezone (not UTC)
  const formatDateString = (date) => {
    if (typeof date === 'string') {
      return date.split('T')[0];
    }
    if (date instanceof Date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    // If it's a day number, use currentDate's year and month
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(date).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getEventsForDate = (date) => {
    const dateStr = formatDateString(date);

    // Reminders are shown as calendar items on every day they fire.
    const reminderItems = reminders
      .filter((reminder) => occursOn(reminder, dateStr))
      .map((reminder) => ({
        id: `reminder-${reminder.id}-${dateStr}`,
        event_type: 'reminder',
        event_date: dateStr,
        person_id: reminder.person_id,
        session_id: reminder.session_id,
        person_name: reminder.person_name,
        summary: reminder.title,
        reminder,
      }));

    return events.filter(event => {
      // Extract date part from event_date (which is stored as YYYY-MM-DD)
      const eventDate = event.event_date.split('T')[0];
      return eventDate === dateStr;
    }).concat(reminderItems).sort((a, b) => {
      // Sort by time for session events, then by type
      if (a.session_created_at && b.session_created_at) {
        return new Date(a.session_created_at) - new Date(b.session_created_at);
      }
      return a.event_type.localeCompare(b.event_type);
    });
  };

  const handleDatePress = (date) => {
    const dateEvents = getEventsForDate(date);
    if (dateEvents.length > 0) {
      setSelectedDate(date);
      setSelectedDateEvents(dateEvents);
      setCurrentEventIndex(0);
    }
  };

  const navigateMonth = (direction) => {
    // Pin to the 1st so e.g. Jan 31 + 1 month doesn't skip February.
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1));
  };

  // Parse a date-only string (YYYY-MM-DD) as LOCAL midnight so it lands on the right calendar day.
  // new Date("YYYY-MM-DD") would be UTC midnight → previous day in UTC- timezones.
  const parseDateLocal = (dateStr) => {
    if (!dateStr) return new Date();
    const bare = String(dateStr).split('T')[0];
    return new Date(`${bare}T00:00:00`); // local midnight
  };

  // Parse a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") correctly as UTC.
  // Without explicit 'Z', JS/Hermes parses the space-separated format as LOCAL time,
  // displaying the raw UTC digits — wrong for any device not in UTC.
  const parseUtcTimestamp = (str) => {
    if (!str) return new Date();
    const s = String(str).trim();
    if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
    return new Date(s.replace(' ', 'T') + 'Z');
  };

  const formatDate = (dateStr) => {
    const date = parseDateLocal(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (dateStr) => {
    // session_created_at is a SQLite UTC timestamp — parse as UTC then display in local time
    const date = parseUtcTimestamp(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const getEventColor = (eventType) => {
    if (eventType === 'reminder') return REMINDER_COLOR;
    return eventType === 'session' ? colors.primary : '#22C55E';
  };

  // Reminders are titled by what they're for ("Morning prayer"); events by the person.
  const getItemTitle = (event) =>
    event.event_type === 'reminder' ? event.summary : event.person_name || 'Unknown';

  const openNewReminder = (defaults = {}) => setReminderEditor({ defaults });
  const openEditReminder = (reminder) => setReminderEditor({ reminder });

  // "Remind me to pray" for the person/request behind a calendar event.
  const remindForEvent = (event) => {
    setReminderEditor({
      defaults: {
        personId: event.person_id,
        sessionId: event.session_id,
        personName: event.person_name,
        title: event.person_name ? `Pray for ${event.person_name}` : undefined,
        date: String(event.event_date).split('T')[0],
      },
    });
  };

  const navigateEvent = (direction) => {
    if (selectedDateEvents.length === 0) return;
    const newIndex = currentEventIndex + direction;
    if (newIndex >= 0 && newIndex < selectedDateEvents.length) {
      setCurrentEventIndex(newIndex);
    }
  };

  const renderMonthView = () => {
    const days = getDaysInMonth(currentDate);
    const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const today = new Date();

    return (
      <ScrollView style={styles.calendarContainer} contentContainerStyle={styles.calendarContent}>
        <Text style={styles.screenTitle} accessibilityRole="header">
          Calendar
        </Text>
        {offlineNotice && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#665200" />
            <Text style={styles.offlineBannerText}>{offlineNotice}</Text>
          </View>
        )}

        <GlassSurface style={styles.monthCard}>
          <View style={styles.monthHeader}>
            <TouchableOpacity
              onPress={() => navigateMonth(-1)}
              style={styles.navButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
            >
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
            </TouchableOpacity>
            <Text style={styles.monthTitle}>{monthName}</Text>
            <TouchableOpacity
              onPress={() => navigateMonth(1)}
              style={styles.navButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Next month"
            >
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekDaysContainer}>
            {weekDays.map((day, i) => (
              <View key={`${day}-${i}`} style={styles.weekDay}>
                <Text style={styles.weekDayText}>{day}</Text>
              </View>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {days.map((day, index) => {
              const dateEvents = day ? getEventsForDate(day) : [];
              const isToday =
                !!day &&
                today.getDate() === day &&
                today.getMonth() === currentDate.getMonth() &&
                today.getFullYear() === currentDate.getFullYear();
              // One dot per kind of item that day (request date, mentioned date, reminder).
              const dotTypes = [...new Set(dateEvents.map((e) => e.event_type))];

              return (
                <Pressable
                  key={index}
                  disabled={!day}
                  android_ripple={
                    isDark ? { color: 'rgba(255,255,255,0.1)', borderless: true } : { color: 'rgba(0,0,0,0.06)', borderless: true }
                  }
                  style={({ pressed }) => [styles.dayCell, pressed && day && styles.dayCellPressed]}
                  onPress={() => handleDatePress(day)}
                  accessibilityRole={day ? 'button' : undefined}
                  accessibilityLabel={
                    day
                      ? `${monthName.split(' ')[0]} ${day}${
                          dateEvents.length ? `, ${dateEvents.length} ${dateEvents.length === 1 ? 'item' : 'items'}` : ''
                        }`
                      : undefined
                  }
                >
                  {day ? (
                    <>
                      <View style={[styles.dayCircle, isToday && styles.todayCircle]}>
                        <Text style={[styles.dayText, isToday && styles.todayText]}>{day}</Text>
                      </View>
                      <View style={styles.eventsIndicator}>
                        {dotTypes.map((type) => (
                          <View
                            key={type}
                            style={[styles.eventDot, { backgroundColor: getEventColor(type) }]}
                          />
                        ))}
                      </View>
                    </>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </GlassSurface>

        {renderUpcoming()}
        {renderReminders()}
      </ScrollView>
    );
  };

  const formatUpcomingDay = (dateStr) => {
    const bare = String(dateStr).split('T')[0];
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (bare === toDateKey(today)) return 'Today';
    if (bare === toDateKey(tomorrow)) return 'Tomorrow';
    return parseDateLocal(bare).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const openUpcomingEvent = (event) => {
    const bare = String(event.event_date).split('T')[0];
    const sameDay = upcomingEvents.filter((e) => String(e.event_date).split('T')[0] === bare);
    setSelectedDate(bare);
    setSelectedDateEvents(sameDay);
    setCurrentEventIndex(Math.max(0, sameDay.findIndex((e) => e.id === event.id)));
  };

  const renderUpcoming = () => (
    <View style={styles.upcomingSection}>
      <Text style={styles.upcomingTitle} accessibilityRole="header">
        Upcoming
      </Text>
      {upcomingEvents.length === 0 ? (
        <GlassSurface style={styles.upcomingEmpty}>
          <Ionicons name="calendar-clear-outline" size={22} color={colors.textSecondary} />
          <Text style={styles.upcomingEmptyText}>
            Nothing coming up. Dates you mention in a prayer request, like an interview on Friday,
            will show up here.
          </Text>
        </GlassSurface>
      ) : (
        upcomingEvents.map((event) => (
          <TouchableOpacity
            key={event.id}
            onPress={() => openUpcomingEvent(event)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`${event.person_name || 'Unknown'}, ${formatUpcomingDay(event.event_date)}${
              event.summary ? `, ${event.summary}` : ''
            }`}
          >
            <GlassSurface style={styles.upcomingItem}>
              <View
                style={[styles.upcomingAccent, { backgroundColor: getEventColor(event.event_type) }]}
              />
              <View style={styles.upcomingText}>
                <View style={styles.upcomingTopRow}>
                  <Text style={styles.upcomingPerson} numberOfLines={1}>
                    {event.person_name || 'Unknown'}
                  </Text>
                  <Text style={styles.upcomingDate}>{formatUpcomingDay(event.event_date)}</Text>
                </View>
                {event.summary ? (
                  <Text style={styles.upcomingSummary} numberOfLines={2}>
                    {event.summary}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={styles.upcomingBell}
                onPress={() => remindForEvent(event)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Remind me to pray for ${event.person_name || 'this request'}`}
              >
                <Ionicons name="notifications-outline" size={18} color={colors.primary} />
              </TouchableOpacity>
            </GlassSurface>
          </TouchableOpacity>
        ))
      )}
    </View>
  );

  // Soonest first; finished one-time reminders drop to the bottom.
  const sortedReminders = useMemo(() => {
    const now = new Date();
    return reminders
      .map((reminder) => ({ reminder, next: nextOccurrence(reminder, now) }))
      .sort((a, b) => {
        if (!a.next && !b.next) return 0;
        if (!a.next) return 1;
        if (!b.next) return -1;
        return a.next - b.next;
      });
  }, [reminders]);

  const renderReminders = () => (
    <View style={styles.upcomingSection}>
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.upcomingTitle, styles.sectionHeaderTitle]} accessibilityRole="header">
          Prayer reminders
        </Text>
        <TouchableOpacity
          style={styles.addReminderButton}
          onPress={() => openNewReminder()}
          accessibilityRole="button"
          accessibilityLabel="Add a prayer reminder"
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addReminderText}>Add</Text>
        </TouchableOpacity>
      </View>
      {sortedReminders.length === 0 ? (
        <GlassSurface style={styles.upcomingEmpty}>
          <Ionicons name="notifications-outline" size={22} color={colors.textSecondary} />
          <View style={styles.upcomingText}>
            <Text style={styles.upcomingEmptyText}>
              Set a daily or weekly prayer time, or tap the bell on an upcoming request to be reminded
              to pray for that person.
            </Text>
            <TouchableOpacity
              onPress={() => openNewReminder({ title: 'Prayer time', repeat: 'daily' })}
              accessibilityRole="button"
            >
              <Text style={styles.emptyLink}>Set my prayer time</Text>
            </TouchableOpacity>
          </View>
        </GlassSurface>
      ) : (
        sortedReminders.map(({ reminder, next }) => (
          <TouchableOpacity
            key={reminder.id}
            onPress={() => openEditReminder(reminder)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`${reminder.title}, ${describeSchedule(reminder)}. Edit reminder`}
          >
            <GlassSurface style={[styles.upcomingItem, !next && styles.reminderFinished]}>
              <View style={[styles.upcomingAccent, { backgroundColor: REMINDER_COLOR }]} />
              <View style={styles.upcomingText}>
                <Text style={styles.upcomingPerson} numberOfLines={1}>
                  {reminder.title}
                </Text>
                <Text style={styles.reminderSchedule}>
                  {next ? describeSchedule(reminder) : `Done · ${describeSchedule(reminder)}`}
                </Text>
                {reminder.person_name ? (
                  <Text style={styles.upcomingSummary} numberOfLines={1}>
                    For {reminder.person_name}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </GlassSurface>
          </TouchableOpacity>
        ))
      )}
    </View>
  );

  const currentEvent = selectedDateEvents[currentEventIndex];
  const hasMultipleEvents = selectedDateEvents.length > 1;

  const closeEventModal = () => {
    setSelectedDate(null);
    setSelectedDateEvents([]);
    setCurrentEventIndex(0);
  };

  // Jump from a calendar event to the prayer request it came from (People tab).
  const openPrayerRequest = async (event) => {
    if (!event?.person_id || !event?.session_id) return;
    setIsOpeningRequest(true);
    try {
      const data = await personAPI.getById(event.person_id);
      const session = (data?.sessions || []).find((s) => String(s.id) === String(event.session_id));
      if (!session) {
        Alert.alert('Not found', 'This prayer request is no longer available.');
        return;
      }
      closeEventModal();
      navigation.navigate('People', {
        screen: 'PrayerRequestDetail',
        initial: false,
        params: {
          session,
          personId: data.person.id,
          personName: data.person.full_name,
        },
      });
    } catch (error) {
      console.error('[CalendarScreen] Error opening prayer request:', error);
      Alert.alert('Error', 'Could not open this prayer request. Please try again.');
    } finally {
      setIsOpeningRequest(false);
    }
  };

  const openEditEventModal = () => {
    if (!currentEvent) return;
    const eventSnapshot = { ...currentEvent };
    setEditingEvent(eventSnapshot);
    const [y, m, d] = String(eventSnapshot.event_date || '').split('T')[0].split('-').map((v) => Number(v));
    if (y && m && d) {
      setEditYear(y);
      setEditMonth(m);
      setEditDay(d);
      setEditEventDate(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    setEditEventSummary(eventSnapshot.summary || '');
    // Close detail modal first; iOS can get stuck when stacking modals.
    setSelectedDate(null);
    setSelectedDateEvents([]);
    setCurrentEventIndex(0);
    setShowEditEventModal(true);
  };

  const handleSaveEventEdit = async () => {
    if (!editingEvent) return;
    const formattedDate = `${String(editYear).padStart(4, '0')}-${String(editMonth).padStart(2, '0')}-${String(editDay).padStart(2, '0')}`;
    setIsSavingEventEdit(true);
    try {
      await calendarAPI.updateEvent(editingEvent.id, {
        eventDate: formattedDate,
        summary: editEventSummary.trim(),
      });
      setShowEditEventModal(false);
      setEditingEvent(null);
      await Promise.all([loadEvents(), loadUpcoming()]);
      const refreshed = await calendarAPI.getEventsByDate(formattedDate);
      setSelectedDateEvents((refreshed.events || []).filter(isHappeningDate));
      setCurrentEventIndex(0);
      setSelectedDate(formattedDate);
    } catch (error) {
      console.error('[CalendarScreen] Error saving event edit:', error);
      Alert.alert('Error', error.response?.data?.error || 'Failed to update event');
    } finally {
      setIsSavingEventEdit(false);
    }
  };

  const daysInCurrentMonth = new Date(editYear, editMonth, 0).getDate();
  const clampDay = (day) => Math.max(1, Math.min(day, daysInCurrentMonth));
  const changeYear = (delta) => {
    const next = Math.max(2000, Math.min(2100, editYear + delta));
    setEditYear(next);
    setEditDay((prev) => clampDay(prev));
  };
  const changeMonth = (delta) => {
    const next = editMonth + delta;
    if (next < 1 || next > 12) return;
    setEditMonth(next);
    setEditDay((prev) => clampDay(prev));
  };
  const changeDay = (delta) => {
    setEditDay((prev) => clampDay(prev + delta));
  };

  return (
    <SafeAreaView style={styles.container}>
      {renderMonthView()}


      {/* Event Detail Modal */}
      <Modal
        visible={currentEvent !== null && currentEvent !== undefined}
        transparent={true}
        animationType="slide"
        accessibilityViewIsModal={Platform.OS === 'ios'}
        onRequestClose={closeEventModal}
      >
        <View style={styles.modalOverlay}>
          <GlassSurface style={styles.modalContent} intensity={52} strong>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                {hasMultipleEvents && (
                  <TouchableOpacity
                    onPress={() => navigateEvent(-1)}
                    disabled={currentEventIndex === 0}
                    style={[styles.modalNavButton, currentEventIndex === 0 && styles.modalNavButtonDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Previous event"
                    accessibilityState={{ disabled: currentEventIndex === 0 }}
                  >
                    <Ionicons
                      name="chevron-back"
                      size={20}
                      color={currentEventIndex === 0 ? '#ccc' : colors.primary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  </TouchableOpacity>
                )}
                <Text style={styles.modalTitle} accessibilityRole="header">
                  {hasMultipleEvents ? `Event ${currentEventIndex + 1} of ${selectedDateEvents.length}` : 'Event Details'}
                </Text>
                {hasMultipleEvents && (
                  <TouchableOpacity
                    onPress={() => navigateEvent(1)}
                    disabled={currentEventIndex === selectedDateEvents.length - 1}
                    style={[styles.modalNavButton, currentEventIndex === selectedDateEvents.length - 1 && styles.modalNavButtonDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Next event"
                    accessibilityState={{
                      disabled: currentEventIndex === selectedDateEvents.length - 1,
                    }}
                  >
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={currentEventIndex === selectedDateEvents.length - 1 ? '#ccc' : colors.primary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                onPress={closeEventModal}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Close event details"
              >
                <Ionicons
                  name="close"
                  size={24}
                  color={colors.textPrimary}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              </TouchableOpacity>
            </View>
            
            {currentEvent && (
              <ScrollView style={styles.modalBody}>
                <View style={styles.modalEventType}>
                  <View
                    style={[
                      styles.modalEventTypeDot,
                      { backgroundColor: getEventColor(currentEvent.event_type) }
                    ]}
                  />
                  <Text style={styles.modalEventTypeText}>
                    {currentEvent.event_type === 'reminder'
                      ? 'Prayer Reminder'
                      : currentEvent.event_type === 'session'
                      ? 'Prayer Request Date'
                      : 'Prayer Request Event'}
                  </Text>
                </View>

                <Text style={styles.modalPersonName}>{getItemTitle(currentEvent)}</Text>
                <Text style={styles.modalDate}>
                  {formatDate(currentEvent.event_date)}
                  {currentEvent.event_type === 'session' && currentEvent.session_created_at && (
                    <Text style={styles.modalTime}>
                      {' '}at {formatTime(currentEvent.session_created_at)}
                    </Text>
                  )}
                  {currentEvent.event_type === 'reminder' && (
                    <Text style={styles.modalTime}>
                      {' '}at {formatReminderTime(currentEvent.reminder)}
                    </Text>
                  )}
                </Text>

                {currentEvent.event_type === 'reminder' ? (
                  <View style={styles.modalSummaryContainer}>
                    <Text style={styles.modalSummaryLabel}>Repeats:</Text>
                    <Text style={styles.modalSummaryText}>{describeSchedule(currentEvent.reminder)}</Text>
                    {currentEvent.person_name ? (
                      <Text style={[styles.modalSummaryText, styles.modalReminderFor]}>
                        For {currentEvent.person_name}
                      </Text>
                    ) : null}
                  </View>
                ) : currentEvent.summary && (
                  <View style={styles.modalSummaryContainer}>
                    <Text style={styles.modalSummaryLabel}>Summary:</Text>
                    <Text style={styles.modalSummaryText}>{currentEvent.summary}</Text>
                  </View>
                )}

                {currentEvent.person_id && currentEvent.session_id ? (
                  <TouchableOpacity
                    style={styles.viewRequestButton}
                    onPress={() => openPrayerRequest(currentEvent)}
                    disabled={isOpeningRequest}
                    accessibilityRole="button"
                    accessibilityLabel="View prayer request"
                    accessibilityState={{ disabled: isOpeningRequest }}
                  >
                    <Ionicons
                      name="document-text-outline"
                      size={18}
                      color={colors.primary}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                    <Text style={styles.viewRequestButtonText}>
                      {isOpeningRequest ? 'Opening...' : 'View Prayer Request'}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {currentEvent.event_type === 'referenced' && (
                  <TouchableOpacity
                    style={styles.editEventButton}
                    onPress={openEditEventModal}
                    accessibilityRole="button"
                    accessibilityLabel="Edit event date"
                  >
                    <Ionicons
                      name="create-outline"
                      size={18}
                      color="#fff"
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                    <Text style={styles.editEventButtonText}>Edit Event</Text>
                  </TouchableOpacity>
                )}

                {currentEvent.event_type === 'reminder' ? (
                  <>
                    <TouchableOpacity
                      style={styles.editEventButton}
                      onPress={() => {
                        const reminder = currentEvent.reminder;
                        // Close the details sheet first; iOS can get stuck when stacking modals.
                        closeEventModal();
                        openEditReminder(reminder);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Edit reminder"
                    >
                      <Ionicons name="create-outline" size={18} color="#fff" />
                      <Text style={styles.editEventButtonText}>Edit Reminder</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.viewRequestButton}
                      onPress={() =>
                        addReminderToGoogleCalendar(currentEvent.reminder).catch(() =>
                          Alert.alert('Could not open Google Calendar', 'Please try again in a moment.')
                        )
                      }
                      accessibilityRole="button"
                      accessibilityLabel="Add to Google Calendar"
                    >
                      <Ionicons name="logo-google" size={18} color={colors.primary} />
                      <Text style={styles.viewRequestButtonText}>Add to Google Calendar</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.viewRequestButton}
                    onPress={() => {
                      const event = currentEvent;
                      closeEventModal();
                      remindForEvent(event);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remind me to pray for ${currentEvent.person_name || 'this request'}`}
                  >
                    <Ionicons name="notifications-outline" size={18} color={colors.primary} />
                    <Text style={styles.viewRequestButtonText}>Remind Me to Pray</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </GlassSurface>
        </View>
      </Modal>

      <Modal
        visible={showEditEventModal}
        transparent={true}
        animationType="slide"
        accessibilityViewIsModal={Platform.OS === 'ios'}
        onRequestClose={() => {
          if (!isSavingEventEdit) {
            setShowEditEventModal(false);
            setEditingEvent(null);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.editModalKeyboardWrap}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
          >
            <GlassSurface style={styles.editModalContent} intensity={52} strong>
              <Text style={styles.modalTitle} accessibilityRole="header">
                Edit Event
              </Text>
              <Text style={styles.editLabel}>Event Date</Text>
              <View style={styles.datePickerRow}>
                <View style={styles.datePickerCol}>
                  <Text style={styles.datePickerColLabel}>Year</Text>
                  <View style={styles.dateStepper}>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeYear(-1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease year"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="remove"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                    <Text style={styles.stepValue}>{editYear}</Text>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeYear(1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Increase year"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="add"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.datePickerCol}>
                  <Text style={styles.datePickerColLabel}>Month</Text>
                  <View style={styles.dateStepper}>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeMonth(-1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease month"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="remove"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                    <Text style={styles.stepValue}>{String(editMonth).padStart(2, '0')}</Text>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeMonth(1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Increase month"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="add"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.datePickerCol}>
                  <Text style={styles.datePickerColLabel}>Day</Text>
                  <View style={styles.dateStepper}>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeDay(-1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease day"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="remove"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                    <Text style={styles.stepValue}>{String(editDay).padStart(2, '0')}</Text>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => changeDay(1)}
                      disabled={isSavingEventEdit}
                      accessibilityRole="button"
                      accessibilityLabel="Increase day"
                      accessibilityState={{ disabled: isSavingEventEdit }}
                    >
                      <Ionicons
                        name="add"
                        size={18}
                        color={colors.textPrimary}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              <Text style={styles.selectedDatePreview}>
                Selected: {`${String(editYear).padStart(4, '0')}-${String(editMonth).padStart(2, '0')}-${String(editDay).padStart(2, '0')}`}
              </Text>
              <Text style={styles.editLabel}>Summary</Text>
              <TextInput
                style={[styles.editInput, styles.editInputMultiline]}
                value={editEventSummary}
                onChangeText={setEditEventSummary}
                editable={!isSavingEventEdit}
                multiline
                textAlignVertical="top"
                placeholderTextColor={colors.placeholderText}
                accessibilityLabel="Event summary"
              />
              <View style={styles.editButtonsRow}>
                <TouchableOpacity
                  style={[styles.editActionButton, styles.editCancelButton]}
                  disabled={isSavingEventEdit}
                  onPress={() => {
                    setShowEditEventModal(false);
                    setEditingEvent(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel editing"
                  accessibilityState={{ disabled: isSavingEventEdit }}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.editActionButton, styles.editSaveButton]}
                  disabled={isSavingEventEdit}
                  onPress={handleSaveEventEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Save event"
                  accessibilityState={{ disabled: isSavingEventEdit }}
                >
                  <Text style={styles.editSaveText}>{isSavingEventEdit ? 'Saving...' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </GlassSurface>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <ReminderEditor
        visible={!!reminderEditor}
        reminder={reminderEditor?.reminder || null}
        defaults={reminderEditor?.defaults || {}}
        onClose={() => setReminderEditor(null)}
        onChanged={loadReminders}
      />
    </SafeAreaView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#FFF4CC',
    borderColor: '#E6D48A',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  offlineBannerText: {
    flex: 1,
    color: '#665200',
    fontSize: 12,
    fontWeight: '500',
  },
  screenTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.textPrimary,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  monthCard: {
    marginHorizontal: 16,
    borderRadius: RADIUS.card,
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 8,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  navButton: {
    padding: 6,
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  weekDaysContainer: {
    flexDirection: 'row',
    paddingBottom: 6,
  },
  weekDay: {
    flex: 1,
    alignItems: 'center',
  },
  weekDayText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  calendarContainer: {
    flex: 1,
  },
  calendarContent: {
    paddingBottom: 8,
  },
  upcomingSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  upcomingTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  upcomingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.card,
    marginBottom: 10,
    paddingVertical: 12,
    paddingRight: 12,
    overflow: 'hidden',
  },
  upcomingAccent: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginLeft: 8,
    marginRight: 12,
  },
  upcomingText: {
    flex: 1,
    marginRight: 8,
  },
  upcomingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  upcomingPerson: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  upcomingDate: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  upcomingSummary: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  upcomingEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: RADIUS.card,
  },
  upcomingEmptyText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  upcomingBell: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionHeaderTitle: {
    marginBottom: 0,
  },
  addReminderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  addReminderText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  emptyLink: {
    marginTop: 8,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  reminderSchedule: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '600',
    color: REMINDER_COLOR,
  },
  reminderFinished: {
    opacity: 0.6,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    height: 46,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  dayCellPressed: {
    opacity: 0.6,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCircle: {
    backgroundColor: colors.primary,
  },
  dayText: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  todayText: {
    fontWeight: '700',
    color: '#fff',
  },
  eventsIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 6,
    gap: 3,
  },
  eventDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: RADIUS.modal,
    borderTopRightRadius: RADIUS.modal,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  modalNavButton: {
    padding: 4,
  },
  modalNavButtonDisabled: {
    opacity: 0.3,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  modalBody: {
    padding: 16,
  },
  modalEventType: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalEventTypeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  modalEventTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  modalPersonName: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  modalDate: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  modalTime: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  modalSummaryContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: RADIUS.card,
  },
  modalSummaryLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  modalSummaryText: {
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 24,
  },
  viewRequestButton: {
    marginTop: 18,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  viewRequestButtonText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  modalReminderFor: {
    marginTop: 6,
    color: colors.textSecondary,
  },
  editEventButton: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  editEventButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  editModalContent: {
    width: '90%',
    maxWidth: 520,
    borderRadius: RADIUS.modal,
    padding: 16,
  },
  editModalKeyboardWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editLabel: {
    marginTop: 10,
    marginBottom: 6,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 13,
  },
  editInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 14,
  },
  editInputMultiline: {
    minHeight: 100,
  },
  datePickerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  datePickerCol: {
    flex: 1,
  },
  datePickerColLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
    fontWeight: '600',
  },
  dateStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  stepValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  selectedDatePreview: {
    marginTop: 8,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  editButtonsRow: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  editActionButton: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 11,
    alignItems: 'center',
  },
  editCancelButton: {
    backgroundColor: colors.surfaceMuted,
  },
  editSaveButton: {
    backgroundColor: colors.primary,
  },
  editCancelText: {
    color: colors.textSecondary,
    fontWeight: '700',
  },
  editSaveText: {
    color: '#fff',
    fontWeight: '700',
  },
});
}
