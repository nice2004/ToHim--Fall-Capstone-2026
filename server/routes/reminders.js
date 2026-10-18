const express = require('express');
const router = express.Router();
const userRepo = require('../postgres');
const { authenticateToken } = require('../middleware/auth');

const REPEAT_OPTIONS = ['once', 'daily', 'weekly'];
const MAX_TITLE_LENGTH = 200;

/**
 * Validate and normalize a reminder body from the app.
 * remindDate is YYYY-MM-DD and remindTime is HH:MM (24h), both in the user's local time.
 * Returns { value } on success or { error } with a message for the client.
 */
function validateReminderInput(body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return { error: 'title is required' };
  if (title.length > MAX_TITLE_LENGTH) {
    return { error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` };
  }

  const remindDate = typeof body.remindDate === 'string' ? body.remindDate.trim() : '';
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(remindDate);
  if (!dateMatch) return { error: 'remindDate must be YYYY-MM-DD' };
  const [, y, m, d] = dateMatch.map(Number);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  if (asDate.getUTCFullYear() !== y || asDate.getUTCMonth() !== m - 1 || asDate.getUTCDate() !== d) {
    return { error: 'remindDate is not a real date' };
  }

  const remindTime = typeof body.remindTime === 'string' ? body.remindTime.trim() : '';
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(remindTime);
  if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) {
    return { error: 'remindTime must be HH:MM (24-hour)' };
  }

  const repeat = body.repeat === undefined ? 'once' : body.repeat;
  if (!REPEAT_OPTIONS.includes(repeat)) {
    return { error: `repeat must be one of: ${REPEAT_OPTIONS.join(', ')}` };
  }

  const notify = body.notify === undefined ? true : body.notify;
  if (typeof notify !== 'boolean') return { error: 'notify must be a boolean' };

  const toOptionalId = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const personId = toOptionalId(body.personId);
  const sessionId = toOptionalId(body.sessionId);
  if ((personId !== null && !Number.isInteger(personId)) || (sessionId !== null && !Number.isInteger(sessionId))) {
    return { error: 'personId and sessionId must be integers' };
  }

  return { value: { title, remindDate, remindTime, repeat, notify, personId, sessionId } };
}

router.use(authenticateToken);

// List all of the user's reminders
router.get('/', async (req, res) => {
  try {
    const reminders = await userRepo.getReminders(req.user.id);
    res.json({ reminders });
  } catch (error) {
    console.error('[Reminders] Error fetching reminders:', error);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

// Create a reminder (optionally for a person or a specific prayer request)
router.post('/', async (req, res) => {
  const { value, error } = validateReminderInput(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const reminder = await userRepo.createReminder(req.user.id, value);
    res.status(201).json({ success: true, reminder });
  } catch (err) {
    console.error('[Reminders] Error creating reminder:', err.message);
    res.status(err.message.includes('not found') ? 404 : 500).json({
      error: err.message.includes('not found') ? err.message : 'Failed to create reminder',
    });
  }
});

// Update when/how often a reminder fires. Who it's for is fixed at creation.
router.put('/:reminderId', async (req, res) => {
  const { value, error } = validateReminderInput(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const reminder = await userRepo.updateReminder(req.user.id, req.params.reminderId, value);
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });
    res.json({ success: true, reminder });
  } catch (err) {
    console.error('[Reminders] Error updating reminder:', err.message);
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

router.delete('/:reminderId', async (req, res) => {
  try {
    const deleted = await userRepo.deleteReminder(req.user.id, req.params.reminderId);
    if (!deleted) return res.status(404).json({ error: 'Reminder not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[Reminders] Error deleting reminder:', err.message);
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

module.exports = router;
module.exports.validateReminderInput = validateReminderInput;
