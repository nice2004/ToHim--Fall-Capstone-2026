/**
 * Parse human-typed Bible references ("Philippians 4:6", "phil 4:6-7", "1 John 4",
 * "Ps 23:1-3", "John 3:16-4:2") into api.bible passage IDs ("PHP.4.6-PHP.4.7").
 *
 * api.bible's /search endpoint does not resolve references for every Bible
 * (it returns zero hits for "Philippians 4:6" on NIV), so we build the passage
 * ID ourselves and fetch it from /passages/{id}.
 */

// [USFM code, display name, ...extra aliases]. Display name and code are aliases too.
const BOOKS = [
  ['GEN', 'Genesis', 'gen', 'ge', 'gn'],
  ['EXO', 'Exodus', 'exod', 'exo', 'ex'],
  ['LEV', 'Leviticus', 'lev', 'le', 'lv'],
  ['NUM', 'Numbers', 'num', 'nu', 'nm'],
  ['DEU', 'Deuteronomy', 'deut', 'deu', 'dt'],
  ['JOS', 'Joshua', 'josh', 'jos', 'jsh'],
  ['JDG', 'Judges', 'judg', 'jdg', 'jg'],
  ['RUT', 'Ruth', 'rut', 'ru', 'rth'],
  ['1SA', '1 Samuel', '1 sam', '1sam', '1 sa', '1sa', 'i samuel', 'first samuel'],
  ['2SA', '2 Samuel', '2 sam', '2sam', '2 sa', '2sa', 'ii samuel', 'second samuel'],
  ['1KI', '1 Kings', '1 kgs', '1kgs', '1 ki', '1ki', 'i kings', 'first kings'],
  ['2KI', '2 Kings', '2 kgs', '2kgs', '2 ki', '2ki', 'ii kings', 'second kings'],
  ['1CH', '1 Chronicles', '1 chron', '1chron', '1 chr', '1chr', '1 ch', 'i chronicles', 'first chronicles'],
  ['2CH', '2 Chronicles', '2 chron', '2chron', '2 chr', '2chr', '2 ch', 'ii chronicles', 'second chronicles'],
  ['EZR', 'Ezra', 'ezr'],
  ['NEH', 'Nehemiah', 'neh', 'ne'],
  ['EST', 'Esther', 'esth', 'est', 'es'],
  ['JOB', 'Job', 'jb'],
  ['PSA', 'Psalm', 'psalms', 'ps', 'psa', 'pss', 'psm'],
  ['PRO', 'Proverbs', 'prov', 'pro', 'prv', 'pr'],
  ['ECC', 'Ecclesiastes', 'eccl', 'ecc', 'ec', 'qoh'],
  ['SNG', 'Song of Songs', 'song of solomon', 'song', 'sos', 'sng', 'canticles'],
  ['ISA', 'Isaiah', 'isa', 'is'],
  ['JER', 'Jeremiah', 'jer', 'je', 'jr'],
  ['LAM', 'Lamentations', 'lam', 'la'],
  ['EZK', 'Ezekiel', 'ezek', 'eze', 'ezk'],
  ['DAN', 'Daniel', 'dan', 'da', 'dn'],
  ['HOS', 'Hosea', 'hos', 'ho'],
  ['JOL', 'Joel', 'joe', 'jl'],
  ['AMO', 'Amos', 'amo', 'am'],
  ['OBA', 'Obadiah', 'obad', 'oba', 'ob'],
  ['JON', 'Jonah', 'jon', 'jnh'],
  ['MIC', 'Micah', 'mic', 'mc'],
  ['NAM', 'Nahum', 'nah', 'nam', 'na'],
  ['HAB', 'Habakkuk', 'hab', 'hb'],
  ['ZEP', 'Zephaniah', 'zeph', 'zep', 'zp'],
  ['HAG', 'Haggai', 'hag', 'hg'],
  ['ZEC', 'Zechariah', 'zech', 'zec', 'zc'],
  ['MAL', 'Malachi', 'mal', 'ml'],
  ['MAT', 'Matthew', 'matt', 'mat', 'mt'],
  ['MRK', 'Mark', 'mrk', 'mar', 'mk', 'mr'],
  ['LUK', 'Luke', 'luk', 'lk'],
  ['JHN', 'John', 'jhn', 'jn', 'joh'],
  ['ACT', 'Acts', 'act', 'ac'],
  ['ROM', 'Romans', 'rom', 'ro', 'rm'],
  ['1CO', '1 Corinthians', '1 cor', '1cor', '1 co', '1co', 'i corinthians', 'first corinthians'],
  ['2CO', '2 Corinthians', '2 cor', '2cor', '2 co', '2co', 'ii corinthians', 'second corinthians'],
  ['GAL', 'Galatians', 'gal', 'ga'],
  ['EPH', 'Ephesians', 'eph', 'ephes'],
  ['PHP', 'Philippians', 'phil', 'php', 'pp', 'philip'],
  ['COL', 'Colossians', 'col', 'co'],
  ['1TH', '1 Thessalonians', '1 thess', '1thess', '1 th', '1th', 'i thessalonians', 'first thessalonians'],
  ['2TH', '2 Thessalonians', '2 thess', '2thess', '2 th', '2th', 'ii thessalonians', 'second thessalonians'],
  ['1TI', '1 Timothy', '1 tim', '1tim', '1 ti', '1ti', 'i timothy', 'first timothy'],
  ['2TI', '2 Timothy', '2 tim', '2tim', '2 ti', '2ti', 'ii timothy', 'second timothy'],
  ['TIT', 'Titus', 'tit', 'ti'],
  ['PHM', 'Philemon', 'philem', 'phm', 'pm'],
  ['HEB', 'Hebrews', 'heb'],
  ['JAS', 'James', 'jas', 'jm'],
  ['1PE', '1 Peter', '1 pet', '1pet', '1 pe', '1pe', 'i peter', 'first peter'],
  ['2PE', '2 Peter', '2 pet', '2pet', '2 pe', '2pe', 'ii peter', 'second peter'],
  ['1JN', '1 John', '1 jn', '1jn', '1 jhn', '1jhn', '1 jo', 'i john', 'first john'],
  ['2JN', '2 John', '2 jn', '2jn', '2 jhn', '2jhn', 'ii john', 'second john'],
  ['3JN', '3 John', '3 jn', '3jn', '3 jhn', '3jhn', 'iii john', 'third john'],
  ['JUD', 'Jude', 'jud', 'jd'],
  ['REV', 'Revelation', 'revelations', 'rev', 're', 'rv'],
];

