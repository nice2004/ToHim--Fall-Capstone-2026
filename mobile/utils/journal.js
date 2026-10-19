/**
 * Gentle, optional starting points. Never required, never tracked — a reflection can start
 * from any of these or from nothing at all.
 */
export const REFLECTION_PROMPTS = [
  "Where did you notice God's faithfulness today?",
  'What are you grateful for right now?',
  'Who was on your heart today, and why?',
  'Have you seen an answer to prayer lately, big or small?',
  'Is there someone you would like to encourage?',
  'What weighed on you today? You can set it down here.',
  'What is God teaching you about trust in this season?',
  'Was there a verse or a moment that stayed with you?',
  'What would you like to say to God tonight?',
  'Who has encouraged you recently?',
];

/** A person-shaped prompt for someone the user has been praying for (optional extra). */
export function personPrompt(name) {
  return `How has ${name} been since you last prayed for them?`;
}

/** Three prompts that change day to day, so the suggestions feel fresh without being random each render. */
export function promptsForToday(date = new Date(), count = 3) {
  const dayNumber = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  );
  const start = (dayNumber * 3) % REFLECTION_PROMPTS.length;
  return Array.from({ length: count }, (_, i) => REFLECTION_PROMPTS[(start + i) % REFLECTION_PROMPTS.length]);
}

/** The user's own calendar day as YYYY-MM-DD (not UTC). */
export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' → a local Date at noon (so no timezone can push it to another day). */
export function dateFromKey(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12);
}

export function formatEntryDay(key) {
  const today = localDateKey();
  const yesterday = localDateKey(new Date(Date.now() - 86400000));
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return dateFromKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatLongDate(key) {
  return dateFromKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatShortDay(key) {
  return dateFromKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function monthLabel(key) {
  return dateFromKey(key).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Must match EXCERPT_GAP in server/services/journalConnections.js. */
export const EXCERPT_GAP = ' … ';

/**
 * The user's exact sentences for a set of indices: neighbours stay together, separate
 * passages are joined with an ellipsis (the same rule the server uses).
 */
export function excerptFromSentences(sentences, indices) {
  const chosen = [...new Set(indices)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < sentences.length)
    .sort((a, b) => a - b);
  if (chosen.length === 0) return '';
  const runs = [];
  let run = [chosen[0]];
  for (const i of chosen.slice(1)) {
    if (i === run[run.length - 1] + 1) run.push(i);
    else {
      runs.push(run);
      run = [i];
    }
  }
  runs.push(run);
  return runs.map((r) => r.map((i) => sentences[i]).join(' ')).join(EXCERPT_GAP);
}
