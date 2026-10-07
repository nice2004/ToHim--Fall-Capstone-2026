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
    nextPersonId: 1,
    nextSessionId: 1,
    reset() {
      this.persons = [];
      this.sessions = [];
      this.calendarEvents = [];
      this.metadata = [];
      this.nextPersonId = 1;
      this.nextSessionId = 1;
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

/** Skip JWT verification; every request is user 1. */
function installFakeAuth(userId = 1) {
  stubModule('./middleware/auth', {
    authenticateToken: (req, res, next) => {
      req.user = { id: userId, username: 'tester', name: 'Tester', privacyConsentGiven: true };
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
