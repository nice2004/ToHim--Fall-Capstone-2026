/**
 * One-time fix script: correct calendar event dates that were stored in UTC instead of local time.
 *
 * The bug: createCalendarEvent used Date.toISOString() which returns UTC midnight.
 * For any user in a timezone behind UTC, a session recorded at e.g. 11pm local time
 * was stored as the NEXT day's date (because UTC was already on the next calendar day).
 *
 * This script:
 * 1. Finds every 'session' type calendar event.
 * 2. Looks up the corresponding session's created_at timestamp.
 * 3. Re-computes the local date from that timestamp.
 * 4. Updates event_date if it doesn't match.
 *
 * Run once: node server/scripts/fix-calendar-dates.js
 */

require('dotenv').config();
const { db } = require('../database');

function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function run() {
  console.log('=== fix-calendar-dates.js ===');
  console.log(`Local timezone offset: UTC${-new Date().getTimezoneOffset() / 60}`);
  console.log('');

  // Fetch all session-type calendar events joined with their session timestamp
  const events = await new Promise((resolve, reject) => {
    db.all(
      `SELECT ce.id, ce.event_date, s.created_at as session_created_at
       FROM calendar_events ce
       LEFT JOIN sessions s ON ce.session_id = s.id
       WHERE ce.event_type = 'session' AND s.created_at IS NOT NULL`,
      [],
      (err, rows) => { if (err) reject(err); else resolve(rows); }
    );
  });

  console.log(`Found ${events.length} session calendar events to check.`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const event of events) {
    try {
      // SQLite CURRENT_TIMESTAMP is UTC — append 'Z' to force correct UTC parsing
      const sessionDate = new Date(event.session_created_at.replace(' ', 'T') + 'Z');
      const correctDate = toLocalDateStr(sessionDate);
      const storedDate = String(event.event_date).split('T')[0];

      if (correctDate !== storedDate) {
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE calendar_events SET event_date = ? WHERE id = ?',
            [correctDate, event.id],
            (err) => { if (err) reject(err); else resolve(); }
          );
        });
        console.log(`  ✓ Event ${event.id}: ${storedDate} → ${correctDate}`);
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`  ✗ Event ${event.id}: ${err.message}`);
      errors++;
    }
  }

  console.log('');
  console.log(`Done. Updated: ${updated}, Already correct: ${skipped}, Errors: ${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
