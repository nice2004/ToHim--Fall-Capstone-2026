/**
 * Tests for the reminder body validator used by POST/PUT /api/reminders.
 * Postgres and JWT auth are replaced with fakes so requiring the router has no side effects.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mocks = require('./helpers/mocks');

mocks.installFakeRepo();
mocks.installFakeAuth(1);
const { validateReminderInput } = require('../routes/reminders');

const valid = { title: 'Pray for Katie', remindDate: '2026-10-16', remindTime: '08:00', repeat: 'weekly' };

test('accepts a well-formed reminder and normalizes optional ids', () => {
  const { value, error } = validateReminderInput({ ...valid, title: '  Pray for Katie  ', sessionId: '12' });
  assert.equal(error, undefined);
  assert.deepEqual(value, {
    title: 'Pray for Katie',
    remindDate: '2026-10-16',
    remindTime: '08:00',
    repeat: 'weekly',
    notify: true,
    personId: null,
    sessionId: 12,
  });
});

test('defaults repeat to once', () => {
  const { value } = validateReminderInput({ ...valid, repeat: undefined });
  assert.equal(value.repeat, 'once');
});

test('keeps notify off when asked and rejects non-boolean notify', () => {
  assert.equal(validateReminderInput({ ...valid, notify: false }).value.notify, false);
  assert.match(validateReminderInput({ ...valid, notify: 'no' }).error, /notify/);
});

test('rejects missing or blank title', () => {
  assert.match(validateReminderInput({ ...valid, title: '   ' }).error, /title/);
  assert.match(validateReminderInput({ ...valid, title: undefined }).error, /title/);
});

test('rejects malformed and impossible dates', () => {
  assert.match(validateReminderInput({ ...valid, remindDate: '10/16/2026' }).error, /remindDate/);
  assert.match(validateReminderInput({ ...valid, remindDate: '2026-02-30' }).error, /real date/);
});

test('rejects out-of-range or malformed times', () => {
  assert.match(validateReminderInput({ ...valid, remindTime: '24:00' }).error, /remindTime/);
  assert.match(validateReminderInput({ ...valid, remindTime: '8:00' }).error, /remindTime/);
  assert.match(validateReminderInput({ ...valid, remindTime: '08:60' }).error, /remindTime/);
});

test('rejects unknown repeat values', () => {
  assert.match(validateReminderInput({ ...valid, repeat: 'monthly' }).error, /repeat/);
});

test('rejects non-integer ids', () => {
  assert.match(validateReminderInput({ ...valid, personId: 'abc' }).error, /integers/);
});
