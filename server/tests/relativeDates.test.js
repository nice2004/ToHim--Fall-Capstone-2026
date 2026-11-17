/** Everyday relative dates in prayer requests ("exam tomorrow") resolve to the right local day. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  localYmd,
  detectRelativeDates,
  resolveRelativeDate,
  mergeDetectedDates,
} = require('../utils/relativeDates');

// 2026-11-14 is a Saturday.
const TODAY = '2026-11-14';

test('resolves everyday phrases against the given day', () => {
  const cases = {
    today: '2026-11-14',
    tonight: '2026-11-14',
    'this evening': '2026-11-14',
    tomorrow: '2026-11-15',
    Tomorrow: '2026-11-15',
    'tomorrow morning': '2026-11-15',
    'tomorrow at 8 am': '2026-11-15',
    'the day after tomorrow': '2026-11-16',
    'in 3 days': '2026-11-17',
    'in two weeks': '2026-11-28',
    'in a week': '2026-11-21',
    Monday: '2026-11-16',
    'on Friday': '2026-11-20',
    'this Saturday': '2026-11-14',
    'next Monday': '2026-11-23',
    'Friday evening': '2026-11-20',
  };
  for (const [phrase, expected] of Object.entries(cases)) {
    assert.equal(resolveRelativeDate(phrase, TODAY), expected, phrase);
  }
});

test('leaves vague or absolute dates to the AI', () => {
  for (const phrase of ['next week', 'someday', 'March 3', 'this weekend', 'tomorrow or March 3', '']) {
    assert.equal(resolveRelativeDate(phrase, TODAY), null, phrase);
  }
});

test('finds the date phrase in a natural prayer request', () => {
  assert.deepEqual(detectRelativeDates('Katie has an exam tomorrow. Pray she feels calm.'), [
    { dateString: 'tomorrow', context: 'Katie has an exam tomorrow' },
  ]);
  assert.deepEqual(
    detectRelativeDates('His surgery is the day after tomorrow').map((d) => d.dateString),
    ['the day after tomorrow'],
    '"tomorrow" inside "day after tomorrow" is not counted twice'
  );
  assert.deepEqual(detectRelativeDates('We talked last Friday about her move'), []);
  assert.deepEqual(detectRelativeDates('Please pray for my mom'), []);
});

test('adds only the dates the AI missed', () => {
  const text = 'Katie has an exam tomorrow and a recital on Friday.';
  const merged = mergeDetectedDates([{ dateString: 'tomorrow', context: "Katie's exam" }], text);
  assert.deepEqual(merged.map((d) => d.dateString), ['tomorrow', 'on Friday']);
  assert.equal(merged[0].context, "Katie's exam", 'the AI entry is kept as-is');
});

test('"today" follows the user\'s time zone, not the server\'s', () => {
  // 03:30 UTC on Nov 15 is still the evening of Nov 14 in California.
  const instant = new Date('2026-11-15T03:30:00Z');
  assert.equal(localYmd(instant, 'America/Los_Angeles'), '2026-11-14');
  assert.equal(localYmd(instant, 'UTC'), '2026-11-15');
});
