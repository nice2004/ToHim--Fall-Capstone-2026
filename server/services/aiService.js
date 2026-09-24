const OpenAI = require('openai');
const { mergeSessionNotesTranscript, stripLightMarkdown } = require('../utils/sessionSourceText');

// Validate API key on startup
if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
  console.warn('⚠️  WARNING: OPENAI_API_KEY is not set or is using placeholder value');
  console.warn('   API calls will fail. Please set a valid API key in your .env file');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000, // 60 second timeout for OpenAI API calls
});

/** Chat completions model (override with OPENAI_MODEL in .env) */
const OPENAI_CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/** Shared instruction: outputs must not add facts beyond ToHim-provided context */
const TABBE_DATA_ONLY_SYSTEM =
  'You are ToHim. You MUST answer using ONLY the user-provided context below (sessions, notes, transcripts, stored metadata, and vector chunks). Do NOT use the web, general knowledge, or assumptions about real people, places, or events. If something is not stated in the context, say you do not have that in ToHim yet—do not guess or fill in. You may use minimal logic (e.g. comparing dates that already appear in the context to today\'s date) only when the user asks about timing and the context includes those dates.';

// Helper function to create a timeout promise
function createTimeoutPromise(ms, errorMessage) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), ms);
  });
}

// Helper function to wrap OpenAI calls with timeout and better error handling
async function callOpenAIWithTimeout(apiCall, timeoutMs = 60000) {
  try {
    const response = await Promise.race([
      apiCall,
      createTimeoutPromise(timeoutMs, `OpenAI API call timed out after ${timeoutMs}ms`)
    ]);
    return response;
  } catch (error) {
    // Provide more helpful error messages
    if (error.message.includes('timeout')) {
      throw new Error('OpenAI API request timed out. The service may be slow or unavailable. Please try again.');
    } else if (error.status === 401 || error.message.includes('api key')) {
      throw new Error('Invalid OpenAI API key. Please check your .env file.');
    } else if (error.status === 429) {
      throw new Error('OpenAI API rate limit exceeded. Please wait a moment and try again.');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error('Cannot connect to OpenAI API. Please check your internet connection.');
    }
    throw error;
  }
}

