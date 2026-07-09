/**
 * Sanitizes Linda's replies before they are posted to Slack.
 *
 * The combined agent also serves the website by VOICE, so her replies can
 * contain TTS habits that look wrong in text chat:
 *   1. Bracketed emotion/delivery tags:  "[excited] Oh, you got it!"
 *   2. Spelled-out numbers:              "seven hundred seventy-three dollars"
 *
 * This module strips the tags and converts spelled-out numbers to digits
 * ("$773"). Pure functions — no side-effects, easy to test.
 */

/* ------------------------------------------------------------------ */
/*  1. Emotion tags                                                    */
/* ------------------------------------------------------------------ */

// Matches short bracketed tags of 1–3 lowercase words: [excited], [sighs],
// [warm chuckle]. Deliberately does NOT match [[SKIP]] (double brackets) or
// long bracketed sentences.
const TAG_RE = /(?<!\[)\[[a-z]+(?:[ -][a-z]+){0,2}\](?!\])/gi;

export function stripEmotionTags(text) {
  return text
    .replace(TAG_RE, '')
    .replace(/[ \t]{2,}/g, ' ') // collapse doubled spaces left behind
    .replace(/^[ \t]+/gm, '')   // leading space at line starts
    .trim();
}

/* ------------------------------------------------------------------ */
/*  2. Spelled-out numbers → digits                                    */
/* ------------------------------------------------------------------ */

const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const SCALES = { hundred: 100, thousand: 1_000, million: 1_000_000 };

const NUM_WORD =
  '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|' +
  'thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|' +
  'thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)';

// A run of number words joined by spaces, hyphens, "and", or a comma
// (commas appear in dictated numbers: "sixty-six thousand, nine hundred").
const PHRASE_RE = new RegExp(
  `\\b${NUM_WORD}(?:(?:\\s+and\\s+|,\\s+|[-\\s]+)${NUM_WORD})*\\b`,
  'gi',
);

/** Parse a matched phrase into an integer, or null if it doesn't parse. */
function wordsToNumber(phrase) {
  const tokens = phrase
    .toLowerCase()
    .split(/[\s,-]+/)
    .filter((t) => t && t !== 'and');

  let total = 0;
  let current = 0;
  for (const t of tokens) {
    if (t in UNITS) current += UNITS[t];
    else if (t in TENS) current += TENS[t];
    else if (t === 'hundred') current = (current || 1) * 100;
    else if (t in SCALES) {
      total += (current || 1) * SCALES[t];
      current = 0;
    } else return null;
  }
  return total + current;
}

/**
 * Replace spelled-out numbers with digits, and "<number> dollars" with "$N".
 *
 * Conservative: a lone small word ("one", "two") is left alone unless it is
 * followed by "dollars"/"percent" — so "give me one second" stays natural,
 * but "five dollars" becomes "$5".
 */
export function digitsForNumbers(text) {
  return text.replace(PHRASE_RE, (phrase, offset, whole) => {
    // Commas only continue a number after a scale word ("...thousand, nine
    // hundred and one"). A list like "one, two, three" is NOT one number —
    // split it back apart and convert each piece on its own merits.
    const segments = phrase.split(/,\s*/);
    const groups = [segments[0]];
    for (let i = 1; i < segments.length; i++) {
      const prev = groups[groups.length - 1].trim().toLowerCase();
      if (/(hundred|thousand|million)$/.test(prev)) {
        groups[groups.length - 1] += ', ' + segments[i];
      } else {
        groups.push(segments[i]);
      }
    }

    const afterPhrase = whole.slice(offset + phrase.length);
    const converted = groups.map((g, i) => {
      const value = wordsToNumber(g);
      if (value === null) return g;
      const isLast = i === groups.length - 1;
      const after = isLast ? afterPhrase : '';
      const currencyMatch = after.match(/^\s+dollars?\b/i);
      const percentMatch = after.match(/^\s*percent\b/i);
      const isMultiWord = /[\s-]/.test(g.trim());
      // Leave lone small numbers alone in ordinary prose.
      if (!isMultiWord && value < 10 && !currencyMatch && !percentMatch) {
        return g;
      }
      return value.toLocaleString('en-US');
    });
    return converted.join(', ');
  })
    // Second pass: "12,183 dollars" → "$12,183"; "5 percent" → "5%"
    .replace(/\b([\d,]+)\s+dollars?\b/gi, '$$$1')
    .replace(/\b([\d,]+)\s*percent\b/gi, '$1%');
}

/* ------------------------------------------------------------------ */
/*  Combined                                                           */
/* ------------------------------------------------------------------ */

export function sanitizeForSlack(text) {
  return digitsForNumbers(stripEmotionTags(text));
}
