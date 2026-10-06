/**
 * Rewrite existing prayer-request notes in the user's own first-person voice.
 *
 * Older notes were generated as third-person reports ("The person is hoping that the week of
 * October 5, 2026 will be better for her") and some picked up model chatter ("Here is the
 * normalized text…"). This regenerates each session's `notes` from its original `transcript`
 * using the current prompt, then normalizes relative dates against the session's own date.
 *
 * Safe by default:
 *   - Dry run unless --apply is passed (prints before/after for every session).
 *   - With --apply, every session's current notes/transcript are first saved to a backup JSON
 *     file next to this script.
 *   - Only `notes` is rewritten, except for sessions damaged by the old in-app editor (which
 *     saved "<AI note>\n\n<original words>" into both fields): their original words are recovered
 *     from the final paragraph and restored as the transcript.
 *   - Other sessions whose notes equal their transcript are genuine hand edits; they are
 *     skipped and listed at the end for manual review.
 *
 * Usage (from the repo root):
 *   node server/scripts/personalize-notes.js            # preview
 *   node server/scripts/personalize-notes.js --apply    # write changes
 *   node server/scripts/personalize-notes.js --apply --person 12   # one person only
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, updateSession, updateSessionNotes } = require('../postgres');
const aiService = require('../services/aiService');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const personArgIndex = args.indexOf('--person');
const PERSON_ID = personArgIndex >= 0 ? Number(args[personArgIndex + 1]) : null;
// Resolve "today" / "this week" in the timezone the requests were recorded in (this machine's).
const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * For text corrupted by the old editor ("<AI note>\n\n<original words>" saved into both fields),
 * return the original words (the final plain paragraph), or null if the text doesn't have that shape.
 */
function recoverOriginalWords(text) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length < 2) return null;
  const last = paragraphs[paragraphs.length - 1];
  const before = paragraphs.slice(0, -1).join('\n');
  const looksLikeAiNote =
    /^(?:sure|certainly|here (?:is|are))\b/i.test(paragraphs[0]) ||
    /^\s*["“]?\s*[-*•]\s/m.test(before) ||
    /\*\*/.test(before) ||
    /\bthe (?:person|user|speaker)\b/i.test(before);
  const lastLooksPlain = !/^\s*[-*•#]/.test(last) && !/\*\*/.test(last);
  return looksLikeAiNote && lastLooksPlain ? last : null;
}

async function main() {
  console.log(APPLY ? 'Rewriting notes (changes WILL be saved)…\n' : 'Dry run — nothing will be saved. Pass --apply to write.\n');

  const params = [];
  let where = "WHERE s.transcript IS NOT NULL AND TRIM(s.transcript) <> ''";
  if (PERSON_ID) {
    params.push(PERSON_ID);
    where += ` AND s.person_id = $${params.length}`;
  }
  const { rows: sessions } = await pool.query(
    `
    SELECT s.id, s.user_id, s.notes, s.transcript, s.created_at, p.full_name
    FROM sessions s
    JOIN persons p ON p.id = s.person_id
    ${where}
    ORDER BY s.created_at ASC
    `,
    params
  );
  console.log(`Found ${sessions.length} prayer request(s) with a transcript.\n`);

  if (APPLY) {
    const file = path.join(__dirname, `personalize-notes-backup-${Date.now()}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(sessions.map(({ id, notes, transcript }) => ({ id, notes, transcript })), null, 2)
    );
    console.log(`Backup of current notes/transcripts saved to ${file}
`);
  }

  let updated = 0;
  const skippedEdited = [];

  for (const session of sessions) {
    const notes = (session.notes || '').trim();
    let transcript = session.transcript.trim();
    let repairedTranscript = null;

    if (notes && notes === transcript) {
      // The old in-app editor saved "<AI note>\n\n<original words>" into BOTH fields, so the
      // original words were lost from `transcript`. When the text clearly has that shape
      // (an AI note block before a final plain paragraph), recover the final paragraph as the
      // transcript. Anything else was a genuine hand edit and is left alone.
      repairedTranscript = recoverOriginalWords(transcript);
      if (!repairedTranscript) {
        skippedEdited.push(session);
        continue;
      }
      transcript = repairedTranscript;
    }

    try {
      let newNotes = await aiService.generateNotes(transcript, null, null, session.full_name);
      newNotes = await aiService.normalizeDatesInText(newNotes, new Date(session.created_at), LOCAL_TIME_ZONE);
      if (!newNotes || (newNotes.trim() === notes && !repairedTranscript)) continue;

      console.log(`— Session ${session.id} (${session.full_name}, ${new Date(session.created_at).toLocaleDateString()})`);
      console.log(`  before: ${notes.replace(/\s+/g, ' ').slice(0, 220) || '(empty)'}`);
      if (repairedTranscript) console.log(`  words:  ${repairedTranscript} (recovered original words)`);
      console.log(`  after:  ${newNotes.replace(/\s+/g, ' ').slice(0, 220)}\n`);

      if (APPLY) {
        if (repairedTranscript) {
          await updateSession(session.user_id, session.id, { notes: newNotes.trim(), transcript: repairedTranscript });
        } else {
          await updateSessionNotes(session.id, newNotes.trim());
        }
      }
      updated++;
    } catch (error) {
      console.error(`  ✗ Session ${session.id} failed:`, error.message);
    }
  }

  console.log(`${APPLY ? 'Updated' : 'Would update'} ${updated} prayer request(s).`);
  if (skippedEdited.length > 0) {
    console.log(
      `\nSkipped ${skippedEdited.length} request(s) that were edited by hand in the app ` +
        '(review these with the edit button if they still read impersonally):'
    );
    skippedEdited.forEach((s) => console.log(`  - Session ${s.id} (${s.full_name})`));
  }
}

main()
  .catch((error) => {
    console.error('Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
