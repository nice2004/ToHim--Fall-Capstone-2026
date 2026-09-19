const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');

// This script copies all users from the local SQLite database (tabbe.db)
// into the Supabase Postgres "users" table, preserving user IDs so that
// existing Pinecone vectors keyed by userId still match.
//
// Usage (from the server directory):
//   DATABASE_URL='postgres://...' node scripts/migrate-sqlite-users-to-supabase.js

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Please set it to your Supabase Postgres connection string.');
    process.exit(1);
  }

  // Open SQLite database (same as server/database.js)
  const DB_PATH = path.join(__dirname, '..', 'tabbe.db');
  console.log('Using SQLite DB at:', DB_PATH);

  const sqliteDb = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Error opening SQLite database:', err.message);
      process.exit(1);
    }
  });

  // Wrap sqlite all() in a Promise
  const getAllSqliteUsers = () =>
    new Promise((resolve, reject) => {
      sqliteDb.all(
        'SELECT id, username, password_hash, name, created_at FROM users ORDER BY id ASC',
        [],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Fetching users from SQLite...');
    const users = await getAllSqliteUsers();
    console.log(`Found ${users.length} user(s) in SQLite.`);

    if (users.length === 0) {
      console.log('No users to migrate. Exiting.');
      return;
    }

    console.log('Ensuring users table exists in Postgres...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('Migrating users to Supabase Postgres...');
    let migrated = 0;

    // Use a single client for all inserts
    const client = await pool.connect();
    try {
      for (const user of users) {
        // created_at may be TEXT in SQLite; let Postgres parse it
        const createdAt = user.created_at || null;

        await client.query(
          `
          INSERT INTO users (id, username, password_hash, name, created_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE
          SET
            username = EXCLUDED.username,
            password_hash = EXCLUDED.password_hash,
            name = EXCLUDED.name,
            created_at = EXCLUDED.created_at
          `,
          [user.id, user.username, user.password_hash, user.name, createdAt]
        );

        migrated += 1;
        if (migrated % 10 === 0) {
          console.log(`Migrated ${migrated}/${users.length} users...`);
        }
      }

      // Ensure the sequence is ahead of the max id, so future inserts work
      await client.query(
        `
        SELECT setval(
          pg_get_serial_sequence('users', 'id'),
          (SELECT COALESCE(MAX(id), 1) FROM users)
        )
        `
      );
    } finally {
      client.release();
    }

    console.log(`Done. Migrated ${migrated} user(s) to Supabase Postgres.`);
  } catch (err) {
    console.error('Error during migration:', err);
    process.exitCode = 1;
  } finally {
    sqliteDb.close();
    await pool.end();
  }
}

main();