const ORDINAL_PREFIXES = { i: '1', ii: '2', iii: '3', first: '1', second: '2', third: '3' };

const aliasToBook = new Map();
const codeToName = new Map();
for (const [code, name, ...aliases] of BOOKS) {
  codeToName.set(code, name);
  for (const alias of [name, code, ...aliases]) {
    aliasToBook.set(normalizeBookName(alias), code);
  }
}


function normalizeBookName(s) {
  return String(s)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // "1john" → "1 john"; roman/word ordinals need a space so "isaiah" stays intact
    .replace(/^([123])\s*(?=[a-z])/, '$1 ')
    .replace(/^(iii|ii|i|first|second|third) (?=[a-z])/, (m, p) => `${ORDINAL_PREFIXES[p]} `);
}

// "<book> <chapter>[:<verse>[-[<chapter>:]<verse>]]"
const REFERENCE_RE =
  /^\s*((?:[123]|i{1,3}|first|second|third)?\s*[a-z][a-z.\s]*?)\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–—]\s*(?:(\d{1,3})\s*[:.]\s*)?(\d{1,3}))?)?\s*$/i;

/**
 * @returns {{ passageId: string, reference: string, bookCode: string } | null}
 */
function parseReference(input) {
  if (!input || typeof input !== 'string') return null;
  const m = input.match(REFERENCE_RE);
  if (!m) return null;

  const [, rawBook, chapterStr, verseStr, endChapterStr, endVerseStr] = m;
  const bookCode = aliasToBook.get(normalizeBookName(rawBook));
  if (!bookCode) return null;

  const name = codeToName.get(bookCode);
  const chapter = Number(chapterStr);
  if (!chapter) return null;

  if (!verseStr) {
    return { bookCode, passageId: `${bookCode}.${chapter}`, reference: `${name} ${chapter}` };
  }

  const verse = Number(verseStr);
  const start = `${bookCode}.${chapter}.${verse}`;
  if (!endVerseStr) {
    return { bookCode, passageId: start, reference: `${name} ${chapter}:${verse}` };
  }

  const endChapter = endChapterStr ? Number(endChapterStr) : chapter;
  const endVerse = Number(endVerseStr);
  if (endChapter < chapter || (endChapter === chapter && endVerse <= verse)) {
    return { bookCode, passageId: start, reference: `${name} ${chapter}:${verse}` };
  }
  const reference =
    endChapter === chapter
      ? `${name} ${chapter}:${verse}-${endVerse}`
      : `${name} ${chapter}:${verse}-${endChapter}:${endVerse}`;
  return { bookCode, passageId: `${start}-${bookCode}.${endChapter}.${endVerse}`, reference };
}

/** "MAT.6.34" → "Matthew 6:34" (api.bible's own references are abbreviated, e.g. "Matt. 6:34"). */
function referenceFromVerseId(verseId) {
  const m = String(verseId || '').match(/^([1-3A-Z]{3})\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const name = codeToName.get(m[1]);
  return name ? `${name} ${m[2]}:${m[3]}` : null;
}

/** Expand a passage/verse ID into the individual verse IDs it covers (same-chapter ranges only). */
function verseIdsInPassage(passageId) {
  const [startId, endId] = String(passageId || '').split('-');
  const s = startId && startId.match(/^([1-3A-Z]{3})\.(\d+)\.(\d+)$/);
  if (!s) return [startId];
  const e = endId && endId.match(/^([1-3A-Z]{3})\.(\d+)\.(\d+)$/);
  if (!e || e[2] !== s[2]) return [startId];
  const ids = [];
  for (let v = Number(s[3]); v <= Number(e[3]) && ids.length < 200; v += 1) {
    ids.push(`${s[1]}.${s[2]}.${v}`);
  }
  return ids;
}

module.exports = { parseReference, referenceFromVerseId, verseIdsInPassage };
