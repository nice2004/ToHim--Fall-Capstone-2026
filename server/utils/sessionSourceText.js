/**
 * Merge session.notes and session.transcript for search, summaries, and query context.
 * Avoids whitespace-only `notes` hiding real `transcript` content (truthy-but-empty notes).
 */
function mergeSessionNotesTranscript(session) {
  if (!session || typeof session !== 'object') return '';
  const nRaw = session.notes;
  const tRaw = session.transcript;
  const n = nRaw != null && String(nRaw).trim() ? String(nRaw).trim() : '';
  const t = tRaw != null && String(tRaw).trim() ? String(tRaw).trim() : '';
  if (n && t) {
    return n === t ? n : `${n}\n\n${t}`;
  }
  return n || t || '';
}

/** Light cleanup for summary prompts (avoid markdown noise in short snippets). */
function stripLightMarkdown(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\*\*/g, '').replace(/#{1,6}\s?/g, '').trim();
}

module.exports = { mergeSessionNotesTranscript, stripLightMarkdown };
