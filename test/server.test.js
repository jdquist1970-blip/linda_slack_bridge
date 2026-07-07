import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

/* --- Set env vars BEFORE the dynamic import of server.js --- */
const SECRET = 'endpoint-test-secret';
process.env.SLACK_SIGNING_SECRET = SECRET;
process.env.SLACK_BOT_TOKEN = 'xoxb-test';
process.env.ELEVENLABS_API_KEY = 'test-key';
process.env.ELEVENLABS_AGENT_ID = 'test-agent';
process.env.DTC_CHANNEL_IDS = 'C_TEST';
process.env.NODE_ENV = 'test';

const { app } = await import('../src/server.js');

/* --- Helpers --- */

function sign(body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig =
    'v0=' +
    crypto
      .createHmac('sha256', SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest('hex');
  return { timestamp, signature: sig };
}

function request(baseUrl, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      url,
      {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: chunks }),
        );
      },
    );
    req.on('error', reject);
    if (data) req.end(data);
    else req.end();
  });
}

/* --- Tests --- */

describe('/slack/events endpoint', () => {
  let server;
  let baseUrl;

  before(
    () =>
      new Promise((resolve) => {
        server = app.listen(0, () => {
          const { port } = server.address();
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      }),
  );

  after(() => server.close());

  it('responds to url_verification challenge', async () => {
    const body = JSON.stringify({
      type: 'url_verification',
      challenge: 'test_challenge_token',
    });
    const { timestamp, signature } = sign(body);

    const res = await request(baseUrl, 'POST', '/slack/events', body, {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
    });

    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.challenge, 'test_challenge_token');
  });

  it('rejects requests with an invalid signature (auth handshake)', async () => {
    const body = JSON.stringify({
      type: 'url_verification',
      challenge: 'nope',
    });

    const res = await request(baseUrl, 'POST', '/slack/events', body, {
      'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-slack-signature': 'v0=definitely_wrong',
    });

    assert.equal(res.status, 401);
  });
});
