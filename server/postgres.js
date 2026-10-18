const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Please set it to your Supabase Postgres connection string.'
  );
  process.exit(1);
}

function sanitizeDatabaseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    // Force SSL behavior from Pool.ssl below. Connection-string ssl params can override it.
    url.searchParams.delete('sslmode');
    url.searchParams.delete('ssl');
    url.searchParams.delete('sslcert');
    url.searchParams.delete('sslkey');
    url.searchParams.delete('sslrootcert');
    url.searchParams.delete('sslcrl');
    url.searchParams.delete('sslpassword');
    url.searchParams.delete('uselibpqcompat');
    return url.toString();
  } catch (error) {
    console.warn('[Postgres] Could not parse DATABASE_URL for sanitization, using raw value.');
    return rawUrl;
  }
}

const sanitizedConnectionString = sanitizeDatabaseUrl(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: sanitizedConnectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});

let authSchemaReadyPromise = null;

async function ensureAuthSchema() {
  if (!authSchemaReadyPromise) {
    authSchemaReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email TEXT
      `);
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE
      `);
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE
      `);
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS privacy_consent_given BOOLEAN NOT NULL DEFAULT FALSE
      `);
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMPTZ
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
        ON users (LOWER(email))
        WHERE email IS NOT NULL
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS email_verification_codes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS password_reset_codes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((err) => {
      authSchemaReadyPromise = null;
      throw err;
    });
  }
  return authSchemaReadyPromise;
}

let sessionExtensionsReadyPromise = null;

// Adds answered-status columns to `sessions` and creates `session_verses`.
// Lazily run (same pattern as ensureAuthSchema) since there's no migration
// runner for these tables — they were originally created once by
// server/scripts/migrate-sqlite-data-to-supabase.js and never touched again.
async function ensureSessionExtensionsSchema() {
  if (!sessionExtensionsReadyPromise) {
    sessionExtensionsReadyPromise = (async () => {
      await pool.query(`
        ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS answered BOOLEAN NOT NULL DEFAULT FALSE
      `);
      await pool.query(`
        ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ
      `);
      await pool.query(`
        ALTER TABLE sessions
        ADD COLUMN IF NOT EXISTS answered_note TEXT
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS session_verses (
          id SERIAL PRIMARY KEY,
          session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          reference TEXT NOT NULL,
          verse_text TEXT NOT NULL,
          translation TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((err) => {
      sessionExtensionsReadyPromise = null;
      throw err;
    });
  }
  return sessionExtensionsReadyPromise;
}

let remindersReadyPromise = null;

// Prayer reminders: a time to pray for a request, a person, or a personal prayer time.
// remind_date/remind_time are wall-clock values in the user's own timezone (not UTC) so
// "Fridays at 8:00 AM" stays at 8:00 AM across DST changes and travel.
// person_id/session_id have no FK (those tables were migrated without guaranteed PKs);
// reads skip reminders whose person/request was deleted.
async function ensureRemindersSchema() {
  if (!remindersReadyPromise) {
    remindersReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS reminders (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id INTEGER,
          session_id INTEGER,
          title TEXT NOT NULL,
          remind_date DATE NOT NULL,
          remind_time TIME NOT NULL,
          repeat TEXT NOT NULL DEFAULT 'once' CHECK (repeat IN ('once', 'daily', 'weekly')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id)
      `);
      // Added after the first release: whether this reminder should alert the phone.
      await pool.query(`
        ALTER TABLE reminders
        ADD COLUMN IF NOT EXISTS notify BOOLEAN NOT NULL DEFAULT TRUE
      `);
    })().catch((err) => {
      remindersReadyPromise = null;
      throw err;
    });
  }
  return remindersReadyPromise;
}

let journalReadyPromise = null;

