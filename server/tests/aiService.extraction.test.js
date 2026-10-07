/**
 * Unit tests for the AI extraction step of the prayer-request pipeline
 * (aiService.extractPersonInfo / extractEntitiesFromTranscript). OpenAI is mocked.
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mocks = require('./helpers/mocks');

const openai = mocks.installFakeOpenAI();
mocks.silenceConsole();
const aiService = require('../services/aiService');

beforeEach(() => openai.reset());

test('extractPersonInfo returns the parsed person and trims stray whitespace from names', async () => {
  openai.responses.personInfo = JSON.stringify({
    personName: '  Katie   Smith ',
    firstName: ' Katie ',
    lastName: 'Smith ',
    facts: ['Katie is my roommate'],
    dates: [{ dateString: 'Friday', context: 'Katie’s exam' }],
    summary: 'Praying for Katie’s exam',
  });

  const info = await aiService.extractPersonInfo('Please pray for Katie Smith, her exam is Friday');

  assert.equal(info.personName, 'Katie Smith');
  assert.equal(info.firstName, 'Katie');
  assert.equal(info.lastName, 'Smith');
  assert.deepEqual(info.facts, ['Katie is my roommate']);
  assert.equal(info.dates.length, 1);
  assert.equal(openai.callsOf('personInfo').length, 1);
});

test('extractPersonInfo sends the transcript to OpenAI in JSON mode', async () => {
  openai.responses.personInfo = JSON.stringify({ personName: 'Katie' });

  await aiService.extractPersonInfo('Pray for Katie');

  const [{ params }] = openai.callsOf('personInfo');
  assert.deepEqual(params.response_format, { type: 'json_object' });
  assert.match(params.messages.at(-1).content, /Pray for Katie/);
});

test('extractPersonInfo maps a missing or empty name to null', async () => {
  openai.responses.personInfo = JSON.stringify({ personName: '', firstName: '', facts: [] });

  const info = await aiService.extractPersonInfo('Pray for my week');

  assert.equal(info.personName, null);
  assert.equal(info.firstName, null);
  assert.equal(info.lastName, null);
});

test('extractPersonInfo falls back to an empty result when the model returns malformed JSON', async () => {
  openai.responses.personInfo = 'Sure! The person is Katie.';

  const info = await aiService.extractPersonInfo('Pray for Katie');

  assert.deepEqual(info, {
    personName: null,
    firstName: null,
    lastName: null,
    facts: [],
    dates: [],
    summary: '',
  });
});

test('extractPersonInfo falls back to an empty result when the model reply is empty', async () => {
  openai.responses.personInfo = '';

  const info = await aiService.extractPersonInfo('Pray for Katie');

  assert.equal(info.personName, null);
});

test('extractPersonInfo surfaces OpenAI API failures with a readable message', async () => {
  openai.responses.personInfo = Object.assign(new Error('Rate limited'), { status: 429 });

  await assert.rejects(aiService.extractPersonInfo('Pray for Katie'), /rate limit exceeded/i);
});

test('extractEntitiesFromTranscript returns one cleaned entry per person', async () => {
  openai.responses.entities = JSON.stringify({
    entities: [
      {
        personName: ' Katie ',
        segment: ' Katie has an exam Friday. ',
        facts: ['Katie has an exam'],
        dates: [{ dateString: 'Friday', context: 'exam' }],
        summary: 'Exam',
      },
      { personName: 'Josef', segment: 'Josef is moving.', facts: 'not-an-array' },
    ],
  });

  const entities = await aiService.extractEntitiesFromTranscript(
    'Katie has an exam Friday. Josef is moving.'
  );

  assert.equal(entities.length, 2);
  assert.deepEqual(entities[0], {
    personName: 'Katie',
    firstName: null,
    lastName: null,
    segment: 'Katie has an exam Friday.',
    facts: ['Katie has an exam'],
    dates: [{ dateString: 'Friday', context: 'exam' }],
    summary: 'Exam',
  });
  assert.equal(entities[1].personName, 'Josef');
  assert.deepEqual(entities[1].facts, [], 'non-array facts are dropped');
  assert.deepEqual(entities[1].dates, []);
});

test('extractEntitiesFromTranscript drops entities without a name', async () => {
  openai.responses.entities = JSON.stringify({
    entities: [{ personName: null, segment: 'something' }, { personName: '   ' }, { personName: 'Mom' }],
  });

  const entities = await aiService.extractEntitiesFromTranscript('Pray for Mom');

  assert.deepEqual(
    entities.map((e) => e.personName),
    ['Mom']
  );
});

test('extractEntitiesFromTranscript returns [] instead of throwing on malformed, empty, or failed replies', async () => {
  for (const reply of ['not json at all', '', JSON.stringify({ entities: 'nope' }), { choices: [] }, new Error('boom')]) {
    openai.responses.entities = reply;
    assert.deepEqual(await aiService.extractEntitiesFromTranscript('Pray for Katie'), []);
  }
});
