import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildContextBlock } from '../src/elevenlabs.js';

describe('buildContextBlock', () => {
  it('returns null for empty or missing history', () => {
    assert.equal(buildContextBlock([]), null);
    assert.equal(buildContextBlock(undefined), null);
  });

  it('includes history lines in chronological order', () => {
    const block = buildContextBlock([
      'JD: I need a quote',
      'Aunt Linda: I can help with that!',
      'JD: What about auto?',
    ]);
    assert.ok(block.includes('JD: I need a quote'));
    assert.ok(
      block.indexOf('I need a quote') < block.indexOf('What about auto?'),
    );
  });

  it('tells the agent not to mention the block', () => {
    const block = buildContextBlock(['JD: hi']);
    assert.match(block, /do not mention/i);
  });

  it('keeps the newest lines when over the character budget', () => {
    const history = [];
    for (let i = 0; i < 100; i++) {
      history.push(`User: message number ${i} ${'x'.repeat(100)}`);
    }
    const block = buildContextBlock(history);
    assert.ok(block.length < 3_500);
    assert.ok(block.includes('message number 99')); // newest kept
    assert.ok(!block.includes('message number 0 ')); // oldest dropped
  });
});
