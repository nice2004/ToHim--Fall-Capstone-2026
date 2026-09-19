const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const metrics = require('../metrics');

// Protect metrics so only authenticated users can see them
router.use(authenticateToken);

// Simple health endpoint for query latency
router.get('/query-latency', (req, res) => {
  const stats = metrics.getQueryLatencyStats();

  res.json({
    ...stats,
    generatedAt: new Date().toISOString(),
  });
});

module.exports = router;

