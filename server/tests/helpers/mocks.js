/**
 * Test doubles for the prayer-request pipeline. Each is installed into Node's require cache
 * BEFORE the code under test is required, so no test ever calls OpenAI, Postgres, or Pinecone.
 *
 * Usage (top of a test file, before requiring server code):
 *   const mocks = require('./helpers/mocks');
 *   const openai = mocks.installFakeOpenAI();
 */
const path = require('path');

const SERVER_DIR = path.resolve(__dirname, '..', '..');

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

function stubModule(request, exports) {
  const resolved = require.resolve(request, { paths: [SERVER_DIR] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

/** Which aiService prompt a chat.completions request came from. */
function classifyPrompt(params) {
  const prompt = (params.messages || []).map((m) => m.content).join('\n');
  if (prompt.includes('daily reflection connector')) return 'journal';
  if (prompt.includes('entity-specific segments')) return 'entities';
  if (prompt.includes('extract information about a person')) return 'personInfo';
  // Checked before 'notes': event-summary prompts also include the shared "prayer journal" voice rules.
  if (prompt.includes('calendar event summary')) return 'eventSummary';
  if (prompt.includes('prayer journal')) return 'notes';
  if (prompt.includes('date normalization assistant')) return 'dates';
  return 'other';
}

function completion(content) {
  return { choices: [{ message: { content } }] };
}

/**
 * Replace the `openai` package. Tests set `fake.responses[kind]` to:
 *   - a string: returned as the message content
 *   - an object: returned as the whole raw API response (e.g. `{ choices: [] }`)
 *   - an Error: thrown, as the SDK would on an API failure
 *   - a function(params): called, and its result treated as one of the above
 * Unset kinds return "" (an empty model reply).
 */
function installFakeOpenAI() {
  const fake = {
    calls: [],
    responses: {},
    reset() {
      this.calls = [];
      this.responses = {};
    },
    callsOf(kind) {
      return this.calls.filter((c) => c.kind === kind);
    },
  };

  async function create(params) {
    const kind = classifyPrompt(params);
    fake.calls.push({ kind, params });
    let reply = fake.responses[kind];
    if (typeof reply === 'function') reply = reply(params);
    if (reply instanceof Error) throw reply;
    if (reply && typeof reply === 'object') return reply;
    return completion(reply ?? '');
  }

  class FakeOpenAI {
    constructor() {
      this.chat = { completions: { create } };
    }
  }
  stubModule('openai', FakeOpenAI);
  return fake;
}

/** In-memory stand-in for server/postgres.js (only the functions the sessions pipeline uses). */
function installFakeRepo() {
  const repo = {
    persons: [],
    sessions: [],
    calendarEvents: [],
    metadata: [],
    journalEntries: [],
    journalLinks: [],
    nextPersonId: 1,
    nextSessionId: 1,
    nextEntryId: 1,
    reset() {
      this.persons = [];
      this.sessions = [];
      this.calendarEvents = [];
      this.metadata = [];
      this.journalEntries = [];
      this.journalLinks = [];
      this.nextPersonId = 1;
      this.nextSessionId = 1;
      this.nextEntryId = 1;
    },

    async getAllPersons(userId) {
      return repo.persons.filter((p) => p.user_id === userId);
    },

    // Prayer Journal (same user scoping as server/postgres.js)
    journalEntryWithPeople(entry) {
      const people = repo.journalLinks
        .filter((l) => l.entry_id === entry.id && l.user_id === entry.user_id)
        .map((l) => {
          const person = repo.persons.find((p) => p.id === l.person_id && p.user_id === l.user_id);
          return person ? { person_id: l.person_id, person_name: person.full_name, excerpt: l.excerpt } : null;
        })
        .filter(Boolean);
      return { ...entry, people };
    },
    async listJournalEntries(userId) {
      return repo.journalEntries
        .filter((e) => e.user_id === userId)
        .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.id - a.id)
        .map((e) => repo.journalEntryWithPeople(e));
    },
    async getJournalEntry(userId, entryId) {
      const entry = repo.journalEntries.find((e) => e.user_id === userId && e.id === Number(entryId));
      return entry ? repo.journalEntryWithPeople(entry) : null;
    },
    async createJournalEntry(userId, { body, entryDate, prompt }) {
      const entry = { id: repo.nextEntryId++, user_id: userId, body, entry_date: entryDate, prompt: prompt || null };
      repo.journalEntries.push(entry);
      return repo.journalEntryWithPeople(entry);
    },
    async updateJournalEntry(userId, entryId, { body, entryDate, prompt }, removePersonIds = []) {
      const entry = repo.journalEntries.find((e) => e.user_id === userId && e.id === Number(entryId));
      if (!entry) return null;
      Object.assign(entry, { body, entry_date: entryDate, prompt: prompt || null });
      repo.journalLinks = repo.journalLinks.filter(
        (l) => !(l.entry_id === entry.id && removePersonIds.includes(l.person_id))
      );
      return repo.journalEntryWithPeople(entry);
    },
    async deleteJournalEntry(userId, entryId) {
      const before = repo.journalEntries.length;
      repo.journalEntries = repo.journalEntries.filter((e) => !(e.user_id === userId && e.id === Number(entryId)));
      if (repo.journalEntries.length === before) return false;
      repo.journalLinks = repo.journalLinks.filter((l) => l.entry_id !== Number(entryId));
      return true;
    },
    async replaceJournalLinks(userId, entryId, links) {
      const entry = await repo.getJournalEntry(userId, entryId);
      if (!entry) throw new Error('Journal entry not found or access denied');
      for (const link of links) {
        if (!repo.persons.some((p) => p.id === link.personId && p.user_id === userId)) {
          throw new Error('Person not found or access denied');
        }
      }
      repo.journalLinks = repo.journalLinks.filter((l) => l.entry_id !== entry.id);
      for (const link of links) {
        repo.journalLinks.push({ entry_id: entry.id, user_id: userId, person_id: link.personId, excerpt: link.excerpt });
      }
      return repo.getJournalEntry(userId, entryId);
    },

    async getUserById(id) {
      return { id, username: 'tester', name: 'Tester' };
    },
    async getPersonById(userId, id) {
      return repo.persons.find((p) => p.user_id === userId && p.id === id) || null;
    },
    async findPersonByName(userId, name) {
      const target = name.trim().toLowerCase();
      return (
        repo.persons.find((p) => p.user_id === userId && p.full_name.toLowerCase() === target) || null
      );
    },
    // Simplified stand-in for the real fuzzy matcher: same first name, different full name.
    async findSimilarNames(userId, name) {
      const first = name.trim().split(' ')[0].toLowerCase();
      return repo.persons
        .filter(
          (p) =>
            p.user_id === userId &&
            p.full_name.toLowerCase() !== name.trim().toLowerCase() &&
            p.first_name.toLowerCase() === first
        )
        .map((person) => ({ person, similarity: 0.8, matchType: 'first_name' }));
    },
    async createPerson(userId, firstName, lastName, fullName) {
      const now = new Date().toISOString();
      const person = {
        id: repo.nextPersonId++,
        user_id: userId,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        created_at: now,
        updated_at: now,
      };
      repo.persons.push(person);
      return person;
    },
    async updatePersonTimestamp(personId) {
      const person = repo.persons.find((p) => p.id === personId);
      if (person) person.updated_at = new Date().toISOString();
    },
    async createSession(userId, personId, transcript, notes) {
      const session = {
        id: repo.nextSessionId++,
        user_id: userId,
        person_id: personId,
        transcript,
        notes,
        answered: false,
        created_at: new Date().toISOString(),
      };
      repo.sessions.push(session);
      return session;
    },
    async getSessionById(userId, sessionId) {
      const session = repo.sessions.find((s) => s.user_id === userId && s.id === sessionId);
      return session ? { ...session } : null;
    },
    async updateSessionNotes(sessionId, notes) {
      const session = repo.sessions.find((s) => s.id === sessionId);
      if (session) session.notes = notes;
      return session;
    },
    async createCalendarEvent(userId, personId, sessionId, eventType, eventDate, summary) {
      repo.calendarEvents.push({ userId, personId, sessionId, eventType, eventDate, summary });
    },
    async setPersonMetadata(userId, personId, key, value) {
      repo.metadata.push({ userId, personId, key, value });
    },
  };
  stubModule('./postgres', repo);
  return repo;
}

/** Vector indexing is the last background step, so `indexed` doubles as a "processing done" signal. */
function installFakeVectorStore() {
  const store = {
    indexed: [],
    reset() {
      this.indexed = [];
    },
    async upsertChunks(userId, chunks) {
      store.indexed.push({ userId, chunks });
    },
  };
  stubModule('./services/vectorStore', store);
  return store;
}

/** Skip JWT verification; every request is `userId` unless it sends an `x-test-user` header. */
function installFakeAuth(userId = 1) {
  stubModule('./middleware/auth', {
    authenticateToken: (req, res, next) => {
      const id = req.headers['x-test-user'] ? Number(req.headers['x-test-user']) : userId;
      req.user = { id, username: 'tester', name: 'Tester', privacyConsentGiven: true };
      next();
    },
  });
}

/** The pipeline logs every step; keep test output readable unless TEST_VERBOSE=1. */
function silenceConsole() {
  if (process.env.TEST_VERBOSE) return;
  for (const method of ['log', 'info', 'warn', 'error']) console[method] = () => {};
}

async function waitFor(condition, { timeoutMs = 2000, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

module.exports = {
  installFakeOpenAI,
  installFakeRepo,
  installFakeVectorStore,
  installFakeAuth,
  silenceConsole,
  waitFor,
};
