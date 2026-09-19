import * as SQLite from 'expo-sqlite';

let dbPromise = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('tabbe_local_cache.db');
  }
  return dbPromise;
}

export async function initLocalDb() {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS persons_cache (
      id INTEGER PRIMARY KEY,
      include_groups INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS person_detail_cache (
      person_id INTEGER PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS person_summary_cache (
      person_id INTEGER PRIMARY KEY,
      summary TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_events_cache (
      id INTEGER PRIMARY KEY,
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export async function cachePersons(persons, includeGroups = false) {
  await initLocalDb();
  const db = await getDb();
  const now = new Date().toISOString();
  const includeFlag = includeGroups ? 1 : 0;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'DELETE FROM persons_cache WHERE include_groups = ?',
      [includeFlag]
    );
    for (const person of persons || []) {
      await db.runAsync(
        `
        INSERT OR REPLACE INTO persons_cache (id, include_groups, payload_json, updated_at)
        VALUES (?, ?, ?, ?)
        `,
        [person.id, includeFlag, JSON.stringify(person), now]
      );
    }
  });
}

export async function getCachedPersons(includeGroups = false) {
  await initLocalDb();
  const db = await getDb();
  const includeFlag = includeGroups ? 1 : 0;
  const rows = await db.getAllAsync(
    `
    SELECT payload_json
    FROM persons_cache
    WHERE include_groups = ?
    ORDER BY id DESC
    `,
    [includeFlag]
  );
  return rows.map((r) => JSON.parse(r.payload_json));
}

export async function cachePersonDetail(personId, payload) {
  await initLocalDb();
  const db = await getDb();
  await db.runAsync(
    `
    INSERT OR REPLACE INTO person_detail_cache (person_id, payload_json, updated_at)
    VALUES (?, ?, ?)
    `,
    [Number(personId), JSON.stringify(payload), new Date().toISOString()]
  );
}

export async function getCachedPersonDetail(personId) {
  await initLocalDb();
  const db = await getDb();
  const row = await db.getFirstAsync(
    `
    SELECT payload_json
    FROM person_detail_cache
    WHERE person_id = ?
    `,
    [Number(personId)]
  );
  return row ? JSON.parse(row.payload_json) : null;
}

export async function cachePersonSummary(personId, summary) {
  await initLocalDb();
  const db = await getDb();
  await db.runAsync(
    `
    INSERT OR REPLACE INTO person_summary_cache (person_id, summary, updated_at)
    VALUES (?, ?, ?)
    `,
    [Number(personId), summary || null, new Date().toISOString()]
  );
}

export async function getCachedPersonSummary(personId) {
  await initLocalDb();
  const db = await getDb();
  const row = await db.getFirstAsync(
    `
    SELECT summary
    FROM person_summary_cache
    WHERE person_id = ?
    `,
    [Number(personId)]
  );
  return row?.summary || null;
}

export async function cacheCalendarEvents(events) {
  await initLocalDb();
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const event of events || []) {
      await db.runAsync(
        `
        INSERT OR REPLACE INTO calendar_events_cache (id, event_date, payload_json, updated_at)
        VALUES (?, ?, ?, ?)
        `,
        [event.id, String(event.event_date || '').split('T')[0], JSON.stringify(event), now]
      );
    }
  });
}

export async function getCachedCalendarEvents(startDate, endDate) {
  await initLocalDb();
  const db = await getDb();
  const rows = await db.getAllAsync(
    `
    SELECT payload_json
    FROM calendar_events_cache
    WHERE event_date >= ? AND event_date <= ?
    ORDER BY event_date ASC
    `,
    [startDate, endDate]
  );
  return rows.map((r) => JSON.parse(r.payload_json));
}

export async function setSyncState(key, value) {
  await initLocalDb();
  const db = await getDb();
  await db.runAsync(
    `
    INSERT OR REPLACE INTO sync_state (key, value, updated_at)
    VALUES (?, ?, ?)
    `,
    [key, value, new Date().toISOString()]
  );
}

export async function getSyncState(key) {
  await initLocalDb();
  const db = await getDb();
  const row = await db.getFirstAsync(
    `
    SELECT value
    FROM sync_state
    WHERE key = ?
    `,
    [key]
  );
  return row?.value || null;
}
