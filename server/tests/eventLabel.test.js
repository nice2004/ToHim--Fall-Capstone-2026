/** Short labels for Home's Today/Tomorrow card: "Ella · Exam", not a cut-off sentence. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanLabel, labelFromText, fallbackEventLabel } = require('../utils/eventLabel');

test('pulls the event out of a natural sentence', () => {
  const cases = [
    ['I am praying for Ella as she has an exam tomorrow', 'Ella', 'Exam'],
    ["Ella's exam", 'Ella', 'Exam'],
    ['Katie has her chemistry exam on Friday', 'Katie', 'Chemistry exam'],
    ["Praying for Ella's mom's surgery", 'Ella', "Mom's surgery"],
    ['Josh has a job interview tomorrow morning', 'Josh', 'Job interview'],
    ['her MRI results come back today', 'Sam', 'MRI'],
    ['Please pray for my friend', 'Ana', null],
  ];
  for (const [text, name, expected] of cases) {
    assert.equal(labelFromText(text, name), expected, text);
  }
});

test('keeps a model label only if it is short and free of names and dates', () => {
  assert.equal(cleanLabel('Exam', 'Ella'), 'Exam');
  assert.equal(cleanLabel("Ella's exam tomorrow", 'Ella'), 'Exam');
  assert.equal(cleanLabel('flight home.', 'Ella'), 'Flight home');
  assert.equal(cleanLabel('I am praying that she does well on her exam', 'Ella'), null);
  assert.equal(cleanLabel(null, 'Ella'), null);
  assert.equal(cleanLabel('Tomorrow', 'Ella'), null);
});

test('falls back from the date context to the summary', () => {
  assert.equal(fallbackEventLabel({ context: "Ella's exam", personName: 'Ella' }), 'Exam');
  assert.equal(fallbackEventLabel({ context: 'recital', personName: 'Ella' }), 'Recital');
  assert.equal(
    fallbackEventLabel({
      context: 'Ella is feeling anxious about everything coming up this week',
      summary: 'I am praying for Ella as she has an exam tomorrow.',
      personName: 'Ella',
    }),
    'Exam'
  );
  assert.equal(fallbackEventLabel({ context: null, summary: 'Praying for peace.', personName: 'Ella' }), null);
});
