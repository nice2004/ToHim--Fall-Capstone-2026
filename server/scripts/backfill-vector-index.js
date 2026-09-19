/**
 * Backfill script to populate the vector index from existing sessions.
 *
 * This script:
 * - Iterates over all users
 * - For each person and their sessions, builds knowledge chunks
 * - Upserts those chunks into the configured vector store
 *
 * It is safe to run multiple times; chunks use stable IDs so later runs update
 * existing records rather than duplicating them.
 */

require('dotenv').config();

const { db, dbHelpers } = require('../database');
const vectorStore = require('../services/vectorStore');
const { buildSessionChunks } = require('../services/chunkBuilder');
const { mergeSessionNotesTranscript } = require('../utils/sessionSourceText');

async function getAllUsers() {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, username FROM users', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function backfillForUser(user) {
  const userId = user.id;
  console.log(`\n=== Backfilling user ${user.username} (ID: ${userId}) ===`);

  const persons = await dbHelpers.getAllPersons(userId);
  console.log(`Found ${persons.length} person(s)`);

  let totalSessions = 0;
  let totalChunks = 0;

  // eslint-disable-next-line no-restricted-syntax
  for (const person of persons) {
    // eslint-disable-next-line no-await-in-loop
    const personData = await dbHelpers.getAllPersonData(userId, person.id);
    const { sessions } = personData;

    if (!sessions || sessions.length === 0) continue;

    console.log(`Person ${person.full_name} has ${sessions.length} session(s)`);

    // eslint-disable-next-line no-restricted-syntax
    for (const session of sessions) {
      const sessionSummary = mergeSessionNotesTranscript(session);
      const normalizedDates = []; // legacy data may not have normalizedDates available here

      const chunks = buildSessionChunks({
        userId,
        person,
        session,
        sessionSummary,
        normalizedDates,
      });

      if (chunks.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await vectorStore.upsertChunks(userId, chunks);
        totalChunks += chunks.length;
      }

      totalSessions += 1;
    }
  }

  console.log(
    `User ${user.username}: indexed ${totalSessions} session(s) into ${totalChunks} chunk(s)`
  );
}

async function backfillVectorIndex() {
  if (!vectorStore.isEnabled()) {
    console.log(
      'Vector search is not enabled. Set USE_VECTOR_SEARCH=true and configure PINECONE_* env vars before running this script.'
    );
    process.exit(0);
  }

  try {
    const users = await getAllUsers();
    console.log(`Found ${users.length} user(s) to backfill`);

    // eslint-disable-next-line no-restricted-syntax
    for (const user of users) {
      // eslint-disable-next-line no-await-in-loop
      await backfillForUser(user);
    }

    console.log('\n✅ Vector backfill completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Vector backfill failed:', error);
    process.exit(1);
  }
}

backfillVectorIndex();

