const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const userRepo = require('../postgres');
const vectorStore = require('../services/vectorStore');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Update user name
router.put('/name', async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user.id;

    if (!name || !name.trim()) {
      return res.status(400).json({ 
        error: 'Name is required' 
      });
    }

    const user = await userRepo.updateUserName(userId, name.trim());

    res.json({
      message: 'Name updated successfully',
      user: {
        id: user.id,
        username: user.username,
        name: user.name
      }
    });
  } catch (error) {
    console.error('[Profile] Error updating name:', error);
    res.status(500).json({ 
      error: 'Failed to update name',
      details: error.message 
    });
  }
});

// Update username (login identifier)
router.put('/username', async (req, res) => {
  try {
    const { username } = req.body;
    const userId = req.user.id;

    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const user = await userRepo.updateUsername(userId, username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'Username updated successfully',
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
      },
    });
  } catch (error) {
    if (error.code === 'VALIDATION') {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 'CONFLICT') {
      return res.status(409).json({ error: error.message });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    console.error('[Profile] Error updating username:', error);
    res.status(500).json({
      error: 'Failed to update username',
      details: error.message,
    });
  }
});

// Get user profile
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await userRepo.getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('[Profile] Error fetching profile:', error);
    res.status(500).json({ 
      error: 'Failed to fetch profile',
      details: error.message 
    });
  }
});

// Delete account and all associated data (Postgres + Pinecone vectors when enabled).
// Requires current username and password in the body for confirmation.
router.delete('/account', async (req, res) => {
  try {
    const userId = req.user.id;
    const { username, password } = req.body || {};

    if (!username || !String(username).trim() || password == null || password === '') {
      return res.status(400).json({
        error: 'Username and password are required to delete your account',
      });
    }

    const creds = await userRepo.getUserCredentialsForDeletion(userId);
    if (!creds) {
      return res.status(404).json({ error: 'User not found' });
    }

    const usernameOk = creds.username === String(username).trim();
    const passwordOk = await bcrypt.compare(String(password), creds.password_hash);
    if (!usernameOk || !passwordOk) {
      return res.status(401).json({
        error: 'Invalid username or password',
      });
    }

    try {
      await vectorStore.deleteChunksByUser(userId);
    } catch (vecErr) {
      console.error('[Profile] Vector cleanup on account delete:', vecErr.message);
    }

    await userRepo.ensureAuthSchema();
    const ok = await userRepo.deleteUserAndAllData(userId);
    if (!ok) {
      return res.status(404).json({ error: 'Account could not be deleted' });
    }

    res.json({ message: 'Account deleted' });
  } catch (error) {
    console.error('[Profile] Error deleting account:', error);
    res.status(500).json({
      error: 'Failed to delete account',
      details: error.message,
    });
  }
});

module.exports = router;
