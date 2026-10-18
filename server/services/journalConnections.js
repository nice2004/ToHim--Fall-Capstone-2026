/**
 * Prayer Journal: connecting one daily reflection to the people it mentions.
 *
 * The user's words are never rewritten. A reflection is split into sentences, the AI (or the
 * name-matching fallback) only picks WHICH sentences belong to which existing person, and the
 * excerpt is then sliced verbatim out of the original text.
 */

/** Joins non-adjacent passages of the same reflection inside one excerpt. */
const EXCERPT_GAP = ' … ';

const ABBREVIATION_END = /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Rev|Pr|Ps)\.$/i;
const THIRD_PERSON_PRONOUN = /\b(?:he|she|they|him|her|them|his|hers|their|theirs)\b/i;

/**
 * Split a reflection into sentences, keeping each one's position in the original text so
 * excerpts can be copied exactly. Line breaks always end a sentence.
 * @returns {{ index: number, text: string, start: number, end: number }[]}
 */
function splitSentences(body) {
  const text = String(body || '');
  const pieces = [];
  const pattern = /[^.!?…\n]*(?:[.!?…]+["'”’)\]]*|(?=\n)|$)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      if (pattern.lastIndex > text.length) break;
      continue;
    }
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = match.index + leading;
    pieces.push({ start, end: start + trimmed.length });
  }

  // "Dr. Smith" should not become two sentences.
  const merged = [];
  for (const piece of pieces) {
    const prev = merged[merged.length - 1];
    const between = prev ? text.slice(prev.end, piece.start) : '';
    if (prev && ABBREVIATION_END.test(text.slice(prev.start, prev.end)) && !between.includes('\n')) {
      prev.end = piece.end;
    } else {
      merged.push({ ...piece });
    }
  }
  return merged.map((p, index) => ({ index, text: text.slice(p.start, p.end), start: p.start, end: p.end }));
}

/** Sorted, de-duplicated, in-range sentence indices. */
function cleanIndices(indices, sentenceCount) {
  const seen = new Set();
  for (const raw of Array.isArray(indices) ? indices : []) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < sentenceCount) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * The user's exact words for the chosen sentences. Adjacent sentences are copied as one run
 * (keeping the original spacing); separate runs are joined with an ellipsis.
 */
function excerptFromSentences(body, sentences, indices) {
  const chosen = cleanIndices(indices, sentences.length);
  if (chosen.length === 0) return '';
  const runs = [];
  let runStart = chosen[0];
  let prev = chosen[0];
  for (const i of chosen.slice(1)) {
    if (i !== prev + 1) {
      runs.push([runStart, prev]);
      runStart = i;
    }
    prev = i;
  }
  runs.push([runStart, prev]);
  const text = String(body || '');
  return runs.map(([a, b]) => text.slice(sentences[a].start, sentences[b].end)).join(EXCERPT_GAP);
}

function normalizeSpace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** True when every passage of a stored excerpt still appears, word for word, in the reflection. */
function excerptStillPresent(body, excerpt) {
  const haystack = normalizeSpace(body);
  const parts = String(excerpt || '')
    .split(EXCERPT_GAP.trim())
    .map(normalizeSpace)
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => haystack.includes(part));
}

