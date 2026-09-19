const { mergeSessionNotesTranscript } = require('../utils/sessionSourceText');

/** Pinecone metadata per vector has a size budget; keep stored text within a safe bound. */
const MAX_CHUNK_BODY_CHARS = 12000;

function formatDateReadable(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function buildSessionChunks({ userId, person, session, sessionSummary = null, normalizedDates = [] }) {
  const chunks = [];

  const sessionDate = new Date(session.created_at);
  const sessionDateReadable = formatDateReadable(sessionDate);

  const baseTitle = sessionDateReadable
    ? `Session with ${person.full_name} on ${sessionDateReadable}`
    : `Session with ${person.full_name}`;

  const textParts = [];
  textParts.push(baseTitle);
  // Index full merged notes+transcript for semantic search (not the short calendar blurb only).
  let body = mergeSessionNotesTranscript(session);
  if (!body && sessionSummary && sessionSummary.trim()) {
    body = sessionSummary.trim();
  }
  if (body) {
    const cleaned = body.replace(/\*\*/g, '').replace(/#{1,6}\s?/g, '').trim();
    const capped =
      cleaned.length > MAX_CHUNK_BODY_CHARS
        ? `${cleaned.substring(0, MAX_CHUNK_BODY_CHARS)}...`
        : cleaned;
    textParts.push('');
    textParts.push(capped);
  }

  chunks.push({
    userId,
    personId: person.id,
    sessionId: session.id,
    chunkType: 'session_note',
    date: sessionDate.toISOString().split('T')[0],
    text: textParts.join('\n'),
    localIndex: 0,
  });

  normalizedDates.forEach((dateInfo, index) => {
    if (!dateInfo || !dateInfo.normalized) return;
    const dateReadable = dateInfo.readable || formatDateReadable(dateInfo.normalized) || dateInfo.normalized;

    const lines = [];
    lines.push(`Date for ${person.full_name}: ${dateReadable}`);
    if (dateInfo.context) {
      lines.push('');
      lines.push(`Context: ${dateInfo.context}`);
    }
    if (sessionSummary && sessionSummary.trim()) {
      lines.push('');
      lines.push('Related session details:');
      const truncated = sessionSummary.length > 400
        ? `${sessionSummary.substring(0, 400)}...`
        : sessionSummary;
      lines.push(truncated);
    }

    chunks.push({
      userId,
      personId: person.id,
      sessionId: session.id,
      chunkType: 'date_fact',
      date: dateInfo.normalized,
      text: lines.join('\n'),
      extraMetadata: {
        context: dateInfo.context || null,
      },
      // deterministic id seed will be constructed in vectorStore
      localIndex: index,
    });
  });

  return chunks;
}

module.exports = {
  buildSessionChunks,
};

