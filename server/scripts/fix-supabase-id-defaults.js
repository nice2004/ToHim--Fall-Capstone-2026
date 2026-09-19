const { Pool } = require('pg');

// One-time fix for tables migrated with `id INTEGER PRIMARY KEY` (no auto-increment).
// This attaches sequences + DEFAULT nextval(...) so inserts that omit `id` work again.
//
// Usage (from server directory):
//   DATABASE_URL='postgresql://...' node scripts/fix-supabase-id-defaults.js

const tables = ['persons', 'sessions', 'person_metadata', 'groups', 'calendar_events'];

async function ensureIdDefaults(client, tableName) {
  console.log(`[Fix] ${tableName}: checking id sequence...`);

  // If pg_get_serial_sequence returns null, the column wasn't created as serial/identity.
  const seqRes = await client.query(
    `SELECT pg_get_serial_sequence('public.${tableName}', 'id') AS seq`
  );
  const seq = seqRes.rows[0]?.seq || null;

  const maxRes = await client.query(
    `SELECT COALESCE(MAX(id), 0) AS max_id FROM public.${tableName}`
  );
  const maxId = Number(maxRes.rows[0]?.max_id || 0);

  if (!seq) {
    const fallbackSeqName = `${tableName}_id_seq`;
    // Create our own sequence and attach as DEFAULT
    console.log(`[Fix] ${tableName}: no sequence found, creating ${fallbackSeqName}...`);
    await client.query(
      `CREATE SEQUENCE IF NOT EXISTS public.${fallbackSeqName} START WITH 1 INCREMENT BY 1`
    );
    await client.query(
      `ALTER TABLE public.${tableName} ALTER COLUMN id SET DEFAULT nextval('public.${fallbackSeqName}')`
    );
    // setval takes the "current" value; next nextval will be maxId+1
    await client.query(
      `SELECT setval('public.${fallbackSeqName}', ${maxId === 0 ? 1 : maxId}, true)`
    );
    console.log(`[Fix] ${tableName}.id: created sequence ${fallbackSeqName} (max_id=${maxId})`);
    return;
  }

  // Attach/default already exists; just ensure it is set and reset to max.
  console.log(`[Fix] ${tableName}: updating existing sequence default: ${seq} (max_id=${maxId})...`);
  await client.query(
    `ALTER TABLE public.${tableName} ALTER COLUMN id SET DEFAULT nextval('${seq}')`
  );
  await client.query(
    `SELECT setval('${seq}', ${maxId === 0 ? 1 : maxId}, true)`
  );
  console.log(`[Fix] ${tableName}.id: updated existing sequence ${seq} (max_id=${maxId})`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Please set it to your Supabase Postgres connection string.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('Fixing auto-increment defaults for:', tables.join(', '));

    const client = await pool.connect();
    try {
      // Prevent long-running DDL from hanging forever
      await client.query(`SET statement_timeout = '60s'`);

      for (const t of tables) {
        await ensureIdDefaults(client, t);
      }
    } finally {
      client.release();
    }
    console.log('Done.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exitCode = 1;
});

