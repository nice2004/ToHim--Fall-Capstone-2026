/**
 * A short label for what is happening on a prayer request's date ("Exam", "Job interview",
 * "Mom's surgery"), shown next to the person's name on Home's Today/Tomorrow card.
 *
 * Copy of server/utils/eventLabel.js (keep the two in sync). The server saves a label on new
 * events; the app uses this for events saved before labels existed, or when the label is missing.
 */

const EVENT_WORDS = [
  'job interview', 'interview', 'final exam', 'final exams', 'midterm', 'midterms', 'exam', 'exams',
  'test', 'quiz', 'finals', 'surgery', 'operation', 'procedure', 'biopsy', 'scan', 'mri',
  'chemo', 'chemotherapy', 'treatment', 'therapy', 'appointment', 'checkup', 'check-up',
  'results', 'diagnosis', 'presentation', 'speech', 'recital', 'concert', 'performance',
  'audition', 'tryout', 'tryouts', 'game', 'match', 'tournament', 'race', 'competition',
  'flight', 'trip', 'move', 'wedding', 'funeral', 'memorial', 'birthday', 'anniversary',
  'graduation', 'ceremony', 'baptism', 'retreat', 'conference', 'meeting', 'deadline',
  'court date', 'hearing', 'trial', 'deployment', 'defense', 'first day', 'last day',
  'shift', 'visit', 'party', 'service', 'due date', 'delivery',
];

// Words that can sit in front of an event word without adding meaning ("an exam", "her exam").
const FILLER = new Set([
  'a', 'an', 'the', 'her', 'his', 'their', 'my', 'our', 'your', 'its', 'this', 'that', 'big',
  'has', 'have', 'had', 'is', 'for', 'of', 'to', 'on', 'at', 'with', 'about', 'upcoming', 'next',
  'she', 'he', 'they', 'i', 'we', 'before', 'after', 'during', 'until', 'got', 'gets', 'starts',
]);

// Relatives whose possessive changes the meaning ("Mom's surgery" is not Ella's surgery).
const RELATIVES = new Set([
  "mom's", "dad's", "mother's", "father's", "sister's", "brother's", "grandma's", "grandpa's",
  "grandmother's", "grandfather's", "aunt's", "uncle's", "cousin's", "son's", "daughter's",
  "husband's", "wife's", "friend's", "boss's", "baby's",
]);

const MAX_WORDS = 4;
const MAX_CHARS = 32;

const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Drop date words and the person's own name; the card already shows both. */
function stripNoise(text, personName) {
  let out = String(text || '').replace(/[“”"]/g, '').trim();
  const names = String(personName || '').split(/\s+/).filter((n) => n.length > 1);
  for (const name of names) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(name)}(?:'s|’s)?\\b`, 'gi'), '');
  }
  out = out
    .replace(/\b(today|tonight|tomorrow|this (morning|afternoon|evening|week|weekend)|next week|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;—-]+|[\s,.:;—-]+$/g, '')
    .trim();
  return out;
}

/** Keep a label only if it is short and reads as a label, not a sentence. */
export function cleanLabel(raw, personName) {
  const text = stripNoise(raw, personName).replace(/[.!?]+$/, '').trim();
  if (!text) return null;
  const words = text.split(/\s+/);
  if (words.length > MAX_WORDS || text.length > MAX_CHARS) return null;
  if (/^(i|i'm|i am|praying|pray|please)\b/i.test(text)) return null;
  return capitalize(text);
}

/**
 * Find a known event word in free text and return it as a label, keeping one meaningful word in
 * front of it ("chemistry exam", "Mom's surgery") but not filler ("has an exam" -> "Exam").
 */
export function labelFromText(text, personName) {
  const source = String(text || '').replace(/’/g, "'");
  if (!source.trim()) return null;
  let best = null;
  for (const word of EVENT_WORDS) {
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    const m = source.match(re);
    if (m && (best === null || m.index < best.index || (m.index === best.index && m[0].length > best.word.length))) {
      best = { index: m.index, word: m[0] };
    }
  }
  if (!best) return null;
  const before = source.slice(0, best.index).trim().split(/\s+/);
  const prev = (before[before.length - 1] || '').replace(/[^A-Za-z'-]/g, '');
  const prevLower = prev.toLowerCase();
  const names = String(personName || '').toLowerCase().split(/\s+/);
  const isOwnName = names.some((n) => n && (prevLower === n || prevLower === `${n}'s`));
  let label = best.word.toLowerCase();
  if (RELATIVES.has(prevLower)) {
    label = `${prev} ${label}`;
  } else if (prev && !FILLER.has(prevLower) && !isOwnName && !/'s$/i.test(prev) && /^[a-z-]+$/i.test(prev)) {
    label = `${prev.toLowerCase()} ${label}`;
  }
  return capitalize(label.replace(/^mri$/i, 'MRI').replace(/\bmri\b/i, 'MRI'));
}

/** Best rule-based label from the extraction's date context, then the event summary. */
export function fallbackEventLabel({ context, summary, personName } = {}) {
  return (
    labelFromText(context, personName) ||
    cleanLabel(context, personName) ||
    labelFromText(summary, personName) ||
    null
  );
}

