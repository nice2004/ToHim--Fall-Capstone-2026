import { calendarAPI, personAPI } from './api';
import {
  cacheCalendarEvents,
  cachePersonDetail,
  cachePersonSummary,
  cachePersons,
  getSyncState,
  initLocalDb,
  setSyncState,
} from './localDb';

const LAST_SYNC_AT_KEY = 'last_sync_at';
const LAST_NIGHTLY_BACKUP_DATE_KEY = 'last_nightly_backup_date';

function getLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shouldRunNightlyWindow(now = new Date()) {
  // Run nightly backup after 2 AM local time.
  return now.getHours() >= 2;
}

function addMonths(date, delta) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + delta);
  return d;
}

function formatDateForApi(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function runSnapshotSync() {
  await initLocalDb();
  const basic = await personAPI.getAll();
  const persons = basic?.persons || [];
  await cachePersons(persons, false);

  try {
    const withGroups = await personAPI.getAllWithGroups();
    await cachePersons(withGroups?.persons || [], true);
  } catch (error) {
    // Group cache is optional; keep base snapshot.
    console.warn('[Sync] Could not refresh grouped persons cache:', error.message);
  }

  // Refresh each person detail payload and summary in background-safe sequence.
  for (const person of persons) {
    try {
      const detail = await personAPI.getById(person.id);
      await cachePersonDetail(person.id, detail);
      try {
        const summary = await personAPI.getSummary(person.id);
        await cachePersonSummary(person.id, summary?.summary || null);
      } catch (summaryError) {
        console.warn('[Sync] Could not refresh summary for person', person.id, summaryError.message);
      }
    } catch (detailError) {
      console.warn('[Sync] Could not refresh detail for person', person.id, detailError.message);
    }
  }

  const now = new Date();
  const startDate = formatDateForApi(addMonths(now, -6));
  const endDate = formatDateForApi(addMonths(now, 6));
  const calendarResponse = await calendarAPI.getEvents(startDate, endDate);
  await cacheCalendarEvents(calendarResponse?.events || []);

  await setSyncState(LAST_SYNC_AT_KEY, new Date().toISOString());
}

export async function runNightlyBackupOnOpenIfNeeded() {
  await initLocalDb();
  const now = new Date();
  if (!shouldRunNightlyWindow(now)) return { ran: false, reason: 'before_window' };

  const today = getLocalDateString(now);
  const lastRunDate = await getSyncState(LAST_NIGHTLY_BACKUP_DATE_KEY);
  if (lastRunDate === today) return { ran: false, reason: 'already_ran_today' };

  await runSnapshotSync();
  await setSyncState(LAST_NIGHTLY_BACKUP_DATE_KEY, today);
  return { ran: true };
}

export async function getLastSyncAt() {
  return getSyncState(LAST_SYNC_AT_KEY);
}
