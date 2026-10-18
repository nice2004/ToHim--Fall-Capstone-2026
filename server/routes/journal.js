const express = require('express');
const router = express.Router();
const userRepo = require('../postgres');
const { authenticateToken } = require('../middleware/auth');
const aiService = require('../services/aiService');
const journal = require('../services/journalConnections');

const MAX_BODY_LENGTH = 20000;
const MAX_PROMPT_LENGTH = 300;
const MAX_EXCERPT_LENGTH = 20000;
const MAX_LINKS = 50;

/**
 * Validate a reflection from the app. The text is kept exactly as written (only the ends are
 * trimmed). entryDate is the user's own calendar day, YYYY-MM-DD.
 */
function validateEntryInput(input = {}) {
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body) return { error: 'body is required' };
  if (body.length > MAX_BODY_LENGTH) return { error: `body must be ${MAX_BODY_LENGTH} characters or fewer` };

  const entryDate = typeof input.entryDate === 'string' ? input.entryDate.trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entryDate);
  if (!match) return { error: 'entryDate must be YYYY-MM-DD' };
  const [, y, m, d] = match.map(Number);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  if (asDate.getUTCFullYear() !== y || asDate.getUTCMonth() !== m - 1 || asDate.getUTCDate() !== d) {
    return { error: 'entryDate is not a real date' };
  }

  let prompt = null;
  if (input.prompt !== undefined && input.prompt !== null && input.prompt !== '') {
    if (typeof input.prompt !== 'string') return { error: 'prompt must be text' };
    prompt = input.prompt.trim() || null;
    if (prompt && prompt.length > MAX_PROMPT_LENGTH) {
      return { error: `prompt must be ${MAX_PROMPT_LENGTH} characters or fewer` };
    }
  }
  return { value: { body, entryDate, prompt } };
}

/** Validate the confirmed connections from the review screen: [{ personId, excerpt }]. */
function validateLinksInput(links) {
  if (!Array.isArray(links)) return { error: 'links must be a list' };
  if (links.length > MAX_LINKS) return { error: `a reflection can be connected to at most ${MAX_LINKS} people` };
  const seen = new Set();
  const value = [];
  for (const link of links) {
    const personId = Number(link?.personId);
    if (!Number.isInteger(personId) || personId <= 0) return { error: 'personId must be an integer' };
    if (seen.has(personId)) return { error: 'each person can only be connected once per reflection' };
    seen.add(personId);
    const excerpt = typeof link?.excerpt === 'string' ? link.excerpt.trim() : '';
    if (!excerpt) return { error: 'each connection needs the words it refers to' };
    if (excerpt.length > MAX_EXCERPT_LENGTH) return { error: 'excerpt is too long' };
    value.push({ personId, excerpt });
  }
  return { value };
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Which of the user's people this reflection mentions, and the exact sentences about each.
 * Uses the AI when it is available and falls back to name matching if it fails.
 */
async function findConnections(sentences, people) {
  if (sentences.length === 0 || people.length === 0) return { matches: [], method: 'none' };
  try {
    const content = await aiService.suggestJournalConnections(sentences, people);
    const matches = journal.parseModelConnections(content, sentences, people);
    if (matches) return { matches, method: 'ai' };
    console.warn('[Journal] Model returned unusable JSON; using name matching');
  } catch (err) {
    console.warn('[Journal] Connection suggestions failed; using name matching:', err.message);
  }
  return { matches: journal.matchByName(sentences, people), method: 'names' };
}

router.use(authenticateToken);

router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const entries = await userRepo.listJournalEntries(req.user.id, { limit, offset });
    res.json({ entries });
  } catch (err) {
    console.error('[Journal] Error listing entries:', err);
    res.status(500).json({ error: 'Failed to load your journal' });
  }
});

router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Journal entry not found' });
  try {
    const entry = await userRepo.getJournalEntry(req.user.id, id);
    if (!entry) return res.status(404).json({ error: 'Journal entry not found' });
    res.json({ entry });
  } catch (err) {
    console.error('[Journal] Error loading entry:', err);
    res.status(500).json({ error: 'Failed to load this reflection' });
  }
});

router.post('/', async (req, res) => {
  const { value, error } = validateEntryInput(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const entry = await userRepo.createJournalEntry(req.user.id, value);
    res.status(201).json({ success: true, entry });
  } catch (err) {
    console.error('[Journal] Error creating entry:', err);
    res.status(500).json({ error: 'Failed to save your reflection' });
  }
});

// Edit the reflection. Connections whose words are no longer in the text are removed, and
// their people are returned so the app can offer to reconnect them.
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Journal entry not found' });
  const { value, error } = validateEntryInput(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const existing = await userRepo.getJournalEntry(req.user.id, id);
    if (!existing) return res.status(404).json({ error: 'Journal entry not found' });
    const stale = existing.people.filter((link) => !journal.excerptStillPresent(value.body, link.excerpt));
    const entry = await userRepo.updateJournalEntry(
      req.user.id,
      id,
      value,
      stale.map((link) => link.person_id)
    );
    if (!entry) return res.status(404).json({ error: 'Journal entry not found' });
    res.json({
      success: true,
      entry,
      removedConnections: stale.map((link) => ({ personId: link.person_id, personName: link.person_name })),
    });
  } catch (err) {
    console.error('[Journal] Error updating entry:', err);
    res.status(500).json({ error: 'Failed to update your reflection' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Journal entry not found' });
  try {
    const deleted = await userRepo.deleteJournalEntry(req.user.id, id);
    if (!deleted) return res.status(404).json({ error: 'Journal entry not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[Journal] Error deleting entry:', err);
    res.status(500).json({ error: 'Failed to delete this reflection' });
  }
});

// Suggested connections for the review screen. Nothing is linked until the user confirms
// them with PUT /:id/links.
router.post('/:id/suggestions', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Journal entry not found' });
  try {
    const entry = await userRepo.getJournalEntry(req.user.id, id);
    if (!entry) return res.status(404).json({ error: 'Journal entry not found' });
    const people = await userRepo.getAllPersons(req.user.id);
    const sentences = journal.splitSentences(entry.body);
    const existingLinks = entry.people.filter((link) => journal.excerptStillPresent(entry.body, link.excerpt));
    // The model always sees everyone: if already-connected people were hidden, it would attach
    // their sentences to the closest remaining name. buildSuggestions skips people already linked.
    const { matches, method } = await findConnections(sentences, people);
    const suggestions = journal.buildSuggestions({
      body: entry.body,
      sentences,
      people,
      matches,
      existingLinks,
    });
    res.json({
      entryId: entry.id,
      sentences: sentences.map((s) => s.text),
      suggestions,
      people: people.map((p) => ({ id: p.id, name: p.full_name })),
      method,
    });
  } catch (err) {
    console.error('[Journal] Error suggesting connections:', err);
    res.status(500).json({ error: 'Failed to look for people in this reflection' });
  }
});

router.put('/:id/links', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Journal entry not found' });
  const { value, error } = validateLinksInput(req.body?.links);
  if (error) return res.status(400).json({ error });
  try {
    const entry = await userRepo.replaceJournalLinks(req.user.id, id, value);
    res.json({ success: true, entry });
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    console.error('[Journal] Error saving connections:', err);
    res.status(500).json({ error: 'Failed to save these connections' });
  }
});

module.exports = router;
module.exports.validateEntryInput = validateEntryInput;
module.exports.validateLinksInput = validateLinksInput;
module.exports.findConnections = findConnections;
