const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const aiService = require('../services/aiService');
const {
  parseReference,
  referenceFromVerseId,
  verseIdsInPassage,
} = require('../utils/bibleReference');

// All routes require authentication
router.use(authenticateToken);

const API_BIBLE_BASE_URL = 'https://api.scripture.api.bible/v1';
const MAX_RESULTS = 15;
const MAX_KEYWORD_RESULTS = 8;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'be', 'it', 'that', 'this',
  'with', 'as', 'at', 'by', 'or', 'but', 'not', 'no', 'do', 'i', 'you', 'he', 'she', 'we', 'they',
  'me', 'my', 'your', 'his', 'her', 'our', 'their', 'will', 'shall', 'from', 'all', 'so', 'unto',
]);

let translationCache = null;

function isConfigured() {
  return Boolean(process.env.BIBLE_API_KEY && process.env.BIBLE_API_BIBLE_ID);
}

async function bibleGet(path) {
  const url = `${API_BIBLE_BASE_URL}/bibles/${encodeURIComponent(process.env.BIBLE_API_BIBLE_ID)}${path}`;
  const response = await fetch(url, { headers: { 'api-key': process.env.BIBLE_API_KEY } });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const error = new Error(`Upstream status ${response.status}`);
    error.status = response.status;
    error.body = bodyText.slice(0, 300);
    throw error;
  }
  return response.json();
}

// e.g. "NIV" — saved alongside each verse so it isn't mislabeled.
async function getTranslation() {
  if (translationCache) return translationCache;
  try {
    const data = await bibleGet('');
    translationCache = data?.data?.abbreviationLocal || data?.data?.abbreviation || null;
  } catch (error) {
    console.warn('[Bible] Could not load translation info:', error.message);
  }
  return translationCache;
}

function cleanText(text) {
  // api.bible prefixes some psalms with their heading ("Psalm 23 The Lord is my shepherd").
  return (text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Psalm \d+ (?=[A-Z“"])/, '');
}

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Share of the query's meaningful words that appear in the verse (0–1). */
function overlapScore(query, text) {
  const queryWords = words(query).filter((w) => !STOPWORDS.has(w));
  if (queryWords.length === 0) return 0;
  const textWords = new Set(words(text));
  return queryWords.filter((w) => textWords.has(w)).length / queryWords.length;
}

/** Fetch a parsed reference ("Philippians 4:6-7") as plain text; null if it doesn't exist. */
async function fetchPassage(parsed) {
  try {
    const data = await bibleGet(
      `/passages/${encodeURIComponent(parsed.passageId)}` +
        '?content-type=text&include-notes=false&include-titles=false' +
        '&include-chapter-numbers=false&include-verse-numbers=false'
    );
    const text = cleanText(data?.data?.content);
    if (!text) return null;
    return { id: data.data.id || parsed.passageId, reference: parsed.reference, text };
  } catch (error) {
    if (error.status !== 400 && error.status !== 404) {
      console.warn('[Bible] Passage fetch failed:', parsed.passageId, error.message, error.body || '');
    }
    return null;
  }
}

/** api.bible full-text search: good for single keywords and exact wording in this translation. */
async function textSearch(query) {
  const data = await bibleGet(
    `/search?query=${encodeURIComponent(query)}&limit=20&sort=relevance`
  );
  return (data?.data?.verses || [])
    .map((v) => ({
      id: v.id,
      reference: referenceFromVerseId(v.id) || v.reference,
      text: cleanText(v.text),
    }))
    .filter((v) => v.text);
}

/**
 * Search Bible verses three ways:
 *  - reference:  "Philippians 4:6", "phil 4:6-7", "1 John 4", "Ps 23:1-3"
 *  - topic:      "anxiety", "strength", "grief"
 *  - wording:    words or part of a verse the user remembers ("do not worry about tomorrow"),
 *                even from another translation or slightly misremembered
 * Proxied server-side so the api.bible key never reaches the mobile app.
 *
 * Each result carries a matchType: 'reference' | 'wording' | 'keyword' | 'topic'.
 */
router.get('/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim().slice(0, 200);
  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Bible verse search is not configured',
      details:
        'Set BIBLE_API_KEY and BIBLE_API_BIBLE_ID in the server .env. See README for how to get these from api.bible.',
    });
  }

  const translation = await getTranslation();

  try {
    // 1) Looks like a reference → fetch exactly that passage.
    const parsedReference = parseReference(query);
    if (parsedReference) {
      const passage = await fetchPassage(parsedReference);
      return res.json({
        mode: 'reference',
        translation,
        verses: passage
          ? [{ reference: passage.reference, text: passage.text, matchType: 'reference' }]
          : [],
        message: passage ? null : `Couldn't find ${parsedReference.reference}. Check the chapter and verse.`,
      });
    }

    // 2) Topic or remembered wording → literal text search + AI-suggested references, in parallel.
    const isPhrase = words(query).length >= 3;
    let textSearchFailed = false;
    const [literal, suggestedRefs] = await Promise.all([
      textSearch(query).catch((error) => {
        textSearchFailed = true;
        console.error('[Bible] api.bible search failed:', error.status, error.body || error.message);
        return [];
      }),
      aiService.suggestVerseReferences(query),
    ]);
    const suggested = (
      await Promise.all(
        suggestedRefs
          .map((ref) => parseReference(ref))
          .filter(Boolean)
          .map((parsed) => fetchPassage(parsed))
      )
    ).filter(Boolean);

    if (textSearchFailed && suggested.length === 0) {
      return res.status(502).json({ error: 'Bible verse search failed' });
    }

    const results = [];
    const seenVerseIds = new Set();
    const add = (verse, matchType) => {
      const ids = verseIdsInPassage(verse.id);
      if (ids.some((id) => seenVerseIds.has(id))) return;
      ids.forEach((id) => seenVerseIds.add(id));
      results.push({ reference: verse.reference, text: verse.text, matchType });
    };

    if (isPhrase) {
      // Remembered wording: exact phrase hits first, then the verses the wording most likely
      // comes from, then any other verse sharing most of the same words.
      const phrase = words(query).join(' ');
      literal.filter((v) => words(v.text).join(' ').includes(phrase)).forEach((v) => add(v, 'wording'));
      // With no exact hit, the AI's first pick is its best guess at where the wording comes from
      // (often a different translation, e.g. KJV "take no thought for the morrow" → Matthew 6:34).
      const hadExactHit = results.length > 0;
      suggested.forEach((v, i) =>
        add(v, overlapScore(query, v.text) >= 0.5 || (i === 0 && !hadExactHit) ? 'wording' : 'topic')
      );
      literal
        .map((v) => ({ v, score: overlapScore(query, v.text) }))
        .filter(({ score }) => score >= 0.6)
        .sort((a, b) => b.score - a.score)
        .forEach(({ v }) => add(v, 'wording'));
    } else {
      // Keyword/topic: verses containing the word, then well-known verses on the topic.
      literal.slice(0, MAX_KEYWORD_RESULTS).forEach((v) => add(v, 'keyword'));
      suggested.forEach((v) => add(v, 'topic'));
    }

    res.json({ mode: isPhrase ? 'wording' : 'keyword', translation, verses: results.slice(0, MAX_RESULTS) });
  } catch (error) {
    console.error('[Bible] Error searching verses:', error.message);
    res.status(500).json({ error: 'Failed to search Bible verses', details: error.message });
  }
});

module.exports = router;
