const express = require('express');
const router = express.Router();
const userRepo = require('../postgres');
const aiService = require('../services/aiService');
const vectorStore = require('../services/vectorStore');
const { buildSessionChunks } = require('../services/chunkBuilder');
const { mergeSessionNotesTranscript } = require('../utils/sessionSourceText');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

function getClientReferenceDate(body = {}) {
  const candidate = body.clientLocalNow;
  if (!candidate) return new Date();
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

async function resolveOrCreatePersonWithoutDisambiguation(userId, name, extractedInfo = null) {
  const normalizedName = String(name || '').trim().replace(/\s+/g, ' ');
  if (!normalizedName) return null;

  let person = await userRepo.findPersonByName(userId, normalizedName);
  if (person) {
    await userRepo.updatePersonTimestamp(person.id);
    return person;
  }

  const firstName = extractedInfo?.firstName || normalizedName.split(' ')[0];
  const lastName =
    extractedInfo?.lastName ||
    (normalizedName.split(' ').length > 1 ? normalizedName.split(' ').slice(1).join(' ') : null);
  person = await userRepo.createPerson(userId, firstName, lastName, normalizedName);
  return person;
}

async function createSessionsForEntities(userId, entities, fallbackTranscript, referenceDate = null) {
  const created = [];
  for (const entity of entities) {
    const personForEntity = await resolveOrCreatePersonWithoutDisambiguation(
      userId,
      entity.personName,
      entity
    );
    if (!personForEntity) continue;

    const entityTranscript = (entity.segment && entity.segment.trim()) || fallbackTranscript;
    const tempSession = await userRepo.createSession(
      userId,
      personForEntity.id,
      entityTranscript,
      entityTranscript
    );
    // Anchor relative dates to the user's local "now" when available.
    const sessionCreationDate = referenceDate || new Date(tempSession.created_at);
    const entityExtractedInfo = {
      personName: entity.personName,
      firstName: entity.firstName || null,
      lastName: entity.lastName || null,
      facts: Array.isArray(entity.facts) ? entity.facts : [],
      dates: Array.isArray(entity.dates) ? entity.dates : [],
      summary: entity.summary || '',
    };

    setImmediate(() => {
      processSessionInBackground({
        userId,
        person: personForEntity,
        sessionId: tempSession.id,
        transcript: entityTranscript,
        extractedInfo: entityExtractedInfo,
        sessionCreationDate,
        clientTimeZone: entity.clientTimeZone || null,
      }).catch((bgError) => {
        console.error('[Sessions] Multi-entity background processing error:', bgError);
      });
    });

    const fullSession = await userRepo.getSessionById(userId, tempSession.id);
    created.push({
      person: personForEntity,
      session: fullSession,
    });
  }
  return created;
}

async function processSessionInBackground({
  userId,
  person,
  sessionId,
  transcript,
  extractedInfo,
  sessionCreationDate,
  clientTimeZone,
}) {
  try {
    let effectiveExtractedInfo = extractedInfo || {};
    // Multi-entity segmentation can occasionally under-populate dates/facts.
    // Fallback to per-segment extraction so referenced date events still generate.
    const hasDates = Array.isArray(effectiveExtractedInfo.dates) && effectiveExtractedInfo.dates.length > 0;
    const hasFacts = Array.isArray(effectiveExtractedInfo.facts) && effectiveExtractedInfo.facts.length > 0;
    if (!hasDates || !hasFacts) {
      try {
        const fallbackInfo = await aiService.extractPersonInfo(transcript);
        effectiveExtractedInfo = {
          ...fallbackInfo,
          ...effectiveExtractedInfo,
          // Prefer explicit entity extraction output when present.
          dates: hasDates ? effectiveExtractedInfo.dates : (fallbackInfo?.dates || []),
          facts: hasFacts ? effectiveExtractedInfo.facts : (fallbackInfo?.facts || []),
        };
      } catch (fallbackErr) {
        console.warn('[Sessions] Fallback extraction for background processing failed:', fallbackErr.message);
      }
    }

    // Single source of truth for relative dates:
    // compute normalizedDates once, then reuse for both notes rendering + calendar events.
    let normalizedDates = [];
    if (effectiveExtractedInfo && effectiveExtractedInfo.dates && effectiveExtractedInfo.dates.length > 0) {
      const dateStrings = effectiveExtractedInfo.dates.map((d) => (typeof d === 'string' ? d : d.dateString || d));
      const dateContexts = effectiveExtractedInfo.dates.map((d) => (
        typeof d === 'object' && d.context ? d.context : null
      ));
      normalizedDates = await aiService.normalizeDates(
        dateStrings,
        sessionCreationDate,
        clientTimeZone
      );
      normalizedDates.forEach((normalized, index) => {
        if (dateContexts[index] && !normalized.context) {
          normalized.context = dateContexts[index];
        }
      });
    }
    effectiveExtractedInfo.normalizedDates = normalizedDates;

    // Generate notes, then apply the SAME normalized dates used for calendar.
    let notes;
    try {
      notes = await aiService.generateNotes(transcript, null, clientTimeZone);
      notes = aiService.applyNormalizedDatesToText(notes, normalizedDates);
    } catch (notesError) {
      console.warn('[Sessions] Notes generation failed, using transcript fallback:', notesError.message);
      notes = aiService.applyNormalizedDatesToText(transcript, normalizedDates);
    }

    await userRepo.updateSessionNotes(sessionId, notes);
    const session = await userRepo.getSessionById(userId, sessionId);
    if (!session) {
      console.warn('[Sessions] Background processing aborted: session not found', sessionId);
      return;
    }

    let sessionSummary = null;

    // Create calendar event for session date
    try {
      const sessionDate = new Date(session.created_at);
      try {
        const summaryText = session.notes && session.notes.trim() ? session.notes : transcript;
        if (summaryText && summaryText.trim()) {
          sessionSummary = await aiService.generateEventSummary(
            summaryText,
            person.full_name,
            'session',
            sessionDate
          );
        }
      } catch (summaryError) {
        console.warn('[Sessions] Failed to generate AI summary, using fallback:', summaryError.message);
        if (session.notes && session.notes.trim()) {
          sessionSummary = session.notes.length > 300
            ? session.notes.substring(0, 300) + '...'
            : session.notes;
        } else if (transcript && transcript.trim()) {
          sessionSummary = transcript.length > 300
            ? transcript.substring(0, 300) + '...'
            : transcript;
        }
      }

      await userRepo.createCalendarEvent(
        userId,
        person.id,
        session.id,
        'session',
        sessionDate,
        sessionSummary
      );
    } catch (calendarError) {
      console.warn('[Sessions] Failed to create session calendar event:', calendarError.message);
    }

    if (effectiveExtractedInfo && effectiveExtractedInfo.normalizedDates && effectiveExtractedInfo.normalizedDates.length > 0) {
      const normalizedDates = effectiveExtractedInfo.normalizedDates;
      for (const dateInfo of normalizedDates) {
        if (!dateInfo.normalized) continue;
        try {
          const eventDate = dateInfo.normalized; // keep date-only (YYYY-MM-DD) to avoid timezone drift
          let summary = null;
          try {
            const summaryText = session.notes && session.notes.trim() ? session.notes : transcript;
            if (summaryText && summaryText.trim()) {
              summary = await aiService.generateEventSummary(
                summaryText,
                person.full_name,
                'referenced',
                eventDate,
                dateInfo.context,
                dateInfo.original
              );
            }
          } catch (summaryError) {
            console.warn('[Sessions] Failed to generate AI summary for referenced date, using fallback:', summaryError.message);
            if (dateInfo.context) {
              summary = dateInfo.context;
            } else {
              summary = `Event on ${dateInfo.readable || dateInfo.normalized}`;
            }
          }

          await userRepo.createCalendarEvent(
            userId,
            person.id,
            session.id,
            'referenced',
            eventDate,
            summary
          );
        } catch (calendarError) {
          console.warn('[Sessions] Failed to create referenced date calendar event:', calendarError.message);
        }
      }
    }

    if (effectiveExtractedInfo && effectiveExtractedInfo.facts && effectiveExtractedInfo.facts.length > 0) {
      for (const fact of effectiveExtractedInfo.facts) {
        await userRepo.setPersonMetadata(userId, person.id, 'fact', fact);
      }
    }

    if (effectiveExtractedInfo && effectiveExtractedInfo.normalizedDates && effectiveExtractedInfo.normalizedDates.length > 0) {
      for (const dateInfo of effectiveExtractedInfo.normalizedDates) {
        if (dateInfo.normalized) {
          const dateValue = dateInfo.context
            ? `${dateInfo.context}: ${dateInfo.normalized} (${dateInfo.readable})`
            : `${dateInfo.normalized} (${dateInfo.readable})`;
          await userRepo.setPersonMetadata(userId, person.id, 'date', dateValue);

          if (dateInfo.original && dateInfo.original !== dateInfo.normalized) {
            await userRepo.setPersonMetadata(
              userId,
              person.id,
              'date_original',
              dateInfo.context ? `${dateInfo.context}: ${dateInfo.original}` : dateInfo.original
            );
          }
        } else {
          const dateValue = dateInfo.context
            ? `${dateInfo.context}: ${dateInfo.original}`
            : dateInfo.original;
          await userRepo.setPersonMetadata(userId, person.id, 'date', dateValue);
        }
      }
    } else if (effectiveExtractedInfo && effectiveExtractedInfo.dates && effectiveExtractedInfo.dates.length > 0) {
      for (const date of effectiveExtractedInfo.dates) {
        if (typeof date === 'string') {
          await userRepo.setPersonMetadata(userId, person.id, 'date', date);
        } else if (date.dateString) {
          const dateValue = date.context ? `${date.context}: ${date.dateString}` : date.dateString;
          await userRepo.setPersonMetadata(userId, person.id, 'date', dateValue);
        }
      }
    }

    try {
      const normalizedDates = effectiveExtractedInfo?.normalizedDates || [];
      const chunks = buildSessionChunks({
        userId,
        person,
        session,
        sessionSummary,
        normalizedDates,
      });
      await vectorStore.upsertChunks(userId, chunks);
      console.log('[Sessions] Indexed session in vector store, chunks:', chunks.length);
    } catch (indexError) {
      console.warn('[Sessions] Failed to index session in vector store:', indexError.message);
    }
  } catch (error) {
    console.error('[Sessions] Background processing failed:', error.message);
  }
}

// Create a new session
router.post('/', async (req, res) => {
  try {
    console.log('[Sessions] POST /api/sessions - Request received');
    console.log('[Sessions] Request metadata:', {
      transcriptLength: req.body.transcript ? String(req.body.transcript).length : 0,
      hasPersonName: !!req.body.personName,
    });

    const { transcript, personName, useExistingPersonId, forceCreateNew } = req.body;
    const clientReferenceDate = getClientReferenceDate(req.body);

    if (!transcript) {
      console.log('[Sessions] Error: Transcript is missing');
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const userId = req.user.id;
    let person;
    let targetPersonName = null;
    let extractedInfo = null;
    let extractedEntities = null;

    // Always try multi-entity extraction first (unless caller explicitly forces a brand-new person).
    // This allows a session to be split across multiple referenced people even when the user
    // starts from a specific person screen or selects an existing person during disambiguation.
    if (!forceCreateNew) {
      try {
        extractedEntities = await aiService.extractEntitiesFromTranscript(transcript);
      } catch (e) {
        // Fall back to single-entity extraction flow below.
        extractedEntities = null;
      }
    }

    const normalizeName = (n) => String(n || '').trim().replace(/\s+/g, ' ');

    // Multi-entity route: when the transcript references multiple people.
    if (!forceCreateNew && Array.isArray(extractedEntities) && extractedEntities.length > 1) {
      const entities = [...extractedEntities];

      // If caller selected an existing person or provided a personName, treat that as the "primary"
      // entity for the session by aligning it to the first entity in the list.
      let lockedPrimary = null;
      if (useExistingPersonId) {
        const p = await userRepo.getPersonById(userId, Number(useExistingPersonId));
        if (!p) return res.status(400).json({ error: 'Person not found' });
        await userRepo.updatePersonTimestamp(p.id);
        lockedPrimary = { personId: p.id, personName: p.full_name };
      } else if (personName) {
        lockedPrimary = { personId: null, personName: normalizeName(personName) };
      }

      if (lockedPrimary?.personName) {
        const target = lockedPrimary.personName.toLowerCase();
        const idx = entities.findIndex((e) => normalizeName(e?.personName).toLowerCase() === target);
        if (idx > 0) {
          const [match] = entities.splice(idx, 1);
          entities.unshift(match);
        } else {
          // Ensure the chosen/typed person is included as the primary entity.
          entities[0] = { ...entities[0], personName: lockedPrimary.personName };
        }
      }

      const preparedEntities = [];
      for (let i = 0; i < entities.length; i += 1) {
        const entity = entities[i];
        const normalizedName = normalizeName(entity.personName);
        if (!normalizedName) continue;

        // Primary override: user picked a specific person id (or typed a name) for the first entity.
        if (i === 0 && lockedPrimary) {
          if (lockedPrimary.personId) {
            preparedEntities.push({
              ...entity,
              personName: lockedPrimary.personName,
              personId: lockedPrimary.personId,
              resolution: 'existing',
            });
            continue;
          }
          // Name-only override: let the normal matching logic decide existing/ambiguous/create.
        }

        const exact = await userRepo.findPersonByName(userId, normalizedName);
        if (exact) {
          await userRepo.updatePersonTimestamp(exact.id);
          preparedEntities.push({ ...entity, personName: normalizedName, personId: exact.id, resolution: 'existing' });
          continue;
        }
        // Slightly more permissive threshold so disambiguation triggers reliably for common nicknames
        // and minor spelling differences in multi-entity transcripts.
        const similar = await userRepo.findSimilarNames(userId, normalizedName, 0.65);
        if (similar.length > 0) {
          preparedEntities.push({
            ...entity,
            personName: normalizedName,
            resolution: 'ambiguous',
            similarPersons: similar.map((s) => ({
              id: s.person.id,
              full_name: s.person.full_name,
              first_name: s.person.first_name,
              similarity: s.similarity,
              matchType: s.matchType,
            })),
          });
        } else {
          preparedEntities.push({ ...entity, personName: normalizedName, resolution: 'create' });
        }
      }

      const ambiguous = preparedEntities.filter((e) => e.resolution === 'ambiguous');
      if (ambiguous.length > 0) {
        return res.json({
          needsEntityDisambiguation: true,
          entities: preparedEntities,
          message: 'Please resolve ambiguous entities before saving.',
        });
      }

      const resolvedEntities = preparedEntities.map((e) => ({
        personName: e.personName,
        firstName: e.firstName || null,
        lastName: e.lastName || null,
        segment: e.segment,
        facts: e.facts || [],
        dates: e.dates || [],
        summary: e.summary || '',
        clientTimeZone: req.body.clientTimeZone || null,
      }));

      const created = await createSessionsForEntities(
        userId,
        resolvedEntities,
        transcript,
        clientReferenceDate
      );

      if (created.length > 0) {
        return res.json({
          success: true,
          multiEntity: true,
          processing: true,
          createdCount: created.length,
          persons: created.map((c) => c.person),
          sessions: created.map((c) => c.session),
          person: created[0].person,
          session: created[0].session,
        });
      }
    } else if (!useExistingPersonId && !forceCreateNew && !personName && Array.isArray(extractedEntities) && extractedEntities.length === 1) {
      // If multi-entity extraction found exactly one entity, reuse it as extractedInfo so single-person
      // flow still benefits from the richer entity extraction output.
      extractedInfo = {
        personName: extractedEntities[0].personName,
        firstName: extractedEntities[0].firstName || null,
        lastName: extractedEntities[0].lastName || null,
        facts: Array.isArray(extractedEntities[0].facts) ? extractedEntities[0].facts : [],
        dates: Array.isArray(extractedEntities[0].dates) ? extractedEntities[0].dates : [],
        summary: extractedEntities[0].summary || '',
      };
      targetPersonName = normalizeName(extractedEntities[0].personName);
    }

    // If useExistingPersonId is provided, skip AI extraction and use that person directly
    if (useExistingPersonId) {
      console.log('[Sessions] Using existing person ID:', useExistingPersonId);
      person = await userRepo.getPersonById(userId, Number(useExistingPersonId));
      if (!person) {
        return res.status(400).json({ error: 'Person not found' });
      }
      await userRepo.updatePersonTimestamp(person.id);
      // Skip to session creation - we already have the person
    } else if (forceCreateNew && personName) {
      // Force create new person with provided name - skip AI extraction
      console.log('[Sessions] Force creating new person with name:', personName);
      targetPersonName = personName.trim();
      // Will create person below
    } else if (!extractedInfo) {
      // Normal flow: try to extract person info using AI
      console.log('[Sessions] Calling AI to extract person info...');
      try {
        extractedInfo = await aiService.extractPersonInfo(transcript);
        console.log('[Sessions] AI extraction completed');
      } catch (aiError) {
        console.error('[Sessions] AI extraction failed:', aiError.message);
        console.error('[Sessions] AI extraction error stack:', aiError.stack);
        // If AI extraction fails and no personName was provided, request clarification
        if (!personName) {
          console.log('[Sessions] AI extraction failed and no personName provided, returning needsClarification');
          return res.status(400).json({ 
            error: 'Could not identify a person in the transcript. Please specify the person\'s name.',
            needsClarification: true
          });
        }
        // If personName was provided, continue with that
        console.log('[Sessions] AI extraction failed but personName provided, continuing...');
      }
      
      // Determine person name (from request or extracted)
      // Normalize the name: trim whitespace, handle null/undefined
      const extractedPersonName = extractedInfo?.personName || null;
      targetPersonName = (personName || extractedPersonName || '').trim();
      
      console.log('[Sessions] Person name determination complete:', {
        hasRequestName: !!personName,
        hasExtractedName: !!extractedPersonName,
        isEmpty: !targetPersonName,
      });
      
      // If name is empty or just whitespace, request clarification
      if (!targetPersonName) {
        console.log('[Sessions] No person name found, returning needsClarification');
        return res.status(400).json({ 
          error: 'Could not identify a person in the transcript. Please specify the person\'s name.',
          needsClarification: true
        });
      }
      
      // Normalize the name: remove extra spaces, ensure consistent formatting
      targetPersonName = targetPersonName.replace(/\s+/g, ' ').trim();
    }

    // If we already have a person (from useExistingPersonId), skip person lookup/creation
    if (!person) {
      if (forceCreateNew && targetPersonName) {
        // Force create new person (skip similar name check)
        console.log('[Sessions] Force creating new person:', targetPersonName);
        // Try to get firstName/lastName from extractedInfo if available, otherwise parse from targetPersonName
        let firstName, lastName;
        if (extractedInfo?.firstName && extractedInfo?.lastName) {
          firstName = extractedInfo.firstName;
          lastName = extractedInfo.lastName;
        } else {
          const nameParts = targetPersonName.split(' ');
          firstName = nameParts[0];
          lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;
        }
        person = await userRepo.createPerson(userId, firstName, lastName, targetPersonName);
        console.log('[Sessions] Created person:', person);
      } else if (targetPersonName) {
        // Find or create person - NO AI USED FOR MATCHING
        console.log('[Sessions] Looking up person:', targetPersonName);
        
        // Normalize the name for matching (trim, lowercase for comparison)
        const normalizedTargetName = targetPersonName.trim();
        
        // Try exact match first (case-insensitive, whitespace-normalized)
        // This uses simple database queries - NO AI
        console.log('[Sessions] Searching for person with normalized name:', normalizedTargetName);
        person = await userRepo.findPersonByName(userId, normalizedTargetName);
        
        if (!person) {
          // Check for similar names using fuzzy matching (NO AI - just string similarity)
          console.log('[Sessions] Exact match not found, checking for similar names using fuzzy matching...');
          const similarNames = await userRepo.findSimilarNames(userId, normalizedTargetName, 0.65);
          
          if (similarNames.length > 0) {
            console.log('[Sessions] Found similar names count:', similarNames.length);
            // Return potential matches for disambiguation
            return res.status(200).json({
              needsDisambiguation: true,
              extractedName: normalizedTargetName,
              similarPersons: similarNames.map(s => ({
                id: s.person.id,
                full_name: s.person.full_name,
                first_name: s.person.first_name,
                similarity: s.similarity,
                matchType: s.matchType
              })),
              message: `Found ${similarNames.length} similar ${similarNames.length === 1 ? 'person' : 'people'}. Is this the same person?`
            });
          }
          
          console.log('[Sessions] No similar names found, creating new person');
          // Create new person - use extracted info if available, otherwise parse the name
          const firstName = extractedInfo?.firstName || normalizedTargetName.split(' ')[0];
          const lastName = extractedInfo?.lastName || (normalizedTargetName.split(' ').length > 1 ? normalizedTargetName.split(' ').slice(1).join(' ') : null);
          person = await userRepo.createPerson(userId, firstName, lastName, normalizedTargetName);
          console.log('[Sessions] Created person:', person);
        } else {
          console.log('[Sessions] Found existing person:', person.full_name);
          // Update timestamp
          await userRepo.updatePersonTimestamp(person.id);
        }
      }
    }

    // Create session FIRST to get the creation timestamp
    // We'll generate notes after we have the session creation date
    console.log('[Sessions] Creating session with temporary notes...');
    const tempSession = await userRepo.createSession(userId, person.id, transcript, transcript); // Use transcript as temp notes
    console.log('[Sessions] Session created:', tempSession.id, 'with created_at:', tempSession.created_at);
    // Use the client's local "now" for relative date normalization ("today", "in 3 weeks", etc).
    const sessionCreationDate = clientReferenceDate;

    const session = await userRepo.getSessionById(userId, tempSession.id);
    console.log('[Sessions] Session created and queued for background processing');

    setImmediate(() => {
      processSessionInBackground({
        userId,
        person,
        sessionId: tempSession.id,
        transcript,
        extractedInfo,
        sessionCreationDate,
        clientTimeZone: req.body.clientTimeZone || null,
      }).catch((bgError) => {
        console.error('[Sessions] Background processing unhandled error:', bgError);
      });
    });

    console.log('[Sessions] Returning response with person:', {
      id: person.id,
      full_name: person.full_name,
      first_name: person.first_name,
      last_name: person.last_name,
      created_at: person.created_at,
      updated_at: person.updated_at
    });
    
    res.json({
      success: true,
      session,
      person,
      extractedInfo,
      processing: true
    });
  } catch (error) {
    console.error('[Sessions] Error creating session:', error);
    console.error('[Sessions] Error stack:', error.stack);
    const statusCode = error.message?.includes('timeout') ? 504 : 
                      error.message?.includes('API key') ? 401 : 500;
    res.status(statusCode).json({ 
      error: 'Failed to create session', 
      details: error.message || 'Unknown error occurred',
      type: error.message?.includes('timeout') ? 'timeout' : 
            error.message?.includes('API key') ? 'auth' : 'server',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Resolve and save a multi-entity session after per-entity disambiguation in client
router.post('/multi-resolve', async (req, res) => {
  try {
    const userId = req.user.id;
    const { transcript, entities } = req.body;
    const clientReferenceDate = getClientReferenceDate(req.body);
    if (!transcript || !Array.isArray(entities) || entities.length === 0) {
      return res.status(400).json({ error: 'transcript and entities are required' });
    }

    const finalEntities = [];
    for (const entity of entities) {
      const chosenPersonId = entity?.selectedPersonId ? Number(entity.selectedPersonId) : null;
      const chosenName = String(entity?.selectedName || entity?.personName || '').trim();
      if (!chosenPersonId && !chosenName) continue;

      if (chosenPersonId) {
        const p = await userRepo.getPersonById(userId, chosenPersonId);
        if (!p) continue;
        await userRepo.updatePersonTimestamp(p.id);
        finalEntities.push({
          personName: p.full_name,
          firstName: p.first_name || null,
          lastName: p.last_name || null,
          segment: entity.segment || transcript,
          facts: Array.isArray(entity.facts) ? entity.facts : [],
          dates: Array.isArray(entity.dates) ? entity.dates : [],
          summary: entity.summary || '',
          clientTimeZone: req.body.clientTimeZone || null,
        });
      } else {
        finalEntities.push({
          personName: chosenName,
          firstName: entity.firstName || null,
          lastName: entity.lastName || null,
          segment: entity.segment || transcript,
          facts: Array.isArray(entity.facts) ? entity.facts : [],
          dates: Array.isArray(entity.dates) ? entity.dates : [],
          summary: entity.summary || '',
          clientTimeZone: req.body.clientTimeZone || null,
        });
      }
    }

    const created = await createSessionsForEntities(
      userId,
      finalEntities,
      transcript,
      clientReferenceDate
    );
    if (created.length === 0) {
      return res.status(400).json({ error: 'No entities could be resolved' });
    }

    res.json({
      success: true,
      multiEntity: true,
      processing: true,
      createdCount: created.length,
      persons: created.map((c) => c.person),
      sessions: created.map((c) => c.session),
      person: created[0].person,
      session: created[0].session,
    });
  } catch (error) {
    console.error('[Sessions] Error resolving multi-entity session:', error);
    res.status(500).json({ error: 'Failed to resolve multi-entity session', details: error.message });
  }
});

// Update a session's transcript and/or notes
router.put('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { notes, transcript } = req.body;
    const userId = req.user.id;

    if (notes === undefined && transcript === undefined) {
      return res.status(400).json({ error: 'At least one of notes or transcript is required' });
    }

    const session = await userRepo.updateSession(userId, sessionId, { notes, transcript });

    // Re-index in vector store so queries reflect the edited content
    try {
      const person = await userRepo.getPersonById(userId, session.person_id);
      if (person) {
        await vectorStore.deleteChunksBySession(userId, session.id);
        const sessionSummary = mergeSessionNotesTranscript(session);
        const chunks = buildSessionChunks({
          userId,
          person,
          session,
          sessionSummary,
          normalizedDates: [],
        });
        await vectorStore.upsertChunks(userId, chunks);
        console.log('[Sessions] Re-indexed edited session, chunks:', chunks.length);
      }
    } catch (indexErr) {
      console.warn('[Sessions] Failed to re-index edited session:', indexErr.message);
    }

    res.json({ success: true, session });
  } catch (error) {
    console.error('[Sessions] Error updating session:', error.message);
    res.status(error.message.includes('not found') ? 404 : 500).json({
      error: 'Failed to update session',
      details: error.message,
    });
  }
});

// Delete a session (and its calendar events); remove vector chunks
router.delete('/:sessionId', async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const userId = req.user.id;

    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      return res.status(400).json({ error: 'Invalid session id' });
    }

    const existing = await userRepo.getSessionById(userId, sessionId);
    if (!existing) {
      return res.status(404).json({ error: 'Session not found' });
    }

    try {
      await vectorStore.deleteChunksBySession(userId, sessionId);
    } catch (indexErr) {
      console.warn('[Sessions] Vector delete on session removal:', indexErr.message);
    }

    await userRepo.deleteSession(userId, sessionId);
    res.json({ success: true, deletedId: sessionId });
  } catch (error) {
    console.error('[Sessions] Error deleting session:', error.message);
    res.status(error.message.includes('not found') || error.message.includes('access denied') ? 404 : 500).json({
      error: 'Failed to delete session',
      details: error.message,
    });
  }
});

// Get all sessions for a person
router.get('/person/:personId', async (req, res) => {
  try {
    const { personId } = req.params;
    const userId = req.user.id;
    const sessions = await userRepo.getSessionsByPerson(userId, personId);
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Transfer a session to a different person
router.post('/:sessionId/transfer', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { targetPersonId } = req.body;
    const userId = req.user.id;

    if (!targetPersonId) {
      return res.status(400).json({ error: 'targetPersonId is required' });
    }

    console.log('[Sessions] Transfer request:', { sessionId, targetPersonId, userId });

    const transferResult = await userRepo.transferSessionPerson(
      userId,
      sessionId,
      targetPersonId
    );

    const { session, oldPersonId, newPerson } = transferResult;

    // Reindex this session in the vector store for the new person
    try {
      // Remove old chunks
      await vectorStore.deleteChunksBySession(userId, session.id);

      // Build fresh chunks using stored notes/transcript and no extra date info
      const sessionSummary = mergeSessionNotesTranscript(session);
      const chunks = buildSessionChunks({
        userId,
        person: newPerson,
        session,
        sessionSummary,
        normalizedDates: [],
      });
      await vectorStore.upsertChunks(userId, chunks);
      console.log(
        '[Sessions] Re-indexed transferred session in vector store, chunks:',
        chunks.length
      );
    } catch (indexError) {
      console.warn(
        '[Sessions] Failed to re-index transferred session in vector store:',
        indexError.message
      );
    }

    res.json({
      success: true,
      session,
      oldPersonId,
      newPerson,
    });
  } catch (error) {
    console.error('[Sessions] Error transferring session:', error);
    res.status(500).json({
      error: 'Failed to transfer session',
      details: error.message || 'Unknown error occurred',
    });
  }
});

module.exports = router;

