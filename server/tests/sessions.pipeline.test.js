/**
 * Tests for POST /api/sessions: turning a prayer-request description into a person + stored
 * note. OpenAI, Postgres, Pinecone and JWT auth are all replaced with in-memory fakes.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mocks = require('./helpers/mocks');

const openai = mocks.installFakeOpenAI();
const repo = mocks.installFakeRepo();
const vectorStore = mocks.installFakeVectorStore();
mocks.installFakeAuth(1);
mocks.silenceConsole();
const sessionsRouter = require('../routes/sessions');

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', sessionsRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/sessions`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  openai.reset();
  repo.reset();
  vectorStore.reset();
});

async function postSession(body) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Background note generation runs after the response; vector indexing is its last step. */
function waitForBackgroundProcessing(count = 1) {
  return mocks.waitFor(() => vectorStore.indexed.length >= count);
}

function entityReply(...entities) {
  return JSON.stringify({ entities });
}

const katie = {
  personName: 'Katie',
  firstName: 'Katie',
  lastName: null,
  segment: 'Please pray for Katie, she has been really stressed about her exams.',
  facts: ['Katie is stressed about her exams'],
  dates: [],
  summary: 'Katie is stressed about exams',
};

test('creates a new person from a prayer request description', async () => {
  openai.responses.entities = entityReply(katie);
  openai.responses.notes = 'Praying that Katie finds peace as she studies for her exams.';

  const { status, body } = await postSession({ transcript: katie.segment });

  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(repo.persons.length, 1);
  assert.deepEqual(
    { first: repo.persons[0].first_name, last: repo.persons[0].last_name, full: repo.persons[0].full_name },
    { first: 'Katie', last: null, full: 'Katie' }
  );
  assert.equal(body.person.id, repo.persons[0].id);
  assert.equal(repo.sessions.length, 1);
  assert.equal(repo.sessions[0].person_id, body.person.id);
  assert.equal(repo.sessions[0].transcript, katie.segment);
  await waitForBackgroundProcessing();
});

test('splits a first and last name when creating a person', async () => {
  openai.responses.entities = entityReply({
    ...katie,
    personName: 'Katie   Smith',
    firstName: 'Katie',
    lastName: 'Smith',
  });

  await postSession({ transcript: 'Pray for Katie Smith' });

  assert.equal(repo.persons.length, 1);
  assert.equal(repo.persons[0].full_name, 'Katie Smith');
  assert.equal(repo.persons[0].first_name, 'Katie');
  assert.equal(repo.persons[0].last_name, 'Smith');
  await waitForBackgroundProcessing();
});

test('matches an existing person across multiple prayer requests', async () => {
  openai.responses.entities = entityReply(katie);
  const first = await postSession({ transcript: katie.segment });
  await waitForBackgroundProcessing(1);

  openai.responses.entities = entityReply({
    ...katie,
    segment: 'Katie’s exam went well, praying she rests this weekend.',
  });
  const second = await postSession({ transcript: 'Katie’s exam went well, praying she rests this weekend.' });
  await waitForBackgroundProcessing(2);

  assert.equal(repo.persons.length, 1, 'no duplicate person is created');
  assert.equal(second.body.person.id, first.body.person.id);
  assert.deepEqual(
    repo.sessions.map((s) => s.person_id),
    [first.body.person.id, first.body.person.id]
  );
});

test('asks the user to disambiguate when a similar (but not identical) name already exists', async () => {
  await repo.createPerson(1, 'Katie', 'Smith', 'Katie Smith');
  openai.responses.entities = entityReply(katie);

  const { status, body } = await postSession({ transcript: katie.segment });

  assert.equal(status, 200);
  assert.equal(body.needsDisambiguation, true);
  assert.equal(body.extractedName, 'Katie');
  assert.deepEqual(
    body.similarPersons.map((p) => p.full_name),
    ['Katie Smith']
  );
  assert.equal(repo.persons.length, 1, 'nothing is created until the user chooses');
  assert.equal(repo.sessions.length, 0);
});

test('uses the chosen existing person without creating a new one', async () => {
  const existing = await repo.createPerson(1, 'Katie', 'Smith', 'Katie Smith');
  openai.responses.entities = entityReply(katie);

  const { body } = await postSession({ transcript: katie.segment, useExistingPersonId: existing.id });
  await waitForBackgroundProcessing();

  assert.equal(body.person.id, existing.id);
  assert.equal(repo.persons.length, 1);
  assert.equal(repo.sessions[0].person_id, existing.id);
});