function getReferenceDateParts(referenceDate, timeZone = null) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch (error) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  const parts = fmt.formatToParts(referenceDate);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function getReadableReferenceDate(referenceDate, timeZone = null) {
  try {
    return referenceDate.toLocaleDateString('en-US', {
      timeZone: timeZone || undefined,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch (error) {
    return referenceDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}

const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function formatUtcYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function readableFromYmd(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return String(ymd || '');
  const [yy, mm, dd] = String(ymd).split('-').map(Number);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Weekday for a calendar date is absolute; use UTC to avoid local timezone shifts.
  const dow = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
  return `${weekdays[dow]}, ${months[mm - 1]} ${dd}, ${yy}`;
}

function parseUtcYmd(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
  return new Date(`${ymd}T00:00:00Z`);
}

/**
 * Deterministic normalization for explicit weekday phrases.
 * Prevents LLM drift like "next Tuesday" -> Monday/incorrect week.
 */
function normalizeExplicitWeekday(originalDateText, referenceDateStr) {
  const original = String(originalDateText || '').toLowerCase().trim();
  const base = parseUtcYmd(referenceDateStr);
  if (!base) return null;

  const nextMatch = original.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (nextMatch) {
    const target = WEEKDAY_INDEX[nextMatch[1].toLowerCase()];
    const baseDow = base.getUTCDay();
    const daysUntil = (target - baseDow + 7) % 7;
    const plusDays = daysUntil + 7; // "next X" = following week, never this week
    const out = new Date(base);
    out.setUTCDate(out.getUTCDate() + plusDays);
    return out;
  }

  const thisMatch = original.match(/\bthis\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (thisMatch) {
    const target = WEEKDAY_INDEX[thisMatch[1].toLowerCase()];
    const baseDow = base.getUTCDay();
    const daysUntil = (target - baseDow + 7) % 7;
    const out = new Date(base);
    out.setUTCDate(out.getUTCDate() + daysUntil);
    return out;
  }

  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * If the query clearly refers to exactly one person by first/last/full name, resolve without an LLM.
 * Fixes cases like "What do I know about Joel?" where the model returned "Joel" but DB has "Joel Nakazawa".
 */
function tryResolvePersonFromQueryTokens(query, allPersons) {
  if (!allPersons || allPersons.length === 0 || !query || typeof query !== 'string') return null;
  const lower = query.trim().toLowerCase();
  if (!lower) return null;

  const tokens = lower.match(/[a-z][a-z']*/g) || [];
  const significant = tokens.filter((t) => t.length >= 2);
  if (significant.length === 0) return null;

  for (const t of significant) {
    const byFirst = allPersons.filter(
      (p) => p.first_name && String(p.first_name).toLowerCase() === t
    );
    if (byFirst.length === 1) return byFirst[0];
  }

  for (const t of significant) {
    const byLast = allPersons.filter(
      (p) => p.last_name && String(p.last_name).toLowerCase() === t
    );
    if (byLast.length === 1) return byLast[0];
  }

  for (const t of significant) {
    const byFullToken = allPersons.filter((p) => {
      const parts = String(p.full_name || '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      return parts.includes(t);
    });
    if (byFullToken.length === 1) return byFullToken[0];
  }

  const fullNamesInQuery = allPersons.filter((p) => {
    const full = String(p.full_name || '').toLowerCase().trim();
    return full.length >= 3 && lower.includes(full);
  });
  if (fullNamesInQuery.length === 1) return fullNamesInQuery[0];

  return null;
}

/** Map LLM output (often a first name or partial) back to a person row. */
function matchPersonNameLoose(rawName, allPersons) {
  const normalized = String(rawName || '')
    .replace(/^[\s"']+|[\s"']+$/g, '')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'null' || normalized === 'none') return null;

  const exactFull = allPersons.find(
    (p) => String(p.full_name || '').toLowerCase() === normalized
  );
  if (exactFull) return exactFull;

  const firstOnly = allPersons.find(
    (p) => p.first_name && String(p.first_name).toLowerCase() === normalized
  );
  if (firstOnly) return firstOnly;

  const lastOnly = allPersons.find(
    (p) => p.last_name && String(p.last_name).toLowerCase() === normalized
  );
  if (lastOnly) return lastOnly;

  const includesFull = allPersons.find((p) => {
    const f = String(p.full_name || '').toLowerCase();
    return f.includes(normalized) || normalized.includes(f);
  });
  if (includesFull) return includesFull;

  return null;
}

class AIService {
  /**
   * Normalize relative dates to absolute dates
   * Converts "tomorrow", "next week", etc. to actual dates
   */
  async normalizeDates(dateStrings, referenceDate = new Date(), referenceTimeZone = null) {
    if (!dateStrings || dateStrings.length === 0) return [];

    const referenceDateStr = getReferenceDateParts(referenceDate, referenceTimeZone); // YYYY-MM-DD in client timezone
    const referenceDateReadable = getReadableReferenceDate(referenceDate, referenceTimeZone);

    const prompt = `You are a date normalization assistant. Convert relative dates to absolute dates.

Today's date: ${referenceDateReadable} (${referenceDateStr})

Given these date strings from a conversation, convert any relative dates to absolute dates in YYYY-MM-DD format.
For absolute dates already provided, keep them as-is or convert to YYYY-MM-DD format.
For recurring dates (like "birthday"), provide the next occurrence from today.

Examples of relative dates you MUST resolve (using the reference date above):
- "tomorrow" → next calendar day
- "next week" → Monday of next week
- "this weekend" → the coming Saturday
- "next weekend" → Saturday of the weekend AFTER the current one
- "next Monday" / "next Friday" / "next Sunday" etc. → the named weekday in the next week
- "this Friday" / "this Sunday" etc. → the named weekday within the current week
- "in 3 days" / "in a few days" / "in a couple of weeks" → count forward from today
- "next month" → first day of next month
- "end of the month" → last day of current month
- "in a couple of months" → approximately 2 months from today

Date strings to normalize: ${JSON.stringify(dateStrings)}

Return a JSON object with this structure:
{
  "normalizedDates": [
    {
      "original": "original date string",
      "normalized": "YYYY-MM-DD",
      "readable": "readable format like 'January 15, 2025'",
      "context": "what this date refers to (e.g., 'birthday', 'flight', 'meeting')"
    }
  ]
}

You MUST provide a normalized date for every weekday name, weekend reference, or countable relative phrase. Only set normalized to null if the date is truly indeterminate (e.g., "someday", "eventually").`;

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            { role: "system", content: "You are a helpful assistant that normalizes dates. Always return valid JSON. Today's date is " + referenceDateStr + "." },
            { role: "user", content: prompt }
          ],
          temperature: 0.2,
          response_format: { type: "json_object" }
        })
      );

      const content = response.choices[0].message.content;
      const result = JSON.parse(content);
      const normalizedDates = result.normalizedDates || [];

      // Post-process with deterministic weekday logic and canonical readable rendering.
      return normalizedDates.map((item) => {
        const fixed = normalizeExplicitWeekday(item?.original, referenceDateStr);
        const normalized = fixed ? formatUtcYmd(fixed) : item?.normalized;
        return {
          ...item,
          normalized,
          readable: normalized ? readableFromYmd(normalized) : (item?.readable || item?.original || ''),
        };
      });
    } catch (error) {
      console.error('Error normalizing dates:', error.message);
      // Fallback: return original dates with null normalized values
      return dateStrings.map(d => ({
        original: d,
        normalized: null,
        readable: d,
        context: null
      }));
    }
  }

  /**
   * Apply already-normalized dates to free-form text.
   * This keeps notes and calendar aligned to the same normalized date decisions.
   */
  applyNormalizedDatesToText(text, normalizedDates = []) {
    if (!text || typeof text !== 'string') return text;
    if (!Array.isArray(normalizedDates) || normalizedDates.length === 0) return text;

    let out = text;
    const sorted = [...normalizedDates]
      .filter((d) => d && d.original && d.normalized)
      // Replace longer phrases first (e.g. "next Tuesday morning" before "Tuesday")
      .sort((a, b) => String(b.original).length - String(a.original).length);

    for (const d of sorted) {
      const original = String(d.original || '').trim();
      if (!original) continue;
      const replacement = String(d.readable || d.normalized || '').trim();
      if (!replacement) continue;
      const pattern = new RegExp(`\\b${escapeRegExp(original)}\\b`, 'gi');
      out = out.replace(pattern, replacement);
    }

    return out;
  }

  /**
   * Extract person information from a conversation transcript
   * Note: Date normalization should be done separately using normalizeDates() with the session creation date
   * @param {string} transcript - The conversation transcript
   */
  async extractPersonInfo(transcript) {
    const prompt = `You are analyzing a conversation transcript to extract information about a person mentioned in the conversation.

CRITICAL INSTRUCTIONS FOR NAME EXTRACTION:
1. Look for ANY mention of a person's name in the transcript
2. Extract the name EXACTLY as written - preserve spelling, capitalization, and punctuation
3. If a name appears multiple times, use the MOST COMPLETE version:
   - If you see "John" and later "John Smith", use "John Smith"
   - If you see "Sarah" and later "Sarah Johnson", use "Sarah Johnson"
4. If only a first name appears, use that as personName (e.g., "John", "Sarah", "Michael")
5. If a nickname appears, prefer the full name if it's mentioned, otherwise use the nickname
6. Common name patterns to look for:
   - "I talked to [Name]"
   - "I met with [Name]"
   - "[Name] said..."
   - "[Name] is..."
   - "Had a conversation with [Name]"
   - "Spoke to [Name]"
7. Names can appear at the beginning, middle, or end of the transcript
8. Be aggressive in finding names - if there's ANY name-like word, extract it
9. Return null for personName ONLY if you are absolutely certain no name appears anywhere

EXAMPLES:
- "I just talked to John Smith" → personName: "John Smith"
- "Had a call with Sarah" → personName: "Sarah"
- "Met with Dr. Michael Johnson today" → personName: "Michael Johnson" (or "Dr. Michael Johnson" if you want to preserve title)
- "Spoke to my friend Alex about the project" → personName: "Alex"
- "I called my mom" → personName: null (unless "mom" is a specific name)

Extract the following information:
1. Person's name (CRITICAL - this is the most important field)
2. Key facts mentioned about the person (location, dates, events, feelings, etc.)
3. ALL dates, times, and deadlines mentioned

CRITICAL: Extract EVERY date mentioned, including:
- Relative dates: "tomorrow", "next week", "in a few days", "in 3 days", "next month", "next weekend", "this weekend", "next Friday", "this Sunday", "in a couple of weeks", etc.
- Day-of-week references: "next Monday", "this Thursday", "on Saturday", "over the weekend", etc.
- Absolute dates: "January 15th", "February 4th", "March 2025", etc.
- Time references: "at 8 am", "in the morning", "this afternoon", etc.
- Deadlines: "needs to finish by", "expecting to hear back", "scheduled for", etc.
- Future-stay or visit references: "will be staying next weekend", "coming over on Friday", "visiting next month", etc.

For each date, extract:
- The date string exactly as mentioned (e.g., "tomorrow", "next weekend", "next Friday", "in a few days", "January 15th")
- What the date refers to (e.g., "meeting with Dr. Randi", "MIT response", "course deadline", "birthday", "brother staying over")

Transcript: "${transcript}"

Return a JSON object with this structure:
{
  "personName": "Full Name exactly as mentioned or null if not mentioned",
  "firstName": "First name or null",
  "lastName": "Last name or null",
  "facts": ["fact1", "fact2", ...],
  "dates": [
    {
      "dateString": "date as mentioned (e.g., 'tomorrow at 8 am', 'in a few days', 'January 15th')",
      "context": "what this date refers to (e.g., 'meeting with Dr. Randi', 'MIT response', 'course deadline')"
    }
  ],
  "summary": "A brief summary of the interaction"
}

All facts, dates, and the summary must be grounded ONLY in the transcript—no outside knowledge or guesses.

REMEMBER: The personName field is CRITICAL. Be thorough in finding names. Only return null if you are absolutely certain no name appears in the transcript.`;

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            { role: "system", content: "You extract structured information ONLY from the user's transcript text. Never add facts from general knowledge. Always return valid JSON." },
            { role: "user", content: prompt }
          ],
          temperature: 0.3,
          response_format: { type: "json_object" }
        })
      );

      const content = response.choices[0].message.content;
      let extractedInfo;
      try {
        extractedInfo = JSON.parse(content);
      } catch (parseError) {
        console.error('[AIService] Error parsing JSON response:', parseError);
        console.error('[AIService] Raw response content:', content?.substring(0, 500));
        // Return null personName if parsing fails
        extractedInfo = { personName: null, firstName: null, lastName: null, facts: [], dates: [], summary: '' };
      }
      
      // Normalize the extracted person name: trim and clean whitespace
      if (extractedInfo.personName) {
        extractedInfo.personName = extractedInfo.personName.trim().replace(/\s+/g, ' ');
      } else {
        // Explicitly set to null if empty, undefined, or falsy
        extractedInfo.personName = null;
      }
      if (extractedInfo.firstName) {
        extractedInfo.firstName = extractedInfo.firstName.trim();
      } else {
        extractedInfo.firstName = null;
      }
      if (extractedInfo.lastName) {
        extractedInfo.lastName = extractedInfo.lastName.trim();
      } else {
        extractedInfo.lastName = null;
      }
      
      console.log('[AIService] Extracted personName:', extractedInfo.personName);
      
      // Don't normalize dates here - that should be done in the sessions route
      // using the session creation date as reference
      // Dates will be normalized after session creation
      
      return extractedInfo;
    } catch (error) {
      console.error('Error extracting person info:', error.message);
      throw error;
    }
  }

  /**
   * Extract multiple entities from one transcript.
   * Returns entity-specific segments so each person gets only relevant content.
   */
  async extractEntitiesFromTranscript(transcript) {
    const prompt = `You are analyzing a single user note that may mention one or multiple people.

Goal:
1) Detect every person/entity mentioned.
2) Split the transcript into entity-specific segments.
3) Each segment must only include details relevant to that entity.

Rules:
- Return 1+ entities when possible.
- If two people share one sentence (e.g., "my dad and mom are visiting"), include that sentence in BOTH relevant segments.
- If the note switches to another person (e.g., "I also spoke to Josef..."), keep the earlier part with the first person and later part with the second person.
- Preserve original wording in segments (do not rewrite heavily).
- If no clear name is present, use best available reference (e.g., "Dad", "Mom"), but do not invent unrelated names.
- Facts, dates, segments, and summaries must come ONLY from the transcript—no outside knowledge.

Transcript:
"${transcript}"

Return strict JSON:
{
  "entities": [
    {
      "personName": "Name exactly as referenced",
      "firstName": "first or null",
      "lastName": "last or null",
      "segment": "only the text relevant to this entity",
      "facts": ["..."],
      "dates": [
        {"dateString":"...", "context":"..."}
      ],
      "summary": "short summary"
    }
  ]
}`;

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'You extract entities and entity-specific text spans from notes. Use only the provided transcript—no outside facts. Return valid JSON only.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        })
      );

      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content || '{}');
      const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
      return entities
        .map((e) => ({
          personName: e?.personName ? String(e.personName).trim().replace(/\s+/g, ' ') : null,
          firstName: e?.firstName ? String(e.firstName).trim() : null,
          lastName: e?.lastName ? String(e.lastName).trim() : null,
          segment: e?.segment ? String(e.segment).trim() : '',
          facts: Array.isArray(e?.facts) ? e.facts : [],
          dates: Array.isArray(e?.dates) ? e.dates : [],
          summary: e?.summary ? String(e.summary).trim() : '',
        }))
        .filter((e) => e.personName);
    } catch (error) {
      console.error('[AIService] Error extracting multiple entities:', error.message);
      return [];
    }
  }

  /**
   * Normalize dates in metadata items
   * Processes metadata and converts any relative dates to absolute dates
   * Uses each metadata item's created_at date as reference (when it was recorded)
   */
  async normalizeMetadataDates(metadata, sessionDates = []) {
    if (!metadata || metadata.length === 0) return metadata;

    const normalizedMetadata = [];
    const dateItemsToNormalize = [];

    // Process each metadata item
    for (const item of metadata) {
      // Only process date-related metadata
      if (item.key === 'date' || item.key === 'date_original') {
        if (!item.value) {
          normalizedMetadata.push(item);
          continue;
        }

        // Check if it's already normalized (contains YYYY-MM-DD pattern)
        const isNormalized = /\d{4}-\d{2}-\d{2}/.test(item.value);
        
        if (isNormalized) {
          // Already normalized, keep as-is
          normalizedMetadata.push(item);
        } else {
          // Extract date string and context
          let dateString = item.value;
          let context = null;
          
          // Check if it has context prefix (e.g., "birthday: tomorrow")
          const colonIndex = dateString.indexOf(':');
          if (colonIndex > 0) {
            context = dateString.substring(0, colonIndex).trim();
            dateString = dateString.substring(colonIndex + 1).trim();
          }
          
          // Check if it looks like a relative date (including weekend/day-of-week references)
          const relativeDatePatterns = /tomorrow|yesterday|next week|last week|in \d+ days?|in (the )?next few days|in a few days|in (the )?next couple of (days|weeks)|next month|last month|next year|last year|this week|this month|this year|next weekend|this weekend|over the weekend|next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in a couple of (weeks|months)|end of the (week|month)/i;
          const isRelativeDate = relativeDatePatterns.test(dateString) || 
                                 !/\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|January|February|March|April|May|June|July|August|September|October|November|December/i.test(dateString);
          
          if (isRelativeDate) {
            // Use the metadata item's created_at as reference date (when it was recorded)
            // This ensures "tomorrow" is relative to when the metadata was created, not today
            const referenceDate = item.created_at 
              ? new Date(item.created_at)
              : (sessionDates.length > 0 
                  ? new Date(Math.min(...sessionDates.map(d => new Date(d).getTime())))
                  : new Date());
            
            // This is a relative date that needs normalization
            dateItemsToNormalize.push({ item, context, dateString, referenceDate });
          } else {
            // Doesn't look like a relative date, keep as-is
            normalizedMetadata.push(item);
          }
        }
      } else {
        // Not a date metadata item, keep as-is
        normalizedMetadata.push(item);
      }
    }

    // Normalize relative dates if any found
    // Group by reference date to batch normalize efficiently
    const dateGroups = new Map();
    dateItemsToNormalize.forEach(({ item, context, dateString, referenceDate }) => {
      const dateKey = referenceDate.toISOString();
      if (!dateGroups.has(dateKey)) {
        dateGroups.set(dateKey, { referenceDate, items: [] });
      }
      dateGroups.get(dateKey).items.push({ item, context, dateString });
    });

    // Normalize each group
    for (const [dateKey, group] of dateGroups) {
      const dateStrings = group.items.map(d => d.dateString);
      console.log('[AIService] Normalizing dates in metadata:', dateStrings);
      console.log('[AIService] Reference date:', group.referenceDate);
      
      try {
        const normalizedDates = await this.normalizeDates(dateStrings, group.referenceDate);
        
        // Replace metadata items with normalized dates
        group.items.forEach(({ item, context, dateString }, idx) => {
          const normalized = normalizedDates[idx];
          
          if (normalized && normalized.normalized) {
            // Create new metadata item with normalized date
            const newValue = context 
              ? `${context}: ${normalized.normalized} (${normalized.readable})`
              : `${normalized.normalized} (${normalized.readable})`;
            normalizedMetadata.push({
              ...item,
              value: newValue
            });
          } else {
            // Keep original if normalization failed
            normalizedMetadata.push(item);
          }
        });
      } catch (error) {
        console.error('[AIService] Error normalizing metadata dates:', error.message);
        // Keep original items if normalization fails
        group.items.forEach(({ item }) => normalizedMetadata.push(item));
      }
    }

    return normalizedMetadata;
  }

  /**
   * Answer a query about a person or relationship.
   * IMPORTANT: This function must NOT perform any AI-based date normalization.
   * All date normalization should happen at data entry time or via batch jobs.
   */
  async answerQuery(query, personData = null, allPeopleData = null, userId = null) {
    const userRepo = require('../postgres');
    let context = '';
    
    // Check if query mentions groups
    const groupKeywords = /\b(group|groups|mentors?|family|families|coworkers?|colleagues?|friends?|classmates?)\b/gi;
    const mentionsGroups = groupKeywords.test(query);
    
    if (personData) {
      // Single person context
      const { person, sessions, metadata } = personData;
      const personUserId = personData.userId || userId;
      
      // Get groups for this person if available
      let groupsInfo = '';
      if (personUserId) {
        try {
          const groups = await userRepo.getGroupsForPerson(personUserId, person.id);
          if (groups && groups.length > 0) {
            groupsInfo = `\nGroups: ${groups.map(g => g.name).join(', ')}\n`;
          }
        } catch (error) {
          console.warn('[AIService] Error fetching groups for person:', error);
        }
      }
      
      context = `Information about ${person.full_name}:${groupsInfo}\n\n`;
      
      if (sessions && sessions.length > 0) {
        context += 'Recent interactions:\n';
        for (let idx = 0; idx < sessions.length; idx++) {
          const session = sessions[idx];
          const sessionDate = new Date(session.created_at);
          const sessionDateStr = sessionDate.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });

          const sessionText = mergeSessionNotesTranscript(session);
          context += `${idx + 1}. [Recorded on ${sessionDateStr}] ${sessionText}\n`;
        }
      }
      
      const processedMetadata = metadata;
      if (processedMetadata && processedMetadata.length > 0) {
        context += '\nStored information:\n';
        processedMetadata.forEach(item => {
          context += `- ${item.key}: ${item.value}\n`;
        });
      }
    } else if (allPeopleData && allPeopleData.length > 0) {
      // Multiple people context - search across all
      const processedAllPeopleData = allPeopleData;
      
      // If query mentions groups, include group information
      let groupsContext = '';
      if (mentionsGroups) {
        const contextUserId = userId || (processedAllPeopleData.length > 0 ? processedAllPeopleData[0].userId : null);
        if (contextUserId) {
          try {
            const allGroups = await userRepo.getAllGroups(contextUserId);
            if (allGroups && allGroups.length > 0) {
              groupsContext = '\n\nGROUPS:\n';
              for (const group of allGroups) {
                const groupPersons = await userRepo.getPersonsInGroup(contextUserId, group.id);
                if (groupPersons.length > 0) {
                  groupsContext += `- ${group.name}: ${groupPersons.map(p => p.full_name).join(', ')}\n`;
                }
              }
              groupsContext += '\nWhen the query mentions a group (like "mentors", "family", "coworkers"), refer to the people listed in that group above.\n';
            }
          } catch (error) {
            console.warn('[AIService] Error fetching groups for query:', error);
          }
        }
      }
      
      context = 'Information about all people in the database:' + groupsContext + '\n\n';
      for (let idx = 0; idx < processedAllPeopleData.length; idx++) {
        const data = processedAllPeopleData[idx];
        const { person, sessions, metadata } = data;
        if (!person) continue;
        
        context += `\n${idx + 1}. ${person.full_name}:\n`;
        
        if (sessions && sessions.length > 0) {
          context += '  Interactions:\n';
          for (const session of sessions) {
            const sessionDate = new Date(session.created_at);
            const sessionDateStr = sessionDate.toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
            const sessionText = mergeSessionNotesTranscript(session);
            const truncatedText = sessionText.substring(0, 200);
            context += `    - [Recorded on ${sessionDateStr}] ${truncatedText}${sessionText.length > 200 ? '...' : ''}\n`;
          }
        }
        
        if (metadata && metadata.length > 0) {
          context += '  Stored information:\n';
          metadata.forEach(item => {
            context += `    - ${item.key}: ${item.value}\n`;
          });
        }
      }
    }

    const today = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const prompt = `Today's date is ${today}.

${context ? `Here is the ONLY information you may use (from ToHim's database):\n\n${context}\n\n` : 'NO CONTEXT WAS PROVIDED — there is no ToHim data to use.\n\n'}User query: "${query}"

GROUNDING (non-negotiable):
- Answer ONLY from the context above. Every factual claim must be traceable to a line in the context.
- Do NOT invent people, relationships, events, dates, or details not written in the context.
- Do NOT supplement with general knowledge about anyone named in the query (no biographies, no "typically", no outside facts).
- If the context does not contain enough to answer, say clearly that ToHim does not have that information saved yet and suggest recording a session or adding notes—not a guess.

Search through the context to answer the query. If the query asks about a specific detail, search only within the provided sessions and stored information.

CRITICAL: AVOID PRESENT-TENSE WORDS FOR PAST INFORMATION
- NEVER use words like "currently", "presently", "now", "at the moment", "right now", "at present", "at this time" when referring to information that was recorded in the past
- All information in the context was recorded at some point in the past - it is NOT current information
- Instead, use past tense or time-relative phrases:
  - Instead of "currently on the way" → say "was on the way" or "was traveling" (and mention when if available)
  - Instead of "presently in Turkey" → say "was in Turkey" or "had been in Turkey" (and mention when if available)
  - Instead of "now preparing" → say "was preparing" or "had been preparing" (and mention when if available)
- If you know when the information was recorded, include that context (e.g., "According to your entry from 2 days ago, your mom was on the way from the airport")
- Only use present tense if the information explicitly indicates it's about a future event that hasn't happened yet (and even then, be cautious)

GROUP QUERIES:
- If the query mentions a group (like "mentors", "family", "coworkers"), use the GROUPS section above to identify which people belong to that group
- You can answer questions like "which of my mentors am I supposed to be meeting with soon?" by:
  1. Finding the "Mentors" group in the GROUPS section
  2. Looking at the people listed in that group
  3. Searching through their information to find relevant dates/meetings
  4. Answering with the specific people from that group who match the query

IMPORTANT: When answering questions about dates:
- Always provide absolute dates (e.g., "January 15, 2025"), never relative dates (e.g., "tomorrow", "next week")
- All dates in the stored information have been normalized to absolute dates - use those exact dates
- If you see a date in format "YYYY-MM-DD (readable format)", use the readable format in your answer
- Format dates in a clear, readable way (e.g., "January 15, 2025" or "Monday, January 15th")
- When mentioning dates, be specific and accurate

If the context has no session text and no stored information lines (only names or empty sections), say that there is nothing recorded in ToHim yet for that question.

If you have enough information in the context to answer, answer clearly. Otherwise say what is missing. Be conversational and friendly.`;

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            { role: 'system', content: TABBE_DATA_ONLY_SYSTEM },
            { role: "user", content: prompt }
          ],
          temperature: 0.35
        })
      );

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Error answering query:', error.message);
      throw error;
    }
  }

  /**
   * Pinecone often returns match scores without usable metadata.text (size limits, legacy upserts, or API behavior).
   * Rebuild excerpt text from Postgres when sessionId is present.
   */
  async hydrateVectorMatchesFromSessions(userId, matches = []) {
    if (!userId || !matches || matches.length === 0) return matches;

    const userRepo = require('../postgres');
    const { mergeSessionNotesTranscript } = require('../utils/sessionSourceText');
    const out = [];

    for (const match of matches) {
      const meta = { ...(match.metadata || {}) };
      let text = String(meta.text || meta.chunk_text || '').trim();

      if (!text && meta.sessionId != null) {
        try {
          const session = await userRepo.getSessionById(userId, Number(meta.sessionId));
          if (session) {
            let person = null;
            if (meta.personId != null) {
              person = await userRepo.getPersonById(userId, Number(meta.personId));
            }
            if (!person && session.person_id != null) {
              person = await userRepo.getPersonById(userId, Number(session.person_id));
            }
            const merged = mergeSessionNotesTranscript(session);
            if (merged) {
              const d = session.created_at ? new Date(session.created_at) : null;
              const dateStr =
                d && !Number.isNaN(d.getTime())
                  ? d.toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : null;
              const who = person?.full_name || 'Person';
              const title = dateStr ? `Session with ${who} on ${dateStr}` : `Session with ${who}`;
              text = `${title}\n\n${merged}`;
              meta.text = text;
            }
          }
        } catch (err) {
          console.warn('[AIService] hydrateVectorMatchesFromSessions:', err.message);
        }
      }

      out.push({ ...match, metadata: meta });
    }

    return out;
  }

  /**
   * Answer a query using pre-selected knowledge chunks (from a vector store).
   * Chunks must already contain any normalized dates; this method will not normalize dates.
   * @param {string} query
   * @param {Array} chunks - vector matches
   * @param {number|null} userId - when set, missing chunk text is loaded from Postgres
   */
  async answerQueryFromChunks(query, chunks = [], userId = null) {
    const chunksToUse =
      userId != null ? await this.hydrateVectorMatchesFromSessions(userId, chunks) : chunks;

    const today = new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    let context = '';
    let nonEmptyChunkCount = 0;
    if (chunksToUse && chunksToUse.length > 0) {
      context += 'Here are the ONLY excerpts retrieved from ToHim (vector index). Use nothing else:\n\n';
      chunksToUse.forEach((match, index) => {
        const meta = match.metadata || {};
        const text = String(meta.text || meta.chunk_text || '').trim();
        if (!text) return;
        nonEmptyChunkCount += 1;

        const personLabel = meta.personName || meta.personId || 'Unknown person';
        const dateLabel = meta.date || meta.sessionDate || null;
        const chunkType = meta.chunkType || 'note';

        const headerParts = [];
        headerParts.push(`${index + 1}. [${chunkType}]`);
        if (personLabel) headerParts.push(`Person: ${personLabel}`);
        if (dateLabel) headerParts.push(`Date: ${dateLabel}`);

        context += `${headerParts.join(' | ')}\n`;
        context += `${text}\n\n`;
      });
    }

    if (nonEmptyChunkCount === 0) {
      return "I don't have enough saved notes in ToHim that match this question yet. Try recording a session or asking in a way that matches what you've already saved.";
    }

    const prompt = `Today's date is ${today}.

${context}User query: "${query}"

GROUNDING (non-negotiable):
- Use ONLY the excerpts above. Do NOT use general world knowledge, the web, or assumptions about people or events.
- Every factual statement must be supported by text in the excerpts. If it is not there, say ToHim does not have that saved—do not guess.
- You may compare dates that appear in the excerpts to today's date only for questions like "soon" or "upcoming".

CRITICAL:
- If the excerpts mention specific dates, use them exactly as written (they are already normalized).
- When answering about what happens on a date, stick to what the saved text says.
- If the answer cannot be determined from the excerpts, say so and suggest what the user could record in a future session.

Respond in a conversational, friendly tone.`;

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            { role: 'system', content: TABBE_DATA_ONLY_SYSTEM },
            { role: 'user', content: prompt },
          ],
          temperature: 0.35,
        })
      );

      const raw = response.choices[0]?.message?.content;
      const textOut = typeof raw === 'string' ? raw.trim() : '';
      if (!textOut) {
        console.warn('[AIService] answerQueryFromChunks: empty model output after hydration');
        return "ToHim found related notes but couldn't turn them into an answer. Please try rephrasing your question.";
      }
      return textOut;
    } catch (error) {
      console.error('Error answering query from chunks:', error.message);
      throw error;
    }
  }

  /**
   * Answer a query about a specific group: use the verified member list and give
   * enriched information for every person in the group (no subset, no skipping).
   */
  async answerQueryAboutGroupMembers(query, groupName, membersWithData = []) {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    let context = `Complete list of people in your "${groupName}" group (${membersWithData.length} people). You must address every person below.\n\n`;

    membersWithData.forEach((data, idx) => {
      const { person, sessions, metadata } = data;
      if (!person) return;

      context += `--- Person ${idx + 1}: ${person.full_name} ---\n`;

      if (sessions && sessions.length > 0) {
        context += 'Sessions / interactions:\n';
        const maxSessions = 6;
        const maxSnippetLen = 280;
        sessions.slice(0, maxSessions).forEach((s, i) => {
          const sessionDate = new Date(s.created_at).toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          });
          const text = mergeSessionNotesTranscript(s);
          const snippet = text.length > maxSnippetLen ? text.substring(0, maxSnippetLen) + '...' : text;
          context += `  ${i + 1}. [${sessionDate}] ${snippet}\n`;
        });
        if (sessions.length > maxSessions) {
          context += `  ... and ${sessions.length - maxSessions} more session(s).\n`;
        }
      } else {
        context += 'No sessions recorded yet.\n';
      }

      if (metadata && metadata.length > 0) {
        context += 'Stored information:\n';
        metadata.forEach((item) => {
          context += `  - ${item.key}: ${item.value}\n`;
        });
      }
      context += '\n';
    });

    const prompt = `Today's date is ${today}.

${context}

User question: "${query}"

GROUNDING (non-negotiable):
- Use ONLY the sessions and stored information shown above for each person. Do NOT add facts from general knowledge, the web, or inference beyond what is written.
- If you do not have information in the data for a claim, say ToHim does not have that recorded—do not guess.

Instructions:
- The list above is the complete, verified list of everyone in the "${groupName}" group. Do not add or remove anyone.
- You MUST provide information for EVERY person listed (Person 1, Person 2, ...). Do not skip anyone or say "and others" without covering them.
- For each person, give a short, useful summary based ONLY on their sessions and stored info (dates, key facts, recent interactions). If someone has no sessions or metadata, say so briefly and move on.
- Keep each person's section concise but informative. Use the exact dates and facts from the data above.
- If the user asked a specific question (e.g. "who has an upcoming date?"), answer that for each relevant person using only stated dates/facts, and still briefly mention the rest so every group member is covered.`;

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            { role: 'system', content: `${TABBE_DATA_ONLY_SYSTEM} When answering about a group, you must address every single person in the group. Never omit or summarize away a group member.` },
            { role: 'user', content: prompt }
          ],
          temperature: 0.35
        })
      );

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Error answering query about group members:', error.message);
      throw error;
    }
  }

  /**
   * Find which person a query might be referring to
   * Now searches through all people's data, not just names
   */
  async findPersonFromQuery(query, allPersons, allPeopleData = null) {
    if (allPersons.length === 0) return null;

    const quick = tryResolvePersonFromQueryTokens(query, allPersons);
    if (quick) {
      return quick;
    }

    // Build context with all people and their key information
    let context = 'People in the database:\n';
    if (allPeopleData) {
      allPeopleData.forEach((data, idx) => {
        const { person, sessions, metadata } = data;
        if (!person) return;
        
        context += `\n${idx + 1}. ${person.full_name}`;
        if (sessions && sessions.length > 0) {
          const recentSession = sessions[0];
          const recentText = mergeSessionNotesTranscript(recentSession);
          if (recentText) {
            context += `\n   Recent interaction: ${recentText.substring(0, 150)}${recentText.length > 150 ? '...' : ''}`;
          }
        }
        if (metadata && metadata.length > 0) {
          context += `\n   Key info: ${metadata.slice(0, 3).map(m => m.value).join(', ')}`;
        }
      });
    } else {
      context += allPersons.map(p => p.full_name).join(', ');
    }
    
    const prompt = `Given this query: "${query}"
${context}

Determine which person the query is most likely referring to using ONLY:
1. Names that appear in the query AND match someone in the list above (including a first name alone, e.g. "Joel" → that person's full name as listed), OR
2. Details in the query that clearly match stored text or metadata shown above for exactly one person.

Do NOT use outside knowledge about anyone. If the query could refer to several people or nothing in the data supports a single match, return "null".

Return only the person's full name exactly as listed above, or "null".`;

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            { role: 'system', content: `${TABBE_DATA_ONLY_SYSTEM} Pick at most one person from the provided list. Output only their full name as shown or the word null.` },
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        })
      );

      const personName = response.choices[0].message.content.trim();
      if (personName === 'null' || !personName) return null;

      return matchPersonNameLoose(personName, allPersons);
    } catch (error) {
      console.error('Error finding person from query:', error.message);
      return null;
    }
  }

  /**
   * Normalize dates in text (notes, transcripts, etc.)
   * Replaces relative dates with absolute dates
   */
  async normalizeDatesInText(text, referenceDate = new Date(), referenceTimeZone = null) {
    if (!text || typeof text !== 'string') return text;

    // Check if text contains relative dates (including weekend/day-of-week references)
    const relativeDatePatterns = /\b(tomorrow|yesterday|today|next week|last week|in \d+ days?|in (the )?next few days|in a few days|in (the )?next couple of (days|weeks)|next month|last month|next year|last year|this week|this month|this year|next weekend|this weekend|over the weekend|next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in a couple of (weeks|months)|end of the (week|month))\b/gi;
    if (!relativeDatePatterns.test(text)) {
      return text; // No relative dates found
    }

    const prompt = `You are a date normalization assistant. Convert all relative dates in the following text to absolute dates.

Reference date (when this text was written): ${getReadableReferenceDate(referenceDate, referenceTimeZone)} (${getReferenceDateParts(referenceDate, referenceTimeZone)})

Text to normalize:
"${text}"

Replace all relative dates (like "tomorrow", "next week", "in 3 days", "in the next few days", "in a few days") with absolute dates in a readable format (e.g., "February 4, 2025" or "Monday, February 4th").
Keep all other text exactly as is. Only change the date references.

Return the normalized text with all relative dates converted to absolute dates.`;

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            { role: "system", content: "You are a helpful assistant that normalizes dates in text. Replace relative dates with absolute dates based on the reference date provided." },
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        })
      );

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error normalizing dates in text:', error.message);
      return text; // Fallback to original text
    }
  }

  /**
   * Generate a meaningful summary for a calendar event
   * @param {string} text - The session notes or transcript
   * @param {string} personName - The person's name
   * @param {string} eventType - 'session' or 'referenced'
   * @param {Date} eventDate - The date of the event
   * @param {string} context - Optional context for referenced dates
   * @param {string} originalDate - Optional original date string for referenced dates
   */
  async generateEventSummary(text, personName, eventType, eventDate, context = null, originalDate = null) {
    let dateStr;
    if (typeof eventDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      // Canonical local-calendar date string (no timezone reinterpretation).
      dateStr = readableFromYmd(eventDate);
    } else {
      const dateObj = eventDate instanceof Date ? eventDate : new Date(eventDate);
      dateStr = dateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }

    let prompt;
    if (eventType === 'session') {
      prompt = `You are creating a calendar event summary for a session that was recorded about ${personName} on ${dateStr}.

The purpose of this summary is to help someone understand what this calendar event represents when they see it in their calendar.

SOURCE (use ONLY this text—do not add facts, people, or events that are not stated here):
${text}

Create a summary (2-4 sentences) that explains only what is supported by the source above:
1. What this session was about
2. Key information or topics actually mentioned
3. Why it might matter to remember (only if implied by the source)

If the source is vague, say so briefly instead of inventing detail.`;
    } else {
      // Referenced date - keep summary grounded to the transcript source-of-truth.
      const contextPart = context ? `The date was mentioned in the context of: "${context}". ` : '';
      const datePart = originalDate ? `The date was mentioned as: "${originalDate}". ` : '';
      
      prompt = `You are creating a calendar event summary for a date that ${personName} mentioned: ${dateStr}.

${contextPart}${datePart}
This date was mentioned in a conversation about ${personName}. Your job is to extract and explain WHAT ${personName} SAID about this date - what they're doing, what's happening, what they expect, what they're planning, etc.

Full conversation/notes:
${text}

CRITICAL INSTRUCTIONS:
1. Find the specific part of the conversation where ${personName} and/or related entities mention this date.
2. Use the transcript as source of truth. Do NOT invent details, motives, emotions, or ownership.
3. Do NOT change relationship ownership unless explicitly stated. Example: if text says "my graduation", do not rewrite to "her graduation".
4. Preserve speaker intent and pronouns from the transcript when paraphrasing.
5. Create a concise summary (1-3 sentences) that explains what was said about this date.
6. If details are unclear, say that briefly instead of guessing.

IMPORTANT: Keep wording faithful to what was said. Avoid over-personalizing the event to ${personName} if the original sentence attributes it to someone else.

Example of good summary:
"${personName} mentioned that they are flying back to school on this date. They expressed excitement about returning for the track and field season. Their return flight is scheduled for this day."

Example of BAD summary (too vague):
"A date was referenced in the conversation about ${personName}."`;
    }

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            { role: "system", content: "You summarize ONLY from the user's provided session or transcript text. Never invent details, never add outside knowledge, never flip ownership (e.g. do not change 'my graduation' to 'her graduation')." },
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        })
      );

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error generating event summary:', error.message);
      throw error;
    }
  }

  /**
   * Generate structured notes from a transcript
   * @param {string} transcript - The conversation transcript
   * @param {Date} referenceDate - The date to use for normalizing relative dates in notes
   */
  async generateNotes(transcript, referenceDate = null, referenceTimeZone = null) {
    const prompt = `Turn the following user transcript into clear, structured notes for remembering details about a person.

TRANSCRIPT (this is the ONLY source—do not add facts, names, dates, or events that do not appear in it):
"${transcript}"

Rules:
- Paraphrase and organize only what is stated in the transcript.
- Do NOT infer backstory, personality, or unstated motives.
- Do NOT add information from general knowledge.
- If something is unclear in the transcript, note that it was unclear rather than guessing.

Return a concise summary focusing on key facts, dates, and important information that actually appear in the transcript.`;

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            { role: "system", content: "You create notes ONLY from the user's transcript. Never invent or assume facts not explicitly stated." },
            { role: "user", content: prompt }
          ],
          temperature: 0.35
        })
      );

      let notes = response.choices[0].message.content;

      // Normalize dates in notes if reference date is provided
      if (referenceDate) {
        console.log('[AIService] Normalizing dates in notes using reference date:', referenceDate);
        notes = await this.normalizeDatesInText(notes, referenceDate, referenceTimeZone);
      }

      return notes;
    } catch (error) {
      console.error('Error generating notes:', error.message);
      return transcript; // Fallback to original transcript
    }
  }

  /**
   * Generate a short character summary for a person based on their sessions and metadata.
   * Returns 2–4 plain-prose sentences.
   */
  async generateCharacterSummary(personName, sessions = [], metadata = []) {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // Build a compact context — we only need enough to write a short summary
    let context = '';
    const sessionLines = [];

    if (sessions.length > 0) {
      sessions.slice(0, 8).forEach((s) => {
        const created = s.created_at != null ? new Date(s.created_at) : null;
        const dateStr =
          created && !Number.isNaN(created.getTime())
            ? created.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : 'Unknown date';
        const text = stripLightMarkdown(mergeSessionNotesTranscript(s));
        const snippet = text.length > 300 ? text.substring(0, 300) + '...' : text;
        if (snippet) sessionLines.push(`[${dateStr}] ${snippet}`);
      });
      if (sessionLines.length === 0) {
        console.warn(
          `[AIService] Character summary for "${personName}": ${sessions.length} session(s) loaded but no notes/transcript text after merge`
        );
      } else {
        context += `Recent session notes:\n${sessionLines.join('\n')}\n`;
      }
    }

    if (metadata.length > 0) {
      context += '\nStored facts:\n';
      metadata.forEach((m) => {
        if (!m || typeof m !== 'object') return;
        const k = m.key != null ? String(m.key).trim() : '';
        const vRaw = m.value;
        const v =
          vRaw != null
            ? typeof vRaw === 'object'
              ? JSON.stringify(vRaw)
              : String(vRaw).trim()
            : '';
        if (k || v) context += `- ${k || '(fact)'}: ${v}\n`;
      });
    }

    if (!context.trim()) {
      return `No sessions or information have been recorded for ${personName} yet.`;
    }

    const prompt = `Today is ${today}.

Based only on the notes and facts provided above about ${personName}, write a short factual summary of 2–4 sentences.

Rules:
- Include ONLY information that is explicitly stated in the notes or stored facts. Do not infer, assume, or add anything.
- Do not use interpretive or filler phrases (e.g. "dedicated individual," "looking forward to," "excited about," "warm personality," "great person") unless the notes explicitly say those things.
- State concrete facts: names, places, dates, events, plans, and direct quotes or claims from the notes. If the notes say they are starting a new job, say that; do not add that they are "excited" or "looking forward to it" unless the notes say so.
- Use plain prose, no bullet points or markdown. Write only the summary, nothing else.`;

    const systemContent = `You are ToHim. You write character summaries using ONLY the session notes, transcripts, and stored metadata provided in the user message. Do not use the web, general knowledge, or assumptions about anyone. Only state facts that appear in that provided text. Do not invent traits, attitudes, or interpretations. Do not add filler like "dedicated," "looking forward to," or "excited about" unless the source text explicitly says so.`;

    try {
      const response = await callOpenAIWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: `${context}\n\n${prompt}` },
          ],
          temperature: 0.3,
          max_completion_tokens: 200,
        })
      );
      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('[AIService] Error generating character summary:', error.message);
      return null;
    }
  }
}

module.exports = new AIService();

