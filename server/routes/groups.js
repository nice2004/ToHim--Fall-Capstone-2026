const express = require('express');
const router = express.Router();
const userRepo = require('../postgres');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Get all groups for the user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const groups = await userRepo.getAllGroups(userId);
    res.json({ groups });
  } catch (error) {
    console.error('[Groups] Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Get a specific group with its persons
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = parseInt(req.params.id);
    
    const group = await userRepo.getGroupById(userId, groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const persons = await userRepo.getPersonsInGroup(userId, groupId);
    res.json({ group, persons });
  } catch (error) {
    console.error('[Groups] Error fetching group:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// Create a new group
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const group = await userRepo.createGroup(userId, name.trim());
    res.status(201).json({ group });
  } catch (error) {
    console.error('[Groups] Error creating group:', error);
    if (error.message.includes('already exists')) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to create group' });
    }
  }
});

// Update a group
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = parseInt(req.params.id);
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const group = await userRepo.updateGroup(userId, groupId, name.trim());
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ group });
  } catch (error) {
    console.error('[Groups] Error updating group:', error);
    if (error.message.includes('already exists')) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update group' });
    }
  }
});

// Delete a group
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = parseInt(req.params.id);

    await userRepo.deleteGroup(userId, groupId);
    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    console.error('[Groups] Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// Add a person to a group
router.post('/:id/persons/:personId', async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = parseInt(req.params.id);
    const personId = parseInt(req.params.personId);

    await userRepo.addPersonToGroup(userId, personId, groupId);
    res.json({ message: 'Person added to group successfully' });
  } catch (error) {
    console.error('[Groups] Error adding person to group:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to add person to group' });
    }
  }
});

// Remove a person from a group
router.delete('/:id/persons/:personId', async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = parseInt(req.params.id);
    const personId = parseInt(req.params.personId);

    await userRepo.removePersonFromGroup(userId, personId, groupId);
    res.json({ message: 'Person removed from group successfully' });
  } catch (error) {
    console.error('[Groups] Error removing person from group:', error);
    res.status(500).json({ error: 'Failed to remove person from group' });
  }
});

module.exports = router;