test('creates one prayer request per person when a description mentions several people', async () => {
  const josef = {
    personName: 'Josef',
    firstName: 'Josef',
    lastName: null,
    segment: 'I also want to pray for Josef as he moves to Denver.',
    facts: ['Josef is moving to Denver'],
    dates: [],
    summary: 'Josef is moving',
  };
  openai.responses.entities = entityReply(katie, josef);

  const { body } = await postSession({ transcript: `${katie.segment} ${josef.segment}` });
  await waitForBackgroundProcessing(2);

  assert.equal(body.multiEntity, true);
  assert.equal(body.createdCount, 2);
  assert.deepEqual(
    repo.persons.map((p) => p.full_name),
    ['Katie', 'Josef']
  );
  const transcriptsByPerson = Object.fromEntries(
    repo.sessions.map((s) => [repo.persons.find((p) => p.id === s.person_id).full_name, s.transcript])
  );
  assert.deepEqual(transcriptsByPerson, { Katie: katie.segment, Josef: josef.segment });
});

test('stores the AI-generated note on the prayer request after background processing', async () => {
  openai.responses.entities = entityReply(katie);
  openai.responses.notes = 'Here are the notes:\n\nPraying that Katie finds peace as she studies for her exams.';
  openai.responses.eventSummary = 'Prayer request for Katie about exam stress.';

  const { body } = await postSession({ transcript: katie.segment });
  // The response is sent before the note exists; the transcript is the placeholder note.
  assert.equal(body.session.notes, katie.segment);
  assert.equal(body.processing, true);

  await waitForBackgroundProcessing();

  const stored = repo.sessions[0];
  assert.equal(
    stored.notes,
    'Praying that Katie finds peace as she studies for her exams.',
    'model preamble is stripped before saving'
  );
  assert.equal(stored.transcript, katie.segment, 'the original words are kept unchanged');

  const [notesCall] = openai.callsOf('notes');
  assert.match(notesCall.params.messages.at(-1).content, /about Katie/);
  assert.match(notesCall.params.messages.at(-1).content, /stressed about her exams/);

  assert.deepEqual(
    repo.metadata.filter((m) => m.key === 'fact').map((m) => m.value),
    ['Katie is stressed about her exams']
  );
  assert.equal(repo.calendarEvents.length, 1);
  assert.equal(repo.calendarEvents[0].eventType, 'session');
  assert.equal(repo.calendarEvents[0].summary, 'Prayer request for Katie about exam stress.');
});

test('falls back to the original words as the note when note generation fails', async () => {
  openai.responses.entities = entityReply(katie);
  openai.responses.notes = new Error('OpenAI is down');

  await postSession({ transcript: katie.segment });
  await waitForBackgroundProcessing();

  assert.equal(repo.sessions[0].notes, katie.segment);
});

test('asks for the person’s name when the AI reply is malformed', async () => {
  openai.responses.entities = 'this is not json';
  openai.responses.personInfo = '{"personName": "Kat'; // truncated JSON

  const { status, body } = await postSession({ transcript: 'Please pray for my roommate' });

  assert.equal(status, 400);
  assert.equal(body.needsClarification, true);
  assert.equal(repo.persons.length, 0);
  assert.equal(repo.sessions.length, 0);
});

test('asks for the person’s name when the AI reply is empty', async () => {
  openai.responses.entities = { choices: [] };
  openai.responses.personInfo = { choices: [] };

  const { status, body } = await postSession({ transcript: 'Please pray for my roommate' });

  assert.equal(status, 400);
  assert.equal(body.needsClarification, true);
  assert.equal(repo.persons.length, 0);
});

test('still saves the request when the AI fails but the user typed the name', async () => {
  openai.responses.entities = new Error('OpenAI is down');
  openai.responses.personInfo = new Error('OpenAI is down');

  const { status, body } = await postSession({ transcript: 'Please pray for her', personName: 'Katie' });
  await waitForBackgroundProcessing();

  assert.equal(status, 200);
  assert.equal(body.person.full_name, 'Katie');
  assert.equal(repo.sessions.length, 1);
});

test('the server keeps serving requests after a malformed AI response', async () => {
  openai.responses.entities = 'garbage';
  openai.responses.personInfo = 'garbage';
  const failed = await postSession({ transcript: 'Pray for my roommate' });
  assert.equal(failed.status, 400);

  openai.responses.entities = entityReply(katie);
  openai.responses.personInfo = undefined;
  const ok = await postSession({ transcript: katie.segment });
  await waitForBackgroundProcessing();

  assert.equal(ok.status, 200);
  assert.equal(ok.body.person.full_name, 'Katie');
});

test('rejects a request with no description', async () => {
  const { status, body } = await postSession({});

  assert.equal(status, 400);
  assert.equal(body.error, 'Transcript is required');
  assert.equal(openai.calls.length, 0, 'no AI call is made');
});
