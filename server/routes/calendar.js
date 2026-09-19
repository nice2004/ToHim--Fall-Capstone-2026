const express = require('express');
const router = express.Router();
const userRepo = require('../postgres');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Get all calendar events for a date range
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;
    
    const events = await userRepo.getCalendarEvents(userId, startDate, endDate);
    res.json({ events });
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// Get calendar events for a specific date
router.get('/date/:date', async (req, res) => {
  try {
    const userId = req.user.id;
    const { date } = req.params;
    
    const events = await userRepo.getCalendarEventsByDate(userId, date);
    res.json({ events });
  } catch (error) {
    console.error('Error fetching calendar events for date:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// Delete a calendar event
router.delete('/:eventId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;
    
    const result = await userRepo.deleteCalendarEvent(userId, eventId);
    if (result.deleted) {
      res.json({ success: true, message: 'Event deleted' });
    } else {
      res.status(404).json({ error: 'Event not found' });
    }
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    res.status(500).json({ error: 'Failed to delete calendar event' });
  }
});

// Update a calendar event (referenced events can be corrected by users)
router.put('/:eventId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId } = req.params;
    const { eventDate, summary } = req.body;

    const updated = await userRepo.updateCalendarEvent(userId, eventId, {
      eventDate,
      summary,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json({ success: true, event: updated });
  } catch (error) {
    console.error('Error updating calendar event:', error);
    res.status(500).json({ error: 'Failed to update calendar event' });
  }
});

module.exports = router;
