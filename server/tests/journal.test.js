/**
 * Tests for the Prayer Journal: excerpts stay in the user's own words, suggested connections
 * only point at the user's own people, edits keep links honest, and entries stay private.
 * OpenAI, Postgres and JWT auth are replaced with in-memory fakes.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mocks = require('./helpers/mocks');

const openai = mocks.installFakeOpenAI();
const repo = mocks.installFakeRepo();
mocks.installFakeAuth(1);
mocks.silenceConsole();
const journalRouter = require('../routes/journal');
const { validateEntryInput, validateLinksInput } = journalRouter;
const journal = require('../services/journalConnections');

const REFLECTION =
  "Today was a good day. I spent some time reflecting on God's faithfulness. " +
  "I also talked to Katie, and she told me that she's doing much better than last week. " +
  "I'm thankful because I've been praying for her. " +
  "I also want to encourage David because he's been stressed about his exams.";
const KATIE_WORDS =
  "I also talked to Katie, and she told me that she's doing much better than last week. " +
  "I'm thankful because I've been praying for her.";
const DAVID_WORDS = "I also want to encourage David because he's been stressed about his exams.";

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/journal', journalRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/journal`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  openai.reset();
  repo.reset();
});

async function call(method, path, body, userId = 1) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-test-user': String(userId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function addPerson(userId, fullName) {
  const [first, ...rest] = fullName.split(' ');
  return repo.createPerson(userId, first, rest.join(' ') || null, fullName);
}

async function createEntry(body = REFLECTION, userId = 1) {
  const res = await call('POST', '/', { body, entryDate: '2026-10-17' }, userId);
  assert.equal(res.status, 201);
  return res.body.entry;
}

// ----- Excerpts are the user's exact words -----

test('splits a reflection into sentences that slice back to the original text', () => {
  const sentences = journal.splitSentences('One. Two!\nThree? Dr. Lee prayed with me…  Five');
  assert.deepEqual(
    sentences.map((s) => s.text),
    ['One.', 'Two!', 'Three?', 'Dr. Lee prayed with me…', 'Five']
  );
});

test('builds excerpts verbatim and joins separate passages with an ellipsis', () => {
  const sentences = journal.splitSentences(REFLECTION);
  assert.equal(journal.excerptFromSentences(REFLECTION, sentences, [3, 2]), KATIE_WORDS);
  const split = journal.excerptFromSentences(REFLECTION, sentences, [0, 4]);
  assert.equal(split, `Today was a good day.${journal.EXCERPT_GAP}${DAVID_WORDS}`);
  assert.ok(journal.excerptStillPresent(REFLECTION, split));
});

test('notices when an edit removed the words a connection pointed to', () => {
  assert.ok(journal.excerptStillPresent(`${REFLECTION}\nAnd one more thing.`, KATIE_WORDS));
  assert.equal(journal.excerptStillPresent(REFLECTION.replace('much better', 'a bit better'), KATIE_WORDS), false);
});

test('name matching links follow-up pronoun sentences but not words like "grace"', () => {
  const people = [
    { id: 1, first_name: 'Katie', full_name: 'Katie' },
    { id: 2, first_name: 'Grace', full_name: 'Grace Park' },
  ];
  const text = `${KATIE_WORDS} Thank you for your grace, Lord.`;
  assert.deepEqual(journal.matchByName(journal.splitSentences(text), people), [
    { personId: 1, sentenceIndices: [0, 1] },
  ]);
});

test('a bare first name shared by two people is suggested once, with the other as an alternative', () => {
  const people = [
    { id: 1, first_name: 'David', full_name: 'David Kim' },
    { id: 2, first_name: 'David', full_name: 'David Lee' },
  ];
  const sentences = journal.splitSentences(DAVID_WORDS);
  const matches = journal.matchByName(sentences, people);
  assert.deepEqual(matches, [{ personId: 1, sentenceIndices: [0] }]);
  const [suggestion] = journal.buildSuggestions({ body: DAVID_WORDS, sentences, people, matches });
  assert.deepEqual(suggestion.alternatives, [{ id: 2, name: 'David Lee' }]);
});

test('drops model answers that point at unknown people or sentences', () => {
  const sentences = journal.splitSentences(REFLECTION);
  const people = [{ id: 7, full_name: 'Katie' }];
  const content = JSON.stringify({
    connections: [
      { personId: 7, sentences: [2, 3, 3, 99, 'x'] },
      { personId: 999, sentences: [4] },
      { personId: 7, sentences: [] },
    ],
  });
  assert.deepEqual(journal.parseModelConnections(content, sentences, people), [
    { personId: 7, sentenceIndices: [2, 3] },
  ]);
  assert.equal(journal.parseModelConnections('not json', sentences, people), null);
});

// ----- Input validation -----

test('accepts a reflection, keeps its words, and checks the date', () => {
  const { value } = validateEntryInput({ body: '  My day.\n\nThankful.  ', entryDate: '2026-10-17', prompt: '' });
  assert.deepEqual(value, { body: 'My day.\n\nThankful.', entryDate: '2026-10-17', prompt: null });
  assert.match(validateEntryInput({ body: '   ', entryDate: '2026-10-17' }).error, /body/);
  assert.match(validateEntryInput({ body: 'x', entryDate: '10/17/2026' }).error, /entryDate/);
  assert.match(validateEntryInput({ body: 'x', entryDate: '2026-02-30' }).error, /real date/);
});

test('validates confirmed connections', () => {
  assert.deepEqual(validateLinksInput([{ personId: '3', excerpt: ' words ' }]).value, [
    { personId: 3, excerpt: 'words' },
  ]);
  assert.match(validateLinksInput('nope').error, /list/);
  assert.match(validateLinksInput([{ personId: 'a', excerpt: 'w' }]).error, /personId/);
  assert.match(validateLinksInput([{ personId: 1, excerpt: '  ' }]).error, /words/);
  assert.match(
    validateLinksInput([{ personId: 1, excerpt: 'a' }, { personId: 1, excerpt: 'b' }]).error,
    /only be connected once/
  );
});

// ----- The API -----

test('suggests Katie and David with their own words, and links nothing until confirmed', async () => {
  const katie = await addPerson(1, 'Katie');
  const david = await addPerson(1, 'David Kim');
  await addPerson(1, 'Grace Park');
  const entry = await createEntry();
  openai.responses.journal = JSON.stringify({
    connections: [
      { personId: katie.id, sentences: [2, 3] },
      { personId: david.id, sentences: [4] },
    ],
  });

  const { status, body } = await call('POST', `/${entry.id}/suggestions`);

  assert.equal(status, 200);
  assert.equal(body.method, 'ai');
  assert.deepEqual(
    body.suggestions.map((s) => [s.personName, s.excerpt, s.alreadyLinked]),
    [
      ['Katie', KATIE_WORDS, false],
      ['David Kim', DAVID_WORDS, false],
    ]
  );
  assert.equal(body.sentences.length, 5);
  assert.equal(body.people.length, 3);
  assert.equal(repo.journalLinks.length, 0);
  // The model is only ever asked for ids and sentence numbers.
  const prompt = openai.callsOf('journal')[0].params.messages[1].content;
  assert.match(prompt, /never write or rewrite any text/);
});

test('falls back to name matching when the AI is unavailable', async () => {
  await addPerson(1, 'Katie');
  const entry = await createEntry();
  openai.responses.journal = new Error('OpenAI API request timed out');

  const { body } = await call('POST', `/${entry.id}/suggestions`);

  assert.equal(body.method, 'names');
  assert.deepEqual(body.suggestions.map((s) => s.excerpt), [KATIE_WORDS]);
});

test('confirmed connections show on the entry; editing removes ones whose words are gone', async () => {
  const katie = await addPerson(1, 'Katie');
  const david = await addPerson(1, 'David Kim');
  const entry = await createEntry();

  const saved = await call('PUT', `/${entry.id}/links`, {
    links: [
      { personId: katie.id, excerpt: KATIE_WORDS },
      { personId: david.id, excerpt: DAVID_WORDS },
    ],
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.entry.people.map((p) => p.person_name), ['Katie', 'David Kim']);

  const edited = await call('PUT', `/${entry.id}`, {
    body: REFLECTION.replace('stressed about his exams', 'nervous about finals'),
    entryDate: '2026-10-17',
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.removedConnections, [{ personId: david.id, personName: 'David Kim' }]);
  assert.deepEqual(edited.body.entry.people.map((p) => p.person_name), ['Katie']);

  // Re-reviewing keeps Katie's confirmed words and suggests David again. The model still sees
  // Katie (so it cannot hand her sentences to someone else), but its answer for her is ignored.
  openai.responses.journal = JSON.stringify({
    connections: [
      { personId: katie.id, sentences: [2] },
      { personId: david.id, sentences: [4] },
    ],
  });
  const review = await call('POST', `/${entry.id}/suggestions`);
  assert.deepEqual(
    review.body.suggestions.map((s) => [s.personName, s.alreadyLinked, s.excerpt]),
    [
      ['Katie', true, KATIE_WORDS],
      ['David Kim', false, "I also want to encourage David because he's been nervous about finals."],
    ]
  );
  assert.deepEqual(review.body.suggestions[0].sentenceIndices, [2, 3]);
  assert.match(openai.callsOf('journal')[0].params.messages[1].content, /: Katie/);
});

test('removing every connection keeps the full reflection in the journal', async () => {
  const katie = await addPerson(1, 'Katie');
  const entry = await createEntry();
  await call('PUT', `/${entry.id}/links`, { links: [{ personId: katie.id, excerpt: KATIE_WORDS }] });

  const cleared = await call('PUT', `/${entry.id}/links`, { links: [] });

  assert.deepEqual(cleared.body.entry.people, []);
  assert.equal(cleared.body.entry.body, REFLECTION);
});

test('deleting a reflection removes it and its connections', async () => {
  const katie = await addPerson(1, 'Katie');
  const entry = await createEntry();
  await call('PUT', `/${entry.id}/links`, { links: [{ personId: katie.id, excerpt: KATIE_WORDS }] });

  assert.equal((await call('DELETE', `/${entry.id}`)).status, 200);
  assert.equal((await call('GET', `/${entry.id}`)).status, 404);
  assert.equal(repo.journalLinks.length, 0);
  assert.deepEqual((await call('GET', '/')).body.entries, []);
});

test('reflections are private to the account that wrote them', async () => {
  const katie = await addPerson(1, 'Katie');
  const someoneElsesPerson = await addPerson(2, 'Jordan');
  const entry = await createEntry();

  assert.deepEqual((await call('GET', '/', undefined, 2)).body.entries, []);
  assert.equal((await call('GET', `/${entry.id}`, undefined, 2)).status, 404);
  assert.equal((await call('PUT', `/${entry.id}`, { body: 'mine now', entryDate: '2026-10-17' }, 2)).status, 404);
  assert.equal((await call('DELETE', `/${entry.id}`, undefined, 2)).status, 404);
  assert.equal((await call('POST', `/${entry.id}/suggestions`, undefined, 2)).status, 404);
  assert.equal(
    (await call('PUT', `/${entry.id}/links`, { links: [{ personId: katie.id, excerpt: 'x' }] }, 2)).status,
    404
  );
  // Nor can a user link their own reflection to someone else's person.
  const res = await call('PUT', `/${entry.id}/links`, { links: [{ personId: someoneElsesPerson.id, excerpt: 'x' }] });
  assert.equal(res.status, 404);
  assert.equal((await call('GET', `/${entry.id}`)).body.entry.body, REFLECTION);
});
