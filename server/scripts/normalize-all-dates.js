/**
 * Migration script to normalize all relative dates in existing data
 * This script:
 * 1. Normalizes dates in all session notes
 * 2. Normalizes dates in all metadata
 * 3. Updates the database with normalized values
 */

require('dotenv').config();
const { db, dbHelpers } = require('../database');
const aiService = require('../services/aiService');

async function normalizeAllDates() {
  console.log('Starting date normalization migration...\n');

  try {
    // 1. Normalize dates in all session notes
    console.log('Step 1: Normalizing dates in session notes...');
    const sessions = await dbHelpers.getAllSessions();
    console.log(`Found ${sessions.length} sessions to process`);

    let sessionsUpdated = 0;
    let sessionsSkipped = 0;

    for (const session of sessions) {
      if (!session.notes || session.notes.trim() === '') {
        sessionsSkipped++;
        continue;
      }

      const sessionDate = new Date(session.created_at);
      console.log(`\nProcessing session ${session.id} (created: ${sessionDate.toISOString()})`);

      // Check if notes contain relative dates
      const relativeDatePatterns = /\b(tomorrow|yesterday|today|next week|last week|in \d+ days?|next month|last month|next year|last year|this week|this month|this year)\b/gi;
      if (!relativeDatePatterns.test(session.notes)) {
        console.log(`  No relative dates found, skipping`);
        sessionsSkipped++;
        continue;
      }

      try {
        const normalizedNotes = await aiService.normalizeDatesInText(session.notes, sessionDate);
        
        if (normalizedNotes !== session.notes) {
          await dbHelpers.updateSessionNotes(session.id, normalizedNotes);
          console.log(`  ✓ Updated session notes`);
          sessionsUpdated++;
        } else {
          console.log(`  No changes needed`);
          sessionsSkipped++;
        }
      } catch (error) {
        console.error(`  ✗ Error normalizing session ${session.id}:`, error.message);
      }
    }

    console.log(`\nSession notes: ${sessionsUpdated} updated, ${sessionsSkipped} skipped`);

    // 2. Normalize dates in all metadata
    console.log('\nStep 2: Normalizing dates in metadata...');
    const allMetadata = await dbHelpers.getAllMetadata();
    console.log(`Found ${allMetadata.length} metadata entries to process`);

    // Get all sessions grouped by person to get reference dates
    const personSessions = {};
    for (const session of sessions) {
      if (!personSessions[session.person_id]) {
        personSessions[session.person_id] = [];
      }
      personSessions[session.person_id].push(session);
    }

    let metadataUpdated = 0;
    let metadataSkipped = 0;

    for (const metadata of allMetadata) {
      // Only process date-related metadata
      if (metadata.key !== 'date' && metadata.key !== 'date_original') {
        metadataSkipped++;
        continue;
      }

      if (!metadata.value || metadata.value.trim() === '') {
        metadataSkipped++;
        continue;
      }

      // Check if already normalized (contains YYYY-MM-DD)
      if (/\d{4}-\d{2}-\d{2}/.test(metadata.value)) {
        metadataSkipped++;
        continue;
      }

      // Check if contains relative dates
      const relativeDatePatterns = /\b(tomorrow|yesterday|today|next week|last week|in \d+ days?|in (the )?next few days|in a few days|in (the )?next couple of days|next month|last month|next year|last year|this week|this month|this year)\b/gi;
      if (!relativeDatePatterns.test(metadata.value)) {
        metadataSkipped++;
        continue;
      }

      // Use the metadata item's created_at as reference date (when it was recorded)
      // This ensures "tomorrow" is relative to when the metadata was created, not today
      const referenceDate = metadata.created_at 
        ? new Date(metadata.created_at)
        : new Date();

      console.log(`\nProcessing metadata ${metadata.id} (person: ${metadata.person_id}, reference: ${referenceDate.toISOString()})`);

      try {
        // Extract context if present (e.g., "birthday: tomorrow")
        let dateString = metadata.value;
        let context = null;
        const colonIndex = dateString.indexOf(':');
        if (colonIndex > 0) {
          context = dateString.substring(0, colonIndex).trim();
          dateString = dateString.substring(colonIndex + 1).trim();
        }

        // Normalize the date
        const normalizedDates = await aiService.normalizeDates([dateString], referenceDate);
        
        if (normalizedDates.length > 0 && normalizedDates[0].normalized) {
          const normalized = normalizedDates[0];
          const newValue = context
            ? `${context}: ${normalized.normalized} (${normalized.readable})`
            : `${normalized.normalized} (${normalized.readable})`;
          
          await dbHelpers.updateMetadataValue(metadata.id, newValue);
          console.log(`  ✓ Updated: "${metadata.value}" → "${newValue}"`);
          metadataUpdated++;
        } else {
          console.log(`  No normalization possible for: "${metadata.value}"`);
          metadataSkipped++;
        }
      } catch (error) {
        console.error(`  ✗ Error normalizing metadata ${metadata.id}:`, error.message);
      }
    }

    console.log(`\nMetadata: ${metadataUpdated} updated, ${metadataSkipped} skipped`);

    console.log('\n✅ Date normalization migration completed!');
    console.log(`Summary:`);
    console.log(`  Sessions updated: ${sessionsUpdated}`);
    console.log(`  Sessions skipped: ${sessionsSkipped}`);
    console.log(`  Metadata updated: ${metadataUpdated}`);
    console.log(`  Metadata skipped: ${metadataSkipped}`);

  } catch (error) {
    console.error('Fatal error during migration:', error);
    throw error;
  }
}

// Run the migration
normalizeAllDates()
  .then(() => {
    console.log('\nMigration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
