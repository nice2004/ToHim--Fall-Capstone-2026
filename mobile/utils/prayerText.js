/**
 * A prayer request (session) stores two texts:
 *   - `notes`: ToHim's short, cleaned-up note written from the transcript
 *   - `transcript`: exactly what the user said or typed
 * Showing both together repeated every detail twice, so screens show the note,
 * and the detail screen shows the original words separately (only when they differ).
 */

function clean(text) {
  return typeof text === 'string' ? text.trim() : '';
}

/** The note to display for a prayer request (falls back to the transcript). */
export function getRequestNote(session) {
  const notes = clean(session?.notes);
  const transcript = clean(session?.transcript);
  if (!notes) return transcript;
  // Older in-app edits saved "note + transcript" into notes; drop the trailing copy.
  if (transcript && notes !== transcript && notes.endsWith(transcript)) {
    const trimmed = notes.slice(0, -transcript.length).trim();
    if (trimmed) return trimmed;
  }
  return notes;
}

/** The user's original words, or '' when they'd just repeat the note. */
export function getOriginalWords(session) {
  const transcript = clean(session?.transcript);
  const note = getRequestNote(session);
  if (!transcript || transcript === note) return '';
  return transcript;
}
