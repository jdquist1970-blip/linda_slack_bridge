import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandle } from '../src/filter.js';

const BASE_EVENT = {
  type: 'message',
  user: 'U_HUMAN',
  text: 'hello!',
  channel: 'C_DTC',
  ts: '1700000000.000001',
};

const OPTS = { botUserId: 'U_BOT', channelIds: ['C_DTC'] };

describe('Event filter', () => {
  it('accepts a normal user message in an allowed channel', () => {
    assert.equal(shouldHandle(BASE_EVENT, OPTS), true);
  });

  it('rejects a bot message (has bot_id)', () => {
    assert.equal(
      shouldHandle({ ...BASE_EVENT, bot_id: 'B123' }, OPTS),
      false,
    );
  });

  it('rejects a message with a subtype (edit, delete, join, etc.)', () => {
    assert.equal(
      shouldHandle({ ...BASE_EVENT, subtype: 'message_changed' }, OPTS),
      false,
    );
  });

  it('rejects a message in a non-allowed channel', () => {
    assert.equal(
      shouldHandle({ ...BASE_EVENT, channel: 'C_OTHER' }, OPTS),
      false,
    );
  });
});
