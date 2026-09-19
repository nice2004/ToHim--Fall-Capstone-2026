const express = require('express');
const router = express.Router();
const userRepo = require('../postgres');
const aiService = require('../services/aiService');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Get all persons (with groups if requested)
router.get('/', async (req, res) => {
  try {
    console.log('[Persons] GET /api/persons - Request received');
    const userId = req.user.id;
    const includeGroups = req.query.includeGroups === 'true';
    
    let persons;
    if (includeGroups) {
      persons = await userRepo.getAllPersonsWithGroups(userId);
    } else {
      persons = await userRepo.getAllPersons(userId);
    }
    
    console.log('[Persons] Found', persons.length, 'persons');
    res.json({ persons });
  } catch (error) {
    console.error('[Persons] Error fetching persons:', error);
    console.error('[Persons] Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch persons', details: error.message });
  }
});

// Sub-routes on `/:id` must be registered before bare `GET /:id` so paths like `…/5/summary` match correctly.
// Generate a short character summary for a person
router.get('/:id/summary', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const personData = await userRepo.getAllPersonData(userId, Number(id));

    if (!personData || !personData.person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    const { person, sessions = [], metadata = [] } = personData;

    const summary = await aiService.generateCharacterSummary(
      person.full_name,
      sessions,
      metadata
    );

    res.json({ summary });
  } catch (error) {
    console.error('[Persons] Error generating character summary:', error.message);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Normalize dates for a specific person (useful for fixing existing data)
router.post('/:id/normalize-dates', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const personData = await userRepo.getAllPersonData(userId, Number(id));

    if (!personData.person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    let sessionsUpdated = 0;
    let sessionsSkipped = 0;

    // Normalize dates in session notes
    if (personData.sessions && personData.sessions.length > 0) {
      for (const session of personData.sessions) {
        if (session.notes) {
          const relativeDatePatterns = /\b(tomorrow|yesterday|today|next week|last week|in \d+ days?|next month|last month|next year|last year|this week|this month|this year)\b/gi;
          if (relativeDatePatterns.test(session.notes)) {
            const sessionDate = new Date(session.created_at);
            try {
              const normalizedNotes = await aiService.normalizeDatesInText(session.notes, sessionDate);
              if (normalizedNotes !== session.notes) {
                await userRepo.updateSessionNotes(session.id, normalizedNotes);
                sessionsUpdated++;
              } else {
                sessionsSkipped++;
              }
            } catch (error) {
              console.error(`Error normalizing session ${session.id}:`, error.message);
              sessionsSkipped++;
            }
          } else {
            sessionsSkipped++;
          }
        } else {
          sessionsSkipped++;
        }
      }
    }

    res.json({
      success: true,
      message: `Normalized dates for person ${personData.person.full_name}`,
      sessionsUpdated,
      sessionsSkipped
    });
  } catch (error) {
    console.error('Error normalizing dates:', error);
    res.status(500).json({ error: 'Failed to normalize dates' });
  }
});

// Get a specific person with all their data
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const personData = await userRepo.getAllPersonData(userId, Number(id));
    
    // Normalize dates in session notes if they contain relative dates
    // This is a fallback for existing data that hasn't been migrated yet
    if (personData.sessions && personData.sessions.length > 0) {
      for (const session of personData.sessions) {
        if (session.notes) {
          // Check if notes contain relative dates
          const relativeDatePatterns = /\b(tomorrow|yesterday|today|next week|last week|in \d+ days?|next month|last month|next year|last year|this week|this month|this year)\b/gi;
          if (relativeDatePatterns.test(session.notes)) {
            // Normalize dates in notes using session creation date
            const sessionDate = new Date(session.created_at);
            try {
              const normalizedNotes = await aiService.normalizeDatesInText(session.notes, sessionDate);
              if (normalizedNotes !== session.notes) {
                // TODO: optional: persist normalization back to Postgres
                // Update the session notes in the response
                session.notes = normalizedNotes;
                console.log(`[Persons] Normalized dates in session ${session.id} notes`);
              }
            } catch (normalizeError) {
              console.warn(`[Persons] Failed to normalize notes for session ${session.id}:`, normalizeError.message);
            }
          }
        }
      }
    }
    
    res.json(personData);
  } catch (error) {
    console.error('Error fetching person:', error);
    res.status(500).json({ error: 'Failed to fetch person' });
  }
});

// Create a new person manually
router.post('/', async (req, res) => {
  try {
    const { firstName, lastName, fullName } = req.body;
    const userId = req.user.id;
    
    if (!fullName && !firstName) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const name = fullName || `${firstName} ${lastName || ''}`.trim();
    const first = firstName || name.split(' ')[0];
    const last = lastName || (name.split(' ').length > 1 ? name.split(' ').slice(1).join(' ') : null);

    const person = await userRepo.createPerson(userId, first, last, name);
    res.json({ person });
  } catch (error) {
    console.error('Error creating person:', error);
    res.status(500).json({ error: 'Failed to create person' });
  }
});

// Update a person
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, fullName } = req.body;
    const userId = req.user.id;
    
    if (!fullName && !firstName) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Verify person belongs to user
    const existingPerson = await userRepo.getPersonById(userId, Number(id));
    if (!existingPerson) {
      return res.status(404).json({ error: 'Person not found' });
    }

    // If fullName is provided, use it; otherwise construct from firstName and lastName
    const name = fullName || `${firstName} ${lastName || ''}`.trim();
    const first = firstName || name.split(' ')[0];
    const last = lastName || (name.split(' ').length > 1 ? name.split(' ').slice(1).join(' ') : null);

    const person = await userRepo.updatePerson(Number(id), first, last, name);
    
    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }
    
    res.json({ person, success: true });
  } catch (error) {
    console.error('Error updating person:', error);
    res.status(500).json({ error: 'Failed to update person' });
  }
});

// Delete a person
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify person belongs to user before deleting
    const existingPerson = await userRepo.getPersonById(userId, Number(id));
    if (!existingPerson) {
      return res.status(404).json({ error: 'Person not found' });
    }

    // Delete the person (CASCADE will handle related data)
    await userRepo.deletePerson(userId, Number(id));
    
    res.json({ 
      success: true, 
      message: 'Person deleted successfully',
      deletedId: id 
    });
  } catch (error) {
    console.error('Error deleting person:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to delete person' });
    }
  }
});

module.exports = router;

