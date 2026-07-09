import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripEmotionTags,
  digitsForNumbers,
  sanitizeForSlack,
} from '../src/sanitize.js';

/* ---------------- emotion tags ---------------- */

test('strips a leading emotion tag', () => {
  assert.equal(
    stripEmotionTags('[excited] Oh, you got it!'),
    'Oh, you got it!',
  );
});

test('strips tags mid-sentence and multi-word tags', () => {
  assert.equal(
    stripEmotionTags('Well [warm chuckle] that is [sighs] something.'),
    'Well that is something.',
  );
});

test('does not strip the [[SKIP]] silence token', () => {
  assert.equal(stripEmotionTags('[[SKIP]]'), '[[SKIP]]');
});

test('leaves long bracketed content alone', () => {
  const s = '[this is a long bracketed aside that is not a tag]';
  assert.equal(stripEmotionTags(s), s);
});

/* ---------------- numbers ---------------- */

test('converts dollar amounts to $digits', () => {
  assert.equal(
    digitsForNumbers('seven hundred seventy-three dollars a month'),
    '$773 a month',
  );
});

test('converts large numbers with comma continuation', () => {
  assert.equal(
    digitsForNumbers(
      'five hundred sixty-six thousand, nine hundred and one',
    ),
    '566,901',
  );
});

test('converts plain thousands', () => {
  assert.equal(
    digitsForNumbers('twelve thousand one hundred eighty-three annually'),
    '12,183 annually',
  );
  assert.equal(
    digitsForNumbers('a five thousand dollar deductible'),
    'a $5,000 deductible',
  );
});

test('leaves lone small numbers in prose alone', () => {
  assert.equal(
    digitsForNumbers('give me one second, that is a good one'),
    'give me one second, that is a good one',
  );
});

test('does not merge comma-separated lists into one number', () => {
  assert.equal(digitsForNumbers('one, two, three'), 'one, two, three');
});

test('converts percent', () => {
  assert.equal(digitsForNumbers('about fifteen percent'), 'about 15%');
});

/* ---------------- combined, real transcript ---------------- */

test('cleans the actual Slack transcript example', () => {
  const input =
    "[excited] Oh, you got it! Let me pull that quote for JD right now! " +
    "Benchmark Specialty just quoted JD's Vero Beach property at seven " +
    'hundred seventy-three dollars a month, or twelve thousand one hundred ' +
    'eighty-three annually. Dwelling coverage is five hundred sixty-six ' +
    'thousand, nine hundred and one, with a five thousand dollar deductible.';
  const out = sanitizeForSlack(input);
  assert.ok(!out.includes('['), 'no brackets remain');
  assert.ok(out.includes('$773 a month'), out);
  assert.ok(out.includes('12,183 annually'), out);
  assert.ok(out.includes('566,901'), out);
  assert.ok(out.includes('$5,000 deductible'), out);
});
