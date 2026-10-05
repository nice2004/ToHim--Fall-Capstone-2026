const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

const API_BIBLE_BASE_URL = 'https://api.scripture.api.bible/v1';

function isConfigured() {
  return Boolean(process.env.BIBLE_API_KEY && process.env.BIBLE_API_BIBLE_ID);
}

// Search Bible verses by keyword or reference (e.g. "peace" or "Philippians 4:6-7").
// Proxied server-side so the api.bible key never reaches the mobile app.
router.get('/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
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

  try {
    const url = `${API_BIBLE_BASE_URL}/bibles/${encodeURIComponent(process.env.BIBLE_API_BIBLE_ID)}/search?query=${encodeURIComponent(query)}&limit=10`;
    const response = await fetch(url, {
      headers: { 'api-key': process.env.BIBLE_API_KEY },
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error('[Bible] api.bible search failed:', response.status, bodyText.slice(0, 300));
      return res.status(502).json({ error: 'Bible verse search failed', details: `Upstream status ${response.status}` });
    }

    const data = await response.json();
    const verses = (data?.data?.verses || data?.data?.passages || []).map((v) => ({
      reference: v.reference,
      text: (v.text || '').replace(/\s+/g, ' ').trim(),
    }));

    res.json({ verses });
  } catch (error) {
    console.error('[Bible] Error searching verses:', error.message);
    res.status(500).json({ error: 'Failed to search Bible verses', details: error.message });
  }
});

module.exports = router;