/** Which sentence indices make up an existing excerpt (so the review screen can pre-select them). */
function sentenceIndicesForExcerpt(sentences, excerpt) {
  const parts = String(excerpt || '')
    .split(EXCERPT_GAP.trim())
    .map(normalizeSpace)
    .filter(Boolean);
  return sentences
    .filter((s) => {
      const sentence = normalizeSpace(s.text);
      return parts.some((part) => part.includes(sentence));
    })
    .map((s) => s.index);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Names to look for in the fallback matcher. Case-sensitive on purpose: in a faith journal,
 * "God's grace" or "joy" must not link to people named Grace or Joy.
 */
function namePatterns(person) {
  const names = new Set();
  const full = String(person.full_name || '').trim();
  const first = String(person.first_name || '').trim() || full.split(/\s+/)[0] || '';
  if (full) names.add(full);
  if (first.length >= 2) names.add(first);
  return [...names].map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n)}(?![\\p{L}\\p{N}])`, 'u'));
}

/**
 * No-AI fallback: link a person to the sentences that name them, plus the next sentence when
 * it only continues about them with a pronoun ("I'm thankful because I've been praying for her").
 * @returns {{ personId: number, sentenceIndices: number[] }[]}
 */
function matchByName(sentences, people) {
  const patternsById = new Map(people.map((p) => [p.id, namePatterns(p)]));
  const fullPatternById = new Map(people.map((p) => [p.id, namePatterns({ full_name: p.full_name })[0]]));
  const mentions = sentences.map((s) => {
    const hits = people.filter((p) => patternsById.get(p.id).some((re) => re.test(s.text)));
    // A bare first name shared by several people ("David") goes to one of them; the review
    // screen offers the others as alternatives. A full-name mention always wins.
    const firstKey = (p) => String(p.first_name || p.full_name || '').toLowerCase();
    const fullHits = hits.filter((p) => fullPatternById.get(p.id)?.test(s.text));
    const coveredFirstNames = new Set(fullHits.map(firstKey));
    const ids = fullHits.map((p) => p.id);
    for (const p of hits) {
      const key = firstKey(p);
      if (ids.includes(p.id) || coveredFirstNames.has(key)) continue;
      coveredFirstNames.add(key);
      ids.push(p.id);
    }
    return ids;
  });

  const byPerson = new Map();
  sentences.forEach((s, i) => {
    for (const personId of mentions[i]) {
      if (!byPerson.has(personId)) byPerson.set(personId, new Set());
      byPerson.get(personId).add(i);
      const next = sentences[i + 1];
      if (mentions[i].length === 1 && next && mentions[i + 1].length === 0 && THIRD_PERSON_PRONOUN.test(next.text)) {
        byPerson.get(personId).add(i + 1);
      }
    }
  });
  return [...byPerson.entries()].map(([personId, set]) => ({
    personId,
    sentenceIndices: [...set].sort((a, b) => a - b),
  }));
}

/**
 * Validate the model's answer against the user's own people and sentences. Anything that does
 * not point at a real person in this account or a real sentence is dropped.
 */
function parseModelConnections(content, sentences, people) {
  let parsed;
  try {
    parsed = JSON.parse(content || '{}');
  } catch {
    return null;
  }
  const list = Array.isArray(parsed?.connections) ? parsed.connections : null;
  if (!list) return null;
  const validIds = new Set(people.map((p) => p.id));
  const byPerson = new Map();
  for (const item of list) {
    const personId = Number(item?.personId);
    if (!validIds.has(personId)) continue;
    const indices = cleanIndices(item?.sentences, sentences.length);
    if (indices.length === 0) continue;
    const merged = new Set([...(byPerson.get(personId) || []), ...indices]);
    byPerson.set(personId, merged);
  }
  return [...byPerson.entries()].map(([personId, set]) => ({
    personId,
    sentenceIndices: [...set].sort((a, b) => a - b),
  }));
}

function displayName(person) {
  return String(person.full_name || person.first_name || '').trim();
}

/** Other people who share this person's first name, so the review screen can ask "which one?". */
function sameFirstNameAlternatives(person, people) {
  const first = String(person.first_name || displayName(person).split(/\s+/)[0] || '').toLowerCase();
  if (!first) return [];
  return people
    .filter((p) => p.id !== person.id)
    .filter((p) => String(p.first_name || displayName(p).split(/\s+/)[0] || '').toLowerCase() === first)
    .map((p) => ({ id: p.id, name: displayName(p) }));
}

/**
 * Build what the review screen shows: already-confirmed links first (still present in the
 * text), then new suggestions for people not yet linked.
 */
function buildSuggestions({ body, sentences, people, matches, existingLinks = [] }) {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const result = [];
  const linked = new Set();

  for (const link of existingLinks) {
    const person = peopleById.get(Number(link.person_id ?? link.personId));
    if (!person) continue;
    linked.add(person.id);
    result.push({
      personId: person.id,
      personName: displayName(person),
      excerpt: link.excerpt,
      sentenceIndices: sentenceIndicesForExcerpt(sentences, link.excerpt),
      alreadyLinked: true,
      alternatives: sameFirstNameAlternatives(person, people),
    });
  }

  for (const match of matches) {
    const person = peopleById.get(match.personId);
    if (!person || linked.has(person.id)) continue;
    const excerpt = excerptFromSentences(body, sentences, match.sentenceIndices);
    if (!excerpt) continue;
    linked.add(person.id);
    result.push({
      personId: person.id,
      personName: displayName(person),
      excerpt,
      sentenceIndices: cleanIndices(match.sentenceIndices, sentences.length),
      alreadyLinked: false,
      alternatives: sameFirstNameAlternatives(person, people),
    });
  }
  return result;
}

module.exports = {
  EXCERPT_GAP,
  splitSentences,
  excerptFromSentences,
  excerptStillPresent,
  sentenceIndicesForExcerpt,
  matchByName,
  parseModelConnections,
  sameFirstNameAlternatives,
  buildSuggestions,
};
