/**
 * Migration script to populate calendar events from existing sessions and metadata
 * This script:
 * 1. Creates session date events for all existing sessions
 * 2. Creates referenced date events from metadata dates
 * 3. Skips events that already exist
 */

require('dotenv').config();
const { db, dbHelpers } = require('../database');

// Convert a Date to YYYY-MM-DD using local timezone (not UTC)
function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Helper to extract date from metadata value
function extractDateFromMetadata(value) {
  if (!value || typeof value !== 'string') return null;
  
  // Look for YYYY-MM-DD pattern
  const datePattern = /(\d{4}-\d{2}-\d{2})/;
  const match = value.match(datePattern);
  
  if (match) {
    return match[1]; // Return the YYYY-MM-DD date
  }
  
  return null;
}

// Helper to extract context from metadata value
function extractContextFromMetadata(value) {
  if (!value || typeof value !== 'string') return null;
  
  // Check if it has context format: "context: YYYY-MM-DD (readable)"
  const colonIndex = value.indexOf(':');
  if (colonIndex > 0) {
    const context = value.substring(0, colonIndex).trim();
    // Only return context if it's not just a date pattern
    if (!/\d{4}-\d{2}-\d{2}/.test(context)) {
      return context;
    }
  }
  
  return null;
}

// Check if calendar event already exists
async function eventExists(userId, personId, sessionId, eventType, eventDate) {
  return new Promise((resolve, reject) => {
    const dateStr = eventDate instanceof Date
      ? toLocalDateStr(eventDate)
      : eventDate;
    
    db.get(
      `SELECT id FROM calendar_events 
       WHERE user_id = ? AND person_id = ? AND session_id = ? 
       AND event_type = ? AND event_date = ?`,
      [userId, personId, sessionId, eventType, dateStr],
      (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      }
    );
  });
}

async function populateCalendarEvents() {
  console.log('Starting calendar events population...\n');

  try {
    // Get all users
    const users = await new Promise((resolve, reject) => {
      db.all('SELECT id, username FROM users', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    console.log(`Found ${users.length} user(s) to process\n`);

    let totalSessionEvents = 0;
    let totalReferencedEvents = 0;
    let skippedSessionEvents = 0;
    let skippedReferencedEvents = 0;
    let errors = 0;

    for (const user of users) {
      console.log(`\nProcessing user: ${user.username} (ID: ${user.id})`);
      console.log('='.repeat(50));

      // Step 1: Create session date events
      console.log('\nStep 1: Creating session date events...');
      const sessions = await dbHelpers.getAllSessions(user.id);
      console.log(`Found ${sessions.length} sessions`);

      for (const session of sessions) {
        if (!session.person_id) {
          console.log(`  Skipping session ${session.id} (no person_id)`);
          continue;
        }

        try {
          // SQLite CURRENT_TIMESTAMP is UTC — append 'Z' to force correct UTC parsing
          const sessionDate = new Date(session.created_at.replace(' ', 'T') + 'Z');
          const dateStr = toLocalDateStr(sessionDate);

          // Check if event already exists
          const exists = await eventExists(
            user.id,
            session.person_id,
            session.id,
            'session',
            dateStr
          );

          if (exists) {
            skippedSessionEvents++;
            continue;
          }

          await dbHelpers.createCalendarEvent(
            user.id,
            session.person_id,
            session.id,
            'session',
            sessionDate,
            null
          );
          console.log(`  ✓ Created session event for session ${session.id} (${dateStr})`);
          totalSessionEvents++;
        } catch (error) {
          console.error(`  ✗ Error creating session event for session ${session.id}:`, error.message);
          errors++;
        }
      }

      // Step 2: Create referenced date events from metadata
      console.log('\nStep 2: Creating referenced date events from metadata...');
      
      // Get all metadata for this user's persons
      const allMetadata = await new Promise((resolve, reject) => {
        db.all(
          `SELECT pm.*, p.user_id 
           FROM person_metadata pm
           INNER JOIN persons p ON pm.person_id = p.id
           WHERE p.user_id = ? AND pm.key = 'date'`,
          [user.id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });

      console.log(`Found ${allMetadata.length} date metadata entries`);

      // Group metadata by person to get sessions for context
      const personSessions = {};
      for (const session of sessions) {
        if (session.person_id) {
          if (!personSessions[session.person_id]) {
            personSessions[session.person_id] = [];
          }
          personSessions[session.person_id].push(session);
        }
      }

      for (const metadata of allMetadata) {
        try {
          // Extract date from metadata value
          const dateStr = extractDateFromMetadata(metadata.value);
          if (!dateStr) {
            console.log(`  Skipping metadata ${metadata.id} (no date found): "${metadata.value}"`);
            continue;
          }

          // Validate date
          const eventDate = new Date(dateStr);
          if (isNaN(eventDate.getTime())) {
            console.log(`  Skipping metadata ${metadata.id} (invalid date): "${metadata.value}"`);
            continue;
          }

          // Get context if available
          const context = extractContextFromMetadata(metadata.value);
          const summary = context || null;

          // Find the most recent session for this person before the metadata was created
          // This helps us associate the referenced date with the right session
          const sessionsForPerson = personSessions[metadata.person_id] || [];
          let associatedSession = null;
          
          if (sessionsForPerson.length > 0) {
            // Find session closest to when metadata was created
            const metadataCreatedAt = new Date(metadata.created_at);
            const sortedSessions = sessionsForPerson.sort((a, b) => {
              const dateA = new Date(a.created_at);
              const dateB = new Date(b.created_at);
              return Math.abs(dateA - metadataCreatedAt) - Math.abs(dateB - metadataCreatedAt);
            });
            associatedSession = sortedSessions[0];
          }

          // Check if event already exists
          const exists = await eventExists(
            user.id,
            metadata.person_id,
            associatedSession?.id || null,
            'referenced',
            dateStr
          );

          if (exists) {
            skippedReferencedEvents++;
            continue;
          }

          await dbHelpers.createCalendarEvent(
            user.id,
            metadata.person_id,
            associatedSession?.id || null,
            'referenced',
            eventDate,
            summary
          );
          console.log(`  ✓ Created referenced event for person ${metadata.person_id} (${dateStr})${summary ? ` - ${summary}` : ''}`);
          totalReferencedEvents++;
        } catch (error) {
          console.error(`  ✗ Error creating referenced event for metadata ${metadata.id}:`, error.message);
          errors++;
        }
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('\n✅ Calendar events population completed!');
    console.log(`Summary:`);
    console.log(`  Session events created: ${totalSessionEvents}`);
    console.log(`  Session events skipped (already exist): ${skippedSessionEvents}`);
    console.log(`  Referenced events created: ${totalReferencedEvents}`);
    console.log(`  Referenced events skipped (already exist): ${skippedReferencedEvents}`);
    console.log(`  Errors: ${errors}`);

  } catch (error) {
    console.error('Fatal error during migration:', error);
    throw error;
  }
}

// Run the migration
populateCalendarEvents()
  .then(() => {
    console.log('\nMigration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
