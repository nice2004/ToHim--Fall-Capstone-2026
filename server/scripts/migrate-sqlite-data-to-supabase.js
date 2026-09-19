const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');

// One-time migration: copy all person/session/calendar data from local SQLite
// (tabbe.db) into Supabase Postgres, preserving IDs and relationships.
//
// Usage (from the server directory):
//   DATABASE_URL='postgres://...' node scripts/migrate-sqlite-data-to-supabase.js

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Please set it to your Supabase Postgres connection string.');
    process.exit(1);
  }

  const DB_PATH = path.join(__dirname, '..', 'tabbe.db');
  console.log('Using SQLite DB at:', DB_PATH);

  const sqliteDb = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Error opening SQLite database:', err.message);
      process.exit(1);
    }
  });

  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Fetching persons, sessions, metadata, groups, calendar_events from SQLite...');

    // Default user id for very old data with missing user_id (assumes earliest user is yours)
    const defaultUserRows = await all('SELECT MIN(id) AS id FROM users');
    const defaultUserId = defaultUserRows[0]?.id || null;
    console.log('Default user id for legacy data:', defaultUserId);

    // For legacy rows where persons.user_id is NULL, try to derive it from sessions
    let persons = await all(
      `
      SELECT 
        p.*,
        COALESCE(p.user_id, su.user_id) AS effective_user_id
      FROM persons p
      LEFT JOIN (
        SELECT person_id, MIN(user_id) AS user_id
        FROM sessions
        WHERE user_id IS NOT NULL
        GROUP BY person_id
      ) su ON su.person_id = p.id
      ORDER BY p.id ASC
      `
    );

    // Fill any remaining null effective_user_id with defaultUserId
    if (defaultUserId != null) {
      persons = persons.map((p) => ({
        ...p,
        effective_user_id: p.effective_user_id != null ? p.effective_user_id : defaultUserId,
      }));
    }

    const [sessions, metadata, groups, personGroups, calendarEvents] = await Promise.all([
      all('SELECT * FROM sessions ORDER BY id ASC'),
      all('SELECT * FROM person_metadata ORDER BY id ASC'),
      all('SELECT * FROM groups ORDER BY id ASC'),
      all('SELECT * FROM person_groups ORDER BY person_id ASC, group_id ASC'),
      all('SELECT * FROM calendar_events ORDER BY id ASC'),
    ]);

    console.log(`persons: ${persons.length}, sessions: ${sessions.length}, metadata: ${metadata.length}, groups: ${groups.length}, person_groups: ${personGroups.length}, calendar_events: ${calendarEvents.length}`);

    const client = await pool.connect();
    try {
      // Ensure tables exist in Postgres
      console.log('Ensuring tables exist in Postgres...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS persons (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL,
          first_name TEXT NOT NULL,
          last_name TEXT,
          full_name TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL,
          person_id INTEGER,
          transcript TEXT NOT NULL,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS person_metadata (
          id INTEGER PRIMARY KEY,
          person_id INTEGER NOT NULL,
          key TEXT NOT NULL,
          value TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS groups (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(user_id, name)
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS person_groups (
          person_id INTEGER NOT NULL,
          group_id INTEGER NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (person_id, group_id)
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS calendar_events (
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL,
          person_id INTEGER,
          session_id INTEGER,
          event_type TEXT NOT NULL,
          event_date DATE NOT NULL,
          summary TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      console.log('Migrating persons...');
      for (const p of persons) {
        await client.query(
          `
          INSERT INTO persons (id, user_id, first_name, last_name, full_name, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              full_name = EXCLUDED.full_name,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at
          `,
          [
            p.id,
            p.effective_user_id,
            p.first_name,
            p.last_name,
            p.full_name,
            p.created_at || null,
            p.updated_at || null,
          ]
        );
      }

      // Build map person_id -> user_id for sessions that have NULL user_id
      const personUserMap = new Map();
      for (const p of persons) {
        if (p.effective_user_id != null) {
          personUserMap.set(p.id, p.effective_user_id);
        }
      }

      console.log('Migrating sessions...');
      for (const s of sessions) {
        let userId = s.user_id;
        if (userId == null) {
          userId = personUserMap.get(s.person_id) || defaultUserId || null;
        }
        if (userId == null) {
          console.warn(
            `Skipping session id=${s.id} person_id=${s.person_id} because user_id is NULL and could not be derived`
          );
          continue;
        }
        await client.query(
          `
          INSERT INTO sessions (id, user_id, person_id, transcript, notes, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              person_id = EXCLUDED.person_id,
              transcript = EXCLUDED.transcript,
              notes = EXCLUDED.notes,
              created_at = EXCLUDED.created_at
          `,
          [s.id, userId, s.person_id, s.transcript, s.notes, s.created_at || null]
        );
      }

      console.log('Migrating person_metadata...');
      for (const m of metadata) {
        await client.query(
          `
          INSERT INTO person_metadata (id, person_id, key, value, created_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE
          SET person_id = EXCLUDED.person_id,
              key = EXCLUDED.key,
              value = EXCLUDED.value,
              created_at = EXCLUDED.created_at
          `,
          [m.id, m.person_id, m.key, m.value, m.created_at || null]
        );
      }

      console.log('Migrating groups...');
      for (const g of groups) {
        await client.query(
          `
          INSERT INTO groups (id, user_id, name, created_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              name = EXCLUDED.name,
              created_at = EXCLUDED.created_at
          `,
          [g.id, g.user_id, g.name, g.created_at || null]
        );
      }

      console.log('Migrating person_groups...');
      for (const pg of personGroups) {
        await client.query(
          `
          INSERT INTO person_groups (person_id, group_id, created_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (person_id, group_id) DO UPDATE
          SET created_at = EXCLUDED.created_at
          `,
          [pg.person_id, pg.group_id, pg.created_at || null]
        );
      }

      console.log('Migrating calendar_events...');
      for (const e of calendarEvents) {
        await client.query(
          `
          INSERT INTO calendar_events (id, user_id, person_id, session_id, event_type, event_date, summary, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              person_id = EXCLUDED.person_id,
              session_id = EXCLUDED.session_id,
              event_type = EXCLUDED.event_type,
              event_date = EXCLUDED.event_date,
              summary = EXCLUDED.summary,
              created_at = EXCLUDED.created_at
          `,
          [e.id, e.user_id, e.person_id, e.session_id, e.event_type, e.event_date, e.summary, e.created_at || null]
        );
      }

      console.log('Migration complete.');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error during migration:', err);
    process.exitCode = 1;
  } finally {
    sqliteDb.close();
    await pool.end();
  }
}

main();