// Prayer Journal: one general daily reflection per entry, plus the passages of it that are
// about specific people. entry_date is the user's own calendar day (no timezone shifting).
// person_id has no FK (persons was migrated without a guaranteed PK); reads join persons so
// links to deleted people disappear, and deletePerson removes them explicitly.
async function ensureJournalSchema() {
  if (!journalReadyPromise) {
    journalReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS journal_entries (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          entry_date DATE NOT NULL,
          prompt TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_journal_entries_user_date
        ON journal_entries(user_id, entry_date DESC, created_at DESC)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS journal_entry_people (
          id SERIAL PRIMARY KEY,
          entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id INTEGER NOT NULL,
          excerpt TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (entry_id, person_id)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_journal_entry_people_person
        ON journal_entry_people(user_id, person_id)
      `);
    })().catch((err) => {
      journalReadyPromise = null;
      throw err;
    });
  }
  return journalReadyPromise;
}

// User helper functions mirroring the SQLite dbHelpers API where needed

// Some environments were migrated with `id INTEGER PRIMARY KEY` (no DEFAULT),
// meaning inserts that omit `id` will fail. As a runtime fallback, when we
// hit "null value in column id", we retry the insert using (MAX(id) + 1).
const ID_FALLBACK_TABLES = new Set([
  'persons',
  'sessions',
  'person_metadata',
  'groups',
  'calendar_events',
]);

function isIdNotNullViolation(err) {
  if (!err) return false;
  if (err.code !== '23502') return false;
  // Prefer the structured fields if present; otherwise fall back to message inspection.
  if (err.column === 'id') return true;
  return typeof err.message === 'string' && err.message.toLowerCase().includes('null value') && err.message.includes('id');
}

async function getNextId(tableName) {
  if (!ID_FALLBACK_TABLES.has(tableName)) {
    throw new Error(`getNextId() called for unexpected table: ${tableName}`);
  }
  const result = await pool.query(
    `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ${tableName}`
  );
  return result.rows[0]?.next_id;
}

async function createUser(username, passwordHash, email, name = null, privacyConsentGiven = false) {
  await ensureAuthSchema();
  const result = await pool.query(
    `
    INSERT INTO users (username, password_hash, email, name, email_verified, onboarding_completed, privacy_consent_given, privacy_consent_at)
    VALUES ($1, $2, $3, $4, FALSE, FALSE, $5, CASE WHEN $5 THEN NOW() ELSE NULL END)
    RETURNING id, username, email, email_verified, onboarding_completed, privacy_consent_given, privacy_consent_at, name, created_at
    `,
    [username, passwordHash, email, name, privacyConsentGiven === true]
  );
  return result.rows[0];
}

async function getUserByUsername(username) {
  await ensureAuthSchema();
  const result = await pool.query(
    `
    SELECT id, username, email, email_verified, onboarding_completed, privacy_consent_given, privacy_consent_at, password_hash, name, created_at
    FROM users
    WHERE username = $1
    LIMIT 1
    `,
    [username]
  );
  return result.rows[0] || null;
}

async function getUserByEmail(email) {
  await ensureAuthSchema();
  const result = await pool.query(
    `
    SELECT id, username, email, email_verified, onboarding_completed, privacy_consent_given, privacy_consent_at, password_hash, name, created_at
    FROM users
    WHERE LOWER(email) = LOWER($1)
    LIMIT 1
    `,
    [email]
  );
  return result.rows[0] || null;
}

async function getUserByUsernameOrEmail(identifier) {
  await ensureAuthSchema();
  const result = await pool.query(
    `
    SELECT id, username, email, email_verified, onboarding_completed, privacy_consent_given, privacy_consent_at, password_hash, name, created_at
    FROM users
    WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)
    LIMIT 1
    `,
    [identifier]
  );
  return result.rows[0] || null;
}

async function getUserById(id) {
  await ensureAuthSchema();
  const result = await pool.query(
    `
    SELECT id, username, email, email_verified, onboarding_completed, privacy_consent_given, privacy_consent_at, name, created_at
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );
  return result.rows[0] || null;
}

/** For account deletion only: returns username + password hash for verification. */
async function getUserCredentialsForDeletion(id) {
  await ensureAuthSchema();
  const result = await pool.query(
    `
    SELECT username, password_hash
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );
  return result.rows[0] || null;
}

async function markUserEmailVerified(userId) {
  await ensureAuthSchema();
  await pool.query(
    `
    UPDATE users
    SET email_verified = TRUE
    WHERE id = $1
    `,
    [userId]
  );
}

async function updateUserPassword(userId, passwordHash) {
  await ensureAuthSchema();
  await pool.query(
    `
    UPDATE users
    SET password_hash = $1
    WHERE id = $2
    `,
    [passwordHash, userId]
  );
}

async function updateUserEmail(userId, email) {
  await ensureAuthSchema();
  const result = await pool.query(
    `
    UPDATE users
    SET email = $1,
        email_verified = FALSE
    WHERE id = $2
    RETURNING id, username, email, email_verified, onboarding_completed, privacy_consent_given, privacy_consent_at, name, created_at
    `,
    [email, userId]
  );
  return result.rows[0] || null;
}

async function markPrivacyConsentGiven(userId) {
  await ensureAuthSchema();
  const result = await pool.query(
    `
    UPDATE users
    SET privacy_consent_given = TRUE,
        privacy_consent_at = NOW()
    WHERE id = $1
    RETURNING id, username, email, email_verified, onboarding_completed, privacy_consent_given, privacy_consent_at, name, created_at
    `,
    [userId]
  );
  return result.rows[0] || null;
}

async function markOnboardingCompleted(userId) {
  await ensureAuthSchema();
  await pool.query(
    `
    UPDATE users
    SET onboarding_completed = TRUE
    WHERE id = $1
    `,
    [userId]
  );
}

async function updateUserName(userId, name) {
  const result = await pool.query(
    `
    UPDATE users
    SET name = $1
    WHERE id = $2
    RETURNING id, username, name, created_at
    `,
    [name, userId]
  );
  return result.rows[0] || null;
}

async function updateUsername(userId, username) {
  const trimmed = String(username || '').trim();
  if (trimmed.length < 3) {
    const err = new Error('Username must be at least 3 characters long');
    err.code = 'VALIDATION';
    throw err;
  }
  const existing = await getUserByUsername(trimmed);
  if (existing && existing.id !== Number(userId)) {
    const err = new Error('Username already taken');
    err.code = 'CONFLICT';
    throw err;
  }
  const result = await pool.query(
    `
    UPDATE users
    SET username = $1
    WHERE id = $2
    RETURNING id, username, name, created_at
    `,
    [trimmed, userId]
  );
  return result.rows[0] || null;
}

/**
 * Permanently removes a user and all associated application data (people, sessions, groups, calendar, codes).
 * Run inside a transaction; order respects typical FK dependencies.
 */
async function deleteUserAndAllData(userId) {
  const uid = Number(userId);
  await ensureRemindersSchema();
  await ensureJournalSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM reminders WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM journal_entry_people WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM journal_entries WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM calendar_events WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [uid]);
    await client.query(
      `DELETE FROM person_metadata WHERE person_id IN (SELECT id FROM persons WHERE user_id = $1)`,
      [uid]
    );
    await client.query(
      `
      DELETE FROM person_groups
      WHERE person_id IN (SELECT id FROM persons WHERE user_id = $1)
         OR group_id IN (SELECT id FROM groups WHERE user_id = $1)
      `,
      [uid]
    );
    await client.query('DELETE FROM groups WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM persons WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM email_verification_codes WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM password_reset_codes WHERE user_id = $1', [uid]);
    const deleted = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [uid]);
    await client.query('COMMIT');
    return deleted.rowCount === 1;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[Postgres] Rollback failed:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

// ----- Person / session / group / calendar helpers (read-heavy paths) -----

async function getAllPersons(userId) {
  const result = await pool.query(
    `
    SELECT *
    FROM persons
    WHERE user_id = $1
    ORDER BY updated_at DESC
    `,
    [userId]
  );
  return result.rows;
}

async function getPersonById(userId, personId) {
  const result = await pool.query(
    `
    SELECT *
    FROM persons
    WHERE id = $1 AND user_id = $2
    LIMIT 1
    `,
    [personId, userId]
  );
  return result.rows[0] || null;
}

async function getAllPersonsWithGroups(userId) {
  // Load persons
  const personsResult = await pool.query(
    `
    SELECT *
    FROM persons
    WHERE user_id = $1
    ORDER BY updated_at DESC
    `,
    [userId]
  );
  const persons = personsResult.rows;

  if (persons.length === 0) return [];

  // Load groups per person
  const personIds = persons.map((p) => p.id);
  const result = await pool.query(
    `
    SELECT g.*, pg.person_id
    FROM groups g
    INNER JOIN person_groups pg ON g.id = pg.group_id
    WHERE g.user_id = $1 AND pg.person_id = ANY($2::int[])
    ORDER BY g.name ASC
    `,
    [userId, personIds]
  );

  const groupsByPerson = new Map();
  for (const row of result.rows) {
    if (!groupsByPerson.has(row.person_id)) {
      groupsByPerson.set(row.person_id, []);
    }
    const { person_id, ...group } = row;
    groupsByPerson.get(person_id).push(group);
  }

  return persons.map((p) => ({
    ...p,
    groups: groupsByPerson.get(p.id) || [],
  }));
}

async function getSessionsByPerson(userId, personId) {
  const result = await pool.query(
    `
    SELECT *
    FROM sessions
    WHERE person_id = $1 AND user_id = $2
    ORDER BY created_at DESC
    `,
    [personId, userId]
  );
  return result.rows;
}

async function getPersonMetadata(userId, personId) {
  const result = await pool.query(
    `
    SELECT pm.*
    FROM person_metadata pm
    INNER JOIN persons p ON pm.person_id = p.id
    WHERE pm.person_id = $1 AND p.user_id = $2
    `,
    [personId, userId]
  );
  return result.rows;
}

async function getAllPersonData(userId, personId) {
  const person = await getPersonById(userId, personId);
  if (!person) {
    return { person: null, sessions: [], metadata: [] };
  }
  const [sessions, metadata, reflections] = await Promise.all([
    getSessionsByPerson(userId, personId),
    getPersonMetadata(userId, personId),
    getReflectionsForPerson(userId, personId),
  ]);
  const verses = await getVersesBySessionIds(sessions.map((s) => s.id));
  const versesBySession = new Map();
  for (const v of verses) {
    if (!versesBySession.has(v.session_id)) versesBySession.set(v.session_id, []);
    versesBySession.get(v.session_id).push(v);
  }
  for (const session of sessions) {
    session.verses = versesBySession.get(session.id) || [];
  }
  return { person, sessions, metadata, reflections };
}

async function getAllPersonDataForPersonIds(userId, personIds) {
  if (!personIds || personIds.length === 0) return [];

  const personsRes = await pool.query(
    `
    SELECT *
    FROM persons
    WHERE id = ANY($1::int[]) AND user_id = $2
    `,
    [personIds, userId]
  );
  const persons = personsRes.rows;

  const sessionsRes = await pool.query(
    `
    SELECT *
    FROM sessions
    WHERE person_id = ANY($1::int[]) AND user_id = $2
    ORDER BY created_at DESC
    `,
    [personIds, userId]
  );

  const metaRes = await pool.query(
    `
    SELECT pm.*
    FROM person_metadata pm
    INNER JOIN persons p ON pm.person_id = p.id
    WHERE pm.person_id = ANY($1::int[]) AND p.user_id = $2
    `,
    [personIds, userId]
  );

  const byId = new Map();
  for (const p of persons) {
    byId.set(p.id, { person: p, sessions: [], metadata: [] });
  }
  for (const s of sessionsRes.rows) {
    const entry = byId.get(s.person_id);
    if (entry) entry.sessions.push(s);
  }
  for (const m of metaRes.rows) {
    const entry = byId.get(m.person_id);
    if (entry) entry.metadata.push(m);
  }

  return personIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map(({ person, sessions, metadata }) => ({ person, sessions, metadata }));
}

async function getAllGroups(userId) {
  const result = await pool.query(
    `
    SELECT *
    FROM groups
    WHERE user_id = $1
    ORDER BY name ASC
    `,
    [userId]
  );
  return result.rows;
}

async function getPersonsInGroup(userId, groupId) {
  const result = await pool.query(
    `
    SELECT p.*
    FROM persons p
    INNER JOIN person_groups pg ON p.id = pg.person_id
    INNER JOIN groups g ON g.id = pg.group_id
    WHERE pg.group_id = $1 AND g.user_id = $2
    ORDER BY p.full_name ASC
    `,
    [groupId, userId]
  );
  return result.rows;
}

async function getCalendarEvents(userId, startDate = null, endDate = null) {
  const params = [userId];
  const conditions = ['ce.user_id = $1'];

  if (startDate && endDate) {
    // Compare on calendar date only (not timestamp time) so day view includes all events that day.
    conditions.push('ce.event_date::date >= $2::date', 'ce.event_date::date <= $3::date');
    params.push(startDate, endDate);
  } else if (startDate) {
    conditions.push('ce.event_date::date >= $2::date');
    params.push(startDate);
  } else if (endDate) {
    conditions.push('ce.event_date::date <= $2::date');
    params.push(endDate);
  }

  const whereClause = conditions.join(' AND ');

  const result = await pool.query(
    `
    SELECT ce.*, p.full_name AS person_name,
           s.notes AS session_notes, s.transcript AS session_transcript, s.created_at AS session_created_at
    FROM calendar_events ce
    LEFT JOIN persons p ON ce.person_id = p.id
    LEFT JOIN sessions s ON ce.session_id = s.id
    WHERE ${whereClause}
    ORDER BY ce.event_date ASC, s.created_at ASC, ce.event_type ASC
    `,
    params
  );
  return result.rows;
}

async function getCalendarEventsByDate(userId, date) {
  const result = await pool.query(
    `
    SELECT ce.*, p.full_name AS person_name,
           s.notes AS session_notes, s.transcript AS session_transcript, s.created_at AS session_created_at
    FROM calendar_events ce
    LEFT JOIN persons p ON ce.person_id = p.id
    LEFT JOIN sessions s ON ce.session_id = s.id
    WHERE ce.user_id = $1 AND ce.event_date::date = $2::date
    ORDER BY s.created_at ASC, ce.event_type ASC
    `,
    [userId, date]
  );
  return result.rows;
}

async function createPerson(userId, firstName, lastName, fullName) {
  try {
    const result = await pool.query(
      `
      INSERT INTO persons (user_id, first_name, last_name, full_name)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [userId, firstName, lastName, fullName]
    );
    return result.rows[0];
  } catch (err) {
    if (!isIdNotNullViolation(err)) throw err;
    const nextId = await getNextId('persons');
    const result = await pool.query(
      `
      INSERT INTO persons (id, user_id, first_name, last_name, full_name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [nextId, userId, firstName, lastName, fullName]
    );
    return result.rows[0];
  }
}

async function findPersonByName(userId, name) {
  const normalizedName = name.trim();
  const result = await pool.query(
    `
    SELECT *
    FROM persons
    WHERE user_id = $1
      AND (LOWER(TRIM(full_name)) = LOWER($2) OR LOWER(TRIM(first_name)) = LOWER($2))
    LIMIT 1
    `,
    [userId, normalizedName]
  );
  return result.rows[0] || null;
}

// Levenshtein helpers copied from SQLite layer for compatibility
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));
  for (let i = 0; i <= len1; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= len2; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= len1; i += 1) {
    for (let j = 1; j <= len2; j += 1) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[len1][len2];
}

function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0;
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLen;
}

function isSubstringMatch(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (!s1 || !s2) return false;

  if (s1.length >= 2 && s2.length >= 2) {
    if (s1.includes(s2) || s2.includes(s1)) return true;
  }

  if (s1.length === 1 && s2.startsWith(s1)) return true;
  if (s2.length === 1 && s1.startsWith(s2)) return true;

  if (s1.endsWith('.') && s1.length >= 2 && s2.startsWith(s1.slice(0, -1))) return true;
  if (s2.endsWith('.') && s2.length >= 2 && s1.startsWith(s2.slice(0, -1))) return true;

  return false;
}

async function findSimilarNames(userId, name, threshold = 0.72) {
  const persons = await getAllPersons(userId);
  const normalizedName = name.toLowerCase().trim().replace(/\s+/g, ' ');
  const similar = [];

  for (const person of persons) {
    const personName = person.full_name.toLowerCase().trim();
    const firstName = person.first_name ? person.first_name.toLowerCase().trim() : '';
    const firstTokenOfFull = personName.split(/\s+/)[0] || '';

    const fullNameSimilarity = calculateSimilarity(normalizedName, personName);
    const firstNameSimilarity = firstName ? calculateSimilarity(normalizedName, firstName) : 0;
    const firstTokenSimilarity = firstTokenOfFull
      ? calculateSimilarity(normalizedName, firstTokenOfFull)
      : 0;
    const maxSimilarity = Math.max(fullNameSimilarity, firstNameSimilarity, firstTokenSimilarity);

    const substringMatch =
      isSubstringMatch(normalizedName, personName) || isSubstringMatch(personName, normalizedName);
    if (maxSimilarity >= threshold || substringMatch) {
      similar.push({
        person,
        similarity: maxSimilarity,
        matchType:
          fullNameSimilarity >= firstNameSimilarity && fullNameSimilarity >= firstTokenSimilarity
            ? 'fullName'
            : firstNameSimilarity >= firstTokenSimilarity
              ? 'firstName'
              : 'firstToken',
      });
    }
  }

  similar.sort((a, b) => b.similarity - a.similarity);
  return similar;
}

async function updatePersonTimestamp(id) {
  await pool.query(
    `
    UPDATE persons
    SET updated_at = NOW()
    WHERE id = $1
    `,
    [id]
  );
}

async function updatePerson(id, firstName, lastName, fullName) {
  const result = await pool.query(
    `
    UPDATE persons
    SET first_name = $1,
        last_name = $2,
        full_name = $3,
        updated_at = NOW()
    WHERE id = $4
    RETURNING *
    `,
    [firstName, lastName, fullName, id]
  );
  return result.rows[0] || null;
}

async function deletePerson(userId, personId) {
  // The reflections themselves stay in the journal; only the link to this person goes.
  await ensureJournalSchema();
  await pool.query(
    `DELETE FROM journal_entry_people WHERE user_id = $1 AND person_id = $2`,
    [userId, personId]
  );
  await pool.query(
    `
    DELETE FROM persons
    WHERE id = $1 AND user_id = $2
    `,
    [personId, userId]
  );
}

async function createSession(userId, personId, transcript, notes) {
  try {
    const result = await pool.query(
      `
      INSERT INTO sessions (user_id, person_id, transcript, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [userId, personId, transcript, notes]
    );
    return result.rows[0];
  } catch (err) {
    if (!isIdNotNullViolation(err)) throw err;
    const nextId = await getNextId('sessions');
    const result = await pool.query(
      `
      INSERT INTO sessions (id, user_id, person_id, transcript, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [nextId, userId, personId, transcript, notes]
    );
    return result.rows[0];
  }
}

async function getSessionById(userId, sessionId) {
  const result = await pool.query(
    `
    SELECT *
    FROM sessions
    WHERE id = $1 AND user_id = $2
    LIMIT 1
    `,
    [sessionId, userId]
  );
  return result.rows[0] || null;
}

async function createCalendarEvent(userId, personId, sessionId, eventType, eventDate, summary = null) {
  try {
    const result = await pool.query(
      `
      INSERT INTO calendar_events (user_id, person_id, session_id, event_type, event_date, summary)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [userId, personId, sessionId, eventType, eventDate, summary]
    );
    return result.rows[0];
  } catch (err) {
    if (!isIdNotNullViolation(err)) throw err;
    const nextId = await getNextId('calendar_events');
    const result = await pool.query(
      `
      INSERT INTO calendar_events (id, user_id, person_id, session_id, event_type, event_date, summary)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [nextId, userId, personId, sessionId, eventType, eventDate, summary]
    );
    return result.rows[0];
  }
}

async function updateCalendarEvent(userId, eventId, { eventDate, summary }) {
  const fields = [];
  const values = [];

  if (eventDate !== undefined) {
    fields.push(`event_date = $${fields.length + 1}`);
    values.push(eventDate);
  }
  if (summary !== undefined) {
    fields.push(`summary = $${fields.length + 1}`);
    values.push(summary);
  }
  if (fields.length === 0) {
    throw new Error('No fields provided for update');
  }

  values.push(eventId);
  values.push(userId);

  const result = await pool.query(
    `
    UPDATE calendar_events
    SET ${fields.join(', ')}
    WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2}
    RETURNING *
    `,
    values
  );
  return result.rows[0] || null;
}

async function setPersonMetadata(userId, personId, key, value) {
  // Ensure person belongs to user
  const person = await getPersonById(userId, personId);
  if (!person) throw new Error('Person not found or access denied');

  try {
    const result = await pool.query(
      `
      INSERT INTO person_metadata (person_id, key, value)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [personId, key, value]
    );
    return { id: result.rows[0].id };
  } catch (err) {
    if (!isIdNotNullViolation(err)) throw err;
    const nextId = await getNextId('person_metadata');
    const result = await pool.query(
      `
      INSERT INTO person_metadata (id, person_id, key, value)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [nextId, personId, key, value]
    );
    return { id: result.rows[0].id };
  }
}

async function updateSession(userId, sessionId, { notes, transcript }) {
  const existing = await getSessionById(userId, sessionId);
  if (!existing) throw new Error('Session not found or access denied');

  const newNotes = notes !== undefined ? notes : existing.notes;
  const newTranscript = transcript !== undefined ? transcript : existing.transcript;

  const result = await pool.query(
    `
    UPDATE sessions
    SET notes = $1,
        transcript = $2
    WHERE id = $3 AND user_id = $4
    RETURNING *
    `,
    [newNotes, newTranscript, sessionId, userId]
  );
  return result.rows[0] || null;
}

async function markSessionAnswered(userId, sessionId, { answered, answeredNote }) {
  await ensureSessionExtensionsSchema();
  const existing = await getSessionById(userId, sessionId);
  if (!existing) throw new Error('Session not found or access denied');

  const result = await pool.query(
    `
    UPDATE sessions
    SET answered = $1,
        answered_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
        answered_note = CASE WHEN $1 THEN $2 ELSE NULL END
    WHERE id = $3 AND user_id = $4
    RETURNING *
    `,
    [answered === true, answered === true ? (answeredNote || null) : null, sessionId, userId]
  );
  return result.rows[0] || null;
}

async function getVersesBySessionIds(sessionIds) {
  if (!sessionIds || sessionIds.length === 0) return [];
  await ensureSessionExtensionsSchema();
  const result = await pool.query(
    `
    SELECT *
    FROM session_verses
    WHERE session_id = ANY($1::int[])
    ORDER BY created_at ASC
    `,
    [sessionIds]
  );
  return result.rows;
}

async function addSessionVerse(userId, sessionId, { reference, text, translation }) {
  await ensureSessionExtensionsSchema();
  const session = await getSessionById(userId, sessionId);
  if (!session) throw new Error('Session not found or access denied');

  const result = await pool.query(
    `
    INSERT INTO session_verses (session_id, reference, verse_text, translation)
    VALUES ($1, $2, $3, $4)
    RETURNING *
    `,
    [sessionId, reference, text, translation || null]
  );
  return result.rows[0];
}

async function deleteSessionVerse(userId, sessionId, verseId) {
  await ensureSessionExtensionsSchema();
  const session = await getSessionById(userId, sessionId);
  if (!session) throw new Error('Session not found or access denied');

  const result = await pool.query(
    `
    DELETE FROM session_verses
    WHERE id = $1 AND session_id = $2
    RETURNING id
    `,
    [verseId, sessionId]
  );
  return result.rows.length > 0;
}

// ----- Prayer reminders -----

const REMINDER_SELECT = `
  SELECT r.id, r.user_id, r.person_id, r.session_id, r.title, r.repeat, r.notify,
         to_char(r.remind_date, 'YYYY-MM-DD') AS remind_date,
         to_char(r.remind_time, 'HH24:MI') AS remind_time,
         r.created_at, r.updated_at,
         p.full_name AS person_name
  FROM reminders r
  LEFT JOIN persons p ON r.person_id = p.id AND p.user_id = r.user_id
  LEFT JOIN sessions s ON r.session_id = s.id AND s.user_id = r.user_id
`;
// Hide reminders whose person or prayer request has since been deleted.
const REMINDER_LIVE = `(r.person_id IS NULL OR p.id IS NOT NULL) AND (r.session_id IS NULL OR s.id IS NOT NULL)`;

async function getReminders(userId) {
  await ensureRemindersSchema();
  const result = await pool.query(
    `${REMINDER_SELECT}
     WHERE r.user_id = $1 AND ${REMINDER_LIVE}
     ORDER BY r.remind_date ASC, r.remind_time ASC`,
    [userId]
  );
  return result.rows;
}

async function getReminderById(userId, reminderId) {
  await ensureRemindersSchema();
  const result = await pool.query(
    `${REMINDER_SELECT}
     WHERE r.user_id = $1 AND r.id = $2 AND ${REMINDER_LIVE}
     LIMIT 1`,
    [userId, reminderId]
  );
  return result.rows[0] || null;
}

// A reminder tied to a prayer request always belongs to that request's person.
async function resolveReminderTarget(userId, { personId, sessionId }) {
  if (sessionId) {
    const session = await getSessionById(userId, sessionId);
    if (!session) throw new Error('Prayer request not found or access denied');
    return { personId: session.person_id || null, sessionId: session.id };
  }
  if (personId) {
    const person = await getPersonById(userId, personId);
    if (!person) throw new Error('Person not found or access denied');
    return { personId: person.id, sessionId: null };
  }
  return { personId: null, sessionId: null };
}

async function createReminder(userId, { title, remindDate, remindTime, repeat, notify, personId, sessionId }) {
  await ensureRemindersSchema();
  const target = await resolveReminderTarget(userId, { personId, sessionId });
  const result = await pool.query(
    `
    INSERT INTO reminders (user_id, person_id, session_id, title, remind_date, remind_time, repeat, notify)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    [userId, target.personId, target.sessionId, title, remindDate, remindTime, repeat, notify !== false]
  );
  return getReminderById(userId, result.rows[0].id);
}

async function updateReminder(userId, reminderId, { title, remindDate, remindTime, repeat, notify }) {
  await ensureRemindersSchema();
  const result = await pool.query(
    `
    UPDATE reminders
    SET title = $1, remind_date = $2, remind_time = $3, repeat = $4, notify = $5, updated_at = NOW()
    WHERE id = $6 AND user_id = $7
    RETURNING id
    `,
    [title, remindDate, remindTime, repeat, notify !== false, reminderId, userId]
  );
  if (result.rows.length === 0) return null;
  return getReminderById(userId, reminderId);
}

async function deleteReminder(userId, reminderId) {
  await ensureRemindersSchema();
  const result = await pool.query(
    `DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id`,
    [reminderId, userId]
  );
  return result.rows.length > 0;
}

// ----- Prayer Journal -----

const JOURNAL_ENTRY_COLUMNS = `
  e.id, e.user_id, e.body, e.prompt, e.created_at, e.updated_at,
  to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date
`;

/** Links for a set of entries, skipping people who have since been deleted. */
async function getJournalLinks(userId, entryIds) {
  if (!entryIds.length) return new Map();
  const result = await pool.query(
    `
    SELECT l.entry_id, l.person_id, l.excerpt, p.full_name AS person_name
    FROM journal_entry_people l
    INNER JOIN persons p ON p.id = l.person_id AND p.user_id = l.user_id
    WHERE l.user_id = $1 AND l.entry_id = ANY($2::int[])
    ORDER BY l.id ASC
    `,
    [userId, entryIds]
  );
  const byEntry = new Map();
  for (const row of result.rows) {
    if (!byEntry.has(row.entry_id)) byEntry.set(row.entry_id, []);
    byEntry.get(row.entry_id).push({
      person_id: row.person_id,
      person_name: row.person_name,
      excerpt: row.excerpt,
    });
  }
  return byEntry;
}

async function listJournalEntries(userId, { limit = 50, offset = 0 } = {}) {
  await ensureJournalSchema();
  const result = await pool.query(
    `
    SELECT ${JOURNAL_ENTRY_COLUMNS}
    FROM journal_entries e
    WHERE e.user_id = $1
    ORDER BY e.entry_date DESC, e.created_at DESC
    LIMIT $2 OFFSET $3
    `,
    [userId, limit, offset]
  );
  const links = await getJournalLinks(userId, result.rows.map((r) => r.id));
  return result.rows.map((entry) => ({ ...entry, people: links.get(entry.id) || [] }));
}

async function getJournalEntry(userId, entryId) {
  await ensureJournalSchema();
  const result = await pool.query(
    `
    SELECT ${JOURNAL_ENTRY_COLUMNS}
    FROM journal_entries e
    WHERE e.user_id = $1 AND e.id = $2
    LIMIT 1
    `,
    [userId, entryId]
  );
  const entry = result.rows[0];
  if (!entry) return null;
  const links = await getJournalLinks(userId, [entry.id]);
  return { ...entry, people: links.get(entry.id) || [] };
}

async function createJournalEntry(userId, { body, entryDate, prompt }) {
  await ensureJournalSchema();
  const result = await pool.query(
    `
    INSERT INTO journal_entries (user_id, body, entry_date, prompt)
    VALUES ($1, $2, $3, $4)
    RETURNING id
    `,
    [userId, body, entryDate, prompt || null]
  );
  return getJournalEntry(userId, result.rows[0].id);
}

/**
 * Update a reflection's text. Links named in removePersonIds (their excerpt no longer appears
 * in the new text) are dropped in the same transaction.
 */
async function updateJournalEntry(userId, entryId, { body, entryDate, prompt }, removePersonIds = []) {
  await ensureJournalSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `
      UPDATE journal_entries
      SET body = $1, entry_date = $2, prompt = $3, updated_at = NOW()
      WHERE id = $4 AND user_id = $5
      RETURNING id
      `,
      [body, entryDate, prompt || null, entryId, userId]
    );
    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    if (removePersonIds.length) {
      await client.query(
        `DELETE FROM journal_entry_people WHERE entry_id = $1 AND user_id = $2 AND person_id = ANY($3::int[])`,
        [entryId, userId, removePersonIds]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getJournalEntry(userId, entryId);
}

async function deleteJournalEntry(userId, entryId) {
  await ensureJournalSchema();
  const result = await pool.query(
    `DELETE FROM journal_entries WHERE id = $1 AND user_id = $2 RETURNING id`,
    [entryId, userId]
  );
  return result.rowCount > 0;
}

/**
 * Replace every person link on a reflection with the confirmed set from the review screen.
 * Throws "not found" errors when the entry or any person is not this user's.
 */
async function replaceJournalLinks(userId, entryId, links) {
  await ensureJournalSchema();
  const entry = await getJournalEntry(userId, entryId);
  if (!entry) throw new Error('Journal entry not found or access denied');

  const personIds = links.map((l) => l.personId);
  if (personIds.length) {
    const owned = await pool.query(
      `SELECT id FROM persons WHERE user_id = $1 AND id = ANY($2::int[])`,
      [userId, personIds]
    );
    if (owned.rowCount !== new Set(personIds).size) {
      throw new Error('Person not found or access denied');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM journal_entry_people WHERE entry_id = $1 AND user_id = $2`, [entryId, userId]);
    for (const link of links) {
      await client.query(
        `INSERT INTO journal_entry_people (entry_id, user_id, person_id, excerpt) VALUES ($1, $2, $3, $4)`,
        [entryId, userId, link.personId, link.excerpt]
      );
    }
    if (personIds.length) {
      // Same as a new prayer request: people with fresh reflections rise in the People list.
      await client.query(
        `UPDATE persons SET updated_at = NOW() WHERE user_id = $1 AND id = ANY($2::int[])`,
        [userId, personIds]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getJournalEntry(userId, entryId);
}

/** A person's passages from the journal, oldest first, so the profile reads as a journey. */
async function getReflectionsForPerson(userId, personId) {
  await ensureJournalSchema();
  const result = await pool.query(
    `
    SELECT l.entry_id, l.excerpt, to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.created_at
    FROM journal_entry_people l
    INNER JOIN journal_entries e ON e.id = l.entry_id AND e.user_id = l.user_id
    WHERE l.user_id = $1 AND l.person_id = $2
    ORDER BY e.entry_date ASC, e.created_at ASC
    `,
    [userId, personId]
  );
  return result.rows;
}

async function transferSessionPerson(userId, sessionId, newPersonId) {
  const session = await getSessionById(userId, sessionId);
  if (!session) throw new Error('Session not found or access denied');

  const person = await getPersonById(userId, newPersonId);
  if (!person) throw new Error('Target person not found or access denied');

  await pool.query(
    `
    UPDATE sessions
    SET person_id = $1
    WHERE id = $2 AND user_id = $3
    `,
    [newPersonId, sessionId, userId]
  );

  await pool.query(
    `
    UPDATE calendar_events
    SET person_id = $1
    WHERE user_id = $2 AND session_id = $3
    `,
    [newPersonId, userId, sessionId]
  );

  // Touch both persons so People tab ordering/updated labels reflect the transfer.
  await pool.query(
    `
    UPDATE persons
    SET updated_at = NOW()
    WHERE user_id = $1
      AND id = ANY($2::int[])
    `,
    [userId, [Number(session.person_id), Number(newPersonId)]]
  );

  const updatedSession = await getSessionById(userId, sessionId);
  return {
    session: updatedSession,
    oldPersonId: session.person_id,
    newPerson: person,
  };
}

async function deleteSession(userId, sessionId) {
  const sid = Number(sessionId);
  const uid = Number(userId);
  const session = await getSessionById(uid, sid);
  if (!session) {
    throw new Error('Session not found or access denied');
  }
  await pool.query(
    `
    DELETE FROM calendar_events
    WHERE user_id = $1 AND session_id = $2
    `,
    [uid, sid]
  );
  await pool.query(
    `
    DELETE FROM sessions
    WHERE id = $1 AND user_id = $2
    `,
    [sid, uid]
  );
  return { deletedId: sid, personId: session.person_id };
}

async function updateSessionNotes(sessionId, notes) {
  const result = await pool.query(
    `
    UPDATE sessions
    SET notes = $1
    WHERE id = $2
    RETURNING id
    `,
    [notes, sessionId]
  );
  return { id: sessionId, changes: result.rowCount };
}

async function getGroupById(userId, groupId) {
  const result = await pool.query(
    `
    SELECT *
    FROM groups
    WHERE id = $1 AND user_id = $2
    LIMIT 1
    `,
    [groupId, userId]
  );
  return result.rows[0] || null;
}

async function createGroup(userId, name) {
  try {
    try {
      const result = await pool.query(
        `
        INSERT INTO groups (user_id, name)
        VALUES ($1, $2)
        RETURNING *
        `,
        [userId, name.trim()]
      );
      return result.rows[0];
    } catch (err) {
      if (!isIdNotNullViolation(err)) throw err;
      const nextId = await getNextId('groups');
      const result = await pool.query(
        `
        INSERT INTO groups (id, user_id, name)
        VALUES ($1, $2, $3)
        RETURNING *
        `,
        [nextId, userId, name.trim()]
      );
      return result.rows[0];
    }
  } catch (err) {
    if (err.message && err.message.includes('duplicate key')) {
      throw new Error('Group with this name already exists');
    }
    throw err;
  }
}

async function updateGroup(userId, groupId, name) {
  try {
    const result = await pool.query(
      `
      UPDATE groups
      SET name = $1
      WHERE id = $2 AND user_id = $3
      RETURNING *
      `,
      [name.trim(), groupId, userId]
    );
    return result.rows[0] || null;
  } catch (err) {
    if (err.message && err.message.includes('duplicate key')) {
      throw new Error('Group with this name already exists');
    }
    throw err;
  }
}

async function deleteGroup(userId, groupId) {
  await pool.query(
    `
    DELETE FROM groups
    WHERE id = $1 AND user_id = $2
    `,
    [groupId, userId]
  );
}

async function addPersonToGroup(userId, personId, groupId) {
  // Verify person and group belong to user
  const person = await getPersonById(userId, personId);
  if (!person) throw new Error('Person not found');

  const group = await getGroupById(userId, groupId);
  if (!group) throw new Error('Group not found');

  await pool.query(
    `
    INSERT INTO person_groups (person_id, group_id)
    VALUES ($1, $2)
    ON CONFLICT (person_id, group_id) DO NOTHING
    `,
    [personId, groupId]
  );
}

async function removePersonFromGroup(userId, personId, groupId) {
  await pool.query(
    `
    DELETE FROM person_groups
    WHERE person_id = $1 AND group_id = $2
    `,
    [personId, groupId]
  );
}

module.exports = {
  pool,
  ensureAuthSchema,
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserByUsernameOrEmail,
  getUserById,
  getUserCredentialsForDeletion,
  markUserEmailVerified,
  updateUserPassword,
  updateUserEmail,
  markPrivacyConsentGiven,
  markOnboardingCompleted,
  updateUserName,
  updateUsername,
  deleteUserAndAllData,
  getAllPersons,
  getPersonById,
  getAllPersonsWithGroups,
  getSessionsByPerson,
  getPersonMetadata,
  getAllPersonData,
  getAllPersonDataForPersonIds,
  getAllGroups,
  getPersonsInGroup,
  getCalendarEvents,
  getCalendarEventsByDate,
  updateSessionNotes,
  createPerson,
  findPersonByName,
  findSimilarNames,
  updatePersonTimestamp,
  updatePerson,
  deletePerson,
  createSession,
  getSessionById,
  deleteSession,
  createCalendarEvent,
  updateCalendarEvent,
  setPersonMetadata,
  updateSession,
  markSessionAnswered,
  getVersesBySessionIds,
  addSessionVerse,
  deleteSessionVerse,
  getReminders,
  getReminderById,
  createReminder,
  updateReminder,
  deleteReminder,
  listJournalEntries,
  getJournalEntry,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  replaceJournalLinks,
  getReflectionsForPerson,
  transferSessionPerson,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  addPersonToGroup,
  removePersonFromGroup,
};

