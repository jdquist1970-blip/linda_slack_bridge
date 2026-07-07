import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifySignature } from '../src/slack.js';

const SECRET = 'test-signing-secret-abc123';

/** Helper — produce a valid {timestamp, signature} pair for a body. */
function sign(body, secret = SECRET, timestampOverride) {
  const timestamp = timestampOverride ?? String(Math.floor(Date.now() / 1000));
  const sig =
    'v0=' +
    crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
  return { timestamp, signature: sig };
}

describe('Slack signature verification', () => {
  it('accepts a valid signature', () => {
    const body = '{"type":"event_callback"}';
    const { timestamp, signature } = sign(body);
    assert.equal(
      verifySignature(SECRET, { timestamp, body, signature }),
      true,
    );
  });

  it('rejects a tampered body', () => {
    const body = '{"type":"event_callback"}';
    const { timestamp, signature } = sign(body);
    assert.equal(
      verifySignature(SECRET, { timestamp, body: body + 'x', signature }),
      false,
    );
  });

  it('rejects a stale timestamp (> 5 min)', () => {
    const body = '{"type":"event_callback"}';
    const staleTs = String(Math.floor(Date.now() / 1000) - 600); // 10 min ago
    const { signature } = sign(body, SECRET, staleTs);
    assert.equal(
      verifySignature(SECRET, { timestamp: staleTs, body, signature }),
      false,
    );
  });
});
