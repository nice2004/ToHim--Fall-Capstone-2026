/**
 * Deterministic handling of everyday relative dates in prayer requests ("Katie has an exam
 * tomorrow", "his surgery is Friday", "in 3 days").
 *
 * The AI pipeline extracts and normalizes dates too, but it is a chain of model calls and any
 * miss there silently drops the date (no calendar event, nothing in "Coming up"). These helpers
 * are the safety net: they find the common phrases in the text and resolve them against the
 * user's own "today", so the simple cases always land on the right day.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  'a couple of': 2, 'a couple': 2,
};

/** YYYY-MM-DD for `date` as seen in `timeZone` (falls back to the server's zone). */
function localYmd(date = new Date(), timeZone = null) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const parts = fmt.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(ymd) {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

const WEEKDAY_RE = WEEKDAYS.join('|');
const COUNT_RE = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|a couple(?: of)?)';

// Ordered most specific first; each phrase is matched once per text.
const PHRASES = [
  { re: /\b(?:the\s+)?day\s+after\s+tomorrow\b/i, resolve: (today) => addDays(today, 2) },
  { re: /\btomorrow(?:\s+(?:morning|afternoon|evening|night))?\b/i, resolve: (today) => addDays(today, 1) },
  { re: /\b(?:today|tonight|this\s+(?:morning|afternoon|evening))\b/i, resolve: (today) => today },
  {
    re: new RegExp(`\\bin\\s+${COUNT_RE}\\s+(days?|weeks?)\\b`, 'i'),
    resolve: (today, m) => {
      const raw = m[1].toLowerCase();
      const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
      if (!n) return null;
      return addDays(today, /^week/i.test(m[2]) ? n * 7 : n);
    },
  },
  {
    // "next week" is left to the AI: it's a span, not a day.
    re: /\bin\s+a\s+week\b/i,
    resolve: (today) => addDays(today, 7),
  },
  {
    re: new RegExp(`\\bnext\\s+(${WEEKDAY_RE})\\b`, 'i'),
    // "next Friday" = the Friday of the following week (matches aiService's existing rule).
    resolve: (today, m) => {
      const target = WEEKDAYS.indexOf(m[1].toLowerCase());
      return addDays(today, ((target - weekdayOf(today) + 7) % 7) + 7);
    },
  },
  {
    // "this Friday", "on Friday", "Friday" (but not "last Friday"): the next one, today included.
    re: new RegExp(`(?<!\\blast\\s)\\b(?:this\\s+|on\\s+)?(${WEEKDAY_RE})\\b`, 'i'),
    resolve: (today, m) => {
      const target = WEEKDAYS.indexOf(m[1].toLowerCase());
      return addDays(today, (target - weekdayOf(today) + 7) % 7);
    },
  },
];

/** The sentence around a match, as a short context ("Katie has an exam tomorrow"). */
function sentenceAround(text, index) {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?')) + 1;
  const rest = text.slice(index);
  const endRel = rest.search(/[.!?]/);
  const sentence = text.slice(start, endRel === -1 ? text.length : index + endRel).trim();
  return sentence.length > 100 ? `${sentence.slice(0, 97)}...` : sentence;
}

/**
 * Find everyday relative-date phrases in `text`.
 * @returns {{ dateString: string, context: string }[]}
 */
function detectRelativeDates(text) {
  const source = String(text || '');
  const found = [];
  const taken = []; // [start, end) ranges already matched, so "day after tomorrow" isn't also "tomorrow"
  for (const { re } of PHRASES) {
    const global = new RegExp(re.source, 'gi');
    let m;
    while ((m = global.exec(source)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      found.push({ dateString: m[0].trim(), context: sentenceAround(source, start), index: start });
    }
  }
  return found.sort((a, b) => a.index - b.index).map(({ dateString, context }) => ({ dateString, context }));
}

/**
 * Resolve a date phrase to YYYY-MM-DD against `todayYmd`, or null if it isn't one of the
 * everyday phrases above (absolute dates, "someday", etc. are left to the AI).
 * Only whole-phrase matches count, so "tomorrow at 8am" resolves but "March 3" does not.
 */
function resolveRelativeDate(phrase, todayYmd) {
  const text = String(phrase || '').trim();
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayYmd))) return null;
  for (const { re, resolve } of PHRASES) {
    const m = text.match(re);
    if (!m) continue;
    // Allow a trailing time ("tomorrow at 8 am", "Friday evening") but nothing that changes the day.
    const leftover = (text.slice(0, m.index) + text.slice(m.index + m[0].length))
      .replace(/\b(at|around|by|in the|morning|afternoon|evening|night|noon|\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?)\b/gi, '')
      .replace(/[\s,.-]+/g, '');
    if (leftover) return null;
    return resolve(todayYmd, m);
  }
  return null;
}

/**
 * Add any detected phrases the AI's date list doesn't already cover.
 * @param {{ dateString?: string }[] | string[]} aiDates
 */
function mergeDetectedDates(aiDates, text) {
  const list = Array.isArray(aiDates) ? [...aiDates] : [];
  const covered = list.map((d) => String(typeof d === 'string' ? d : d?.dateString || '').toLowerCase());
  for (const detected of detectRelativeDates(text)) {
    const phrase = detected.dateString.toLowerCase();
    if (covered.some((c) => c && (c.includes(phrase) || phrase.includes(c)))) continue;
    list.push(detected);
    covered.push(phrase);
  }
  return list;
}

module.exports = { localYmd, addDays, detectRelativeDates, resolveRelativeDate, mergeDetectedDates };
