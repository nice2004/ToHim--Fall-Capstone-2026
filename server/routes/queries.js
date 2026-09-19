const express = require('express');
const router = express.Router();
const userRepo = require('../postgres');
const aiService = require('../services/aiService');
const vectorStore = require('../services/vectorStore');
const metrics = require('../metrics');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Answer a query
router.post('/', async (req, res) => {
  // Capture start time so we can compute latency in both success and error cases
  const startTime = Date.now();

  try {
    console.log('[Queries] POST /api/queries - Request received');

    const { query, personId } = req.body;

    if (!query) {
      metrics.recordQueryLatency(Date.now() - startTime, {
        success: false,
        path: 'validation',
        reason: 'missing_query',
      });
      return res.status(400).json({ error: 'Query is required' });
    }

    const userId = req.user.id;

    // GROUP QUERY: verify full member list from DB, then get enriched info for each person
    try {
      const lowerQuery = query.toLowerCase();
      const mentionsGroupWord = /\b(group|groups|mentors?|family|families|friends?|coworkers?|colleagues?|classmates?)\b/.test(lowerQuery);

      if (mentionsGroupWord) {
        const groups = await userRepo.getAllGroups(userId);
        let matchedGroup = null;

        for (const g of groups) {
          const nameLower = g.name.toLowerCase();
          if (lowerQuery.includes(nameLower)) {
            matchedGroup = g;
            break;
          }
        }

        if (matchedGroup) {
          const members = await userRepo.getPersonsInGroup(userId, matchedGroup.id);

          if (!members || members.length === 0) {
            metrics.recordQueryLatency(Date.now() - startTime, {
              success: true,
              path: 'group-empty',
            });
            return res.json({
              answer: `You don't have anyone in your ${matchedGroup.name} group yet. Add people to this group from their profile to see them here.`,
              personId: null,
              personName: null,
            });
          }

          // Batch load full data (sessions, metadata) for all members in 3 queries
          const personIds = members.map((m) => m.id);
          const membersWithData = await userRepo.getAllPersonDataForPersonIds(userId, personIds);

          const answer = await aiService.answerQueryAboutGroupMembers(
            query,
            matchedGroup.name,
            membersWithData
          );

          metrics.recordQueryLatency(Date.now() - startTime, {
            success: true,
            path: 'group',
          });

          return res.json({
            answer,
            personId: null,
            personName: null,
          });
        }
      }
    } catch (groupError) {
      console.warn('[Queries] Error handling group query:', groupError.message);
      // Fall through to normal flow if this fails
    }

    const useVector = vectorStore.isEnabled();

    // Minimum matches to use vector path; otherwise fall back to legacy (e.g. new account with no backfill)
    const MIN_VECTOR_MATCHES = 1;

    if (useVector) {
      console.log('[Queries] Using vector search path for query');
      try {
        const searchOptions = {};
        if (personId) {
          searchOptions.personId = personId;
        }

        const matches = await vectorStore.search(userId, query, {
          ...searchOptions,
          topK: 20,
        });
        console.log('[Queries] Vector search matches:', matches.length, 'for userId:', userId);
        const missingText = matches.filter(
          (m) => !String(m.metadata?.text || m.metadata?.chunk_text || '').trim()
        ).length;
        if (missingText > 0) {
          console.log(
            '[Queries] Matches without stored chunk text (hydrating from DB):',
            missingText,
            '/',
            matches.length
          );
        }

        if (matches.length >= MIN_VECTOR_MATCHES) {
          const answer = await aiService.answerQueryFromChunks(query, matches, userId);

          // Try to infer primary person from top match metadata
          let primaryPersonId = personId || null;
          if (!primaryPersonId) {
            const firstWithPerson = matches.find(
              (m) => m.metadata && m.metadata.personId
            );
            if (firstWithPerson) {
              primaryPersonId = firstWithPerson.metadata.personId;
            }
          }

          let personName = null;
          if (primaryPersonId) {
            try {
              const person = await userRepo.getPersonById(userId, primaryPersonId);
              personName = person?.full_name || null;
            } catch (personErr) {
              console.warn('[Queries] Failed to load person for vector result:', personErr.message);
            }
          }

          metrics.recordQueryLatency(Date.now() - startTime, {
            success: true,
            path: 'vector',
          });

          return res.json({
            answer,
            personId: primaryPersonId || null,
            personName,
          });
        }

        // No or too few matches: this user likely has no vectors (e.g. different account / not backfilled)
        console.log('[Queries] Vector search returned no/few matches, using legacy path for userId:', userId);
      } catch (vectorError) {
        console.error('[Queries] Vector search path failed, falling back to legacy path:', vectorError.message);
      }
    }

    // Legacy path: load full person data and let answerQuery build context
    let personData = null;
    let allPeopleData = null;

    if (personId) {
      console.log('[Queries] [Legacy] Person ID provided:', personId);
      personData = await userRepo.getAllPersonData(userId, Number(personId));
    } else {
      console.log('[Queries] [Legacy] No person ID, searching across all people...');
      const allPersons = await userRepo.getAllPersons(userId);
      
      allPeopleData = [];
      for (const person of allPersons) {
        // eslint-disable-next-line no-await-in-loop
        const data = await userRepo.getAllPersonData(userId, person.id);
        allPeopleData.push({ ...data, userId });
      }
      
      const matchedPerson = await aiService.findPersonFromQuery(query, allPersons, allPeopleData);
      
      if (matchedPerson) {
        console.log('[Queries] [Legacy] Matched person:', matchedPerson.full_name);
        personData = await userRepo.getAllPersonData(userId, matchedPerson.id);
        personData.userId = userId;
      } else {
        console.log('[Queries] [Legacy] No specific person matched, searching across all data');
      }
    }

    const answer = await aiService.answerQuery(query, personData, allPeopleData, userId);

    metrics.recordQueryLatency(Date.now() - startTime, {
      success: true,
      path: 'legacy',
    });

    res.json({
      answer,
      personId: personData?.person?.id || null,
      personName: personData?.person?.full_name || null,
    });
  } catch (error) {
    console.error('[Queries] Error processing query:', error.message || error);
    console.error('[Queries] Error stack:', error.stack);
    const statusCode = error.message?.includes('timeout') ? 504
                      : error.message?.includes('API key') ? 401 : 500;

    // Record failed query latency using the captured startTime
    metrics.recordQueryLatency(Date.now() - startTime, {
      success: false,
      path: 'error',
      errorType: error.message || 'unknown',
    });

    res.status(statusCode).json({ 
      error: 'Failed to process query', 
      details: error.message || 'Unknown error occurred',
      type: error.message?.includes('timeout') ? 'timeout' : 
            error.message?.includes('API key') ? 'auth' : 'server'
    });
  }
});

module.exports = router;

