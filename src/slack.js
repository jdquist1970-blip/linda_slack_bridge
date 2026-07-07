/**
 * Slack helpers — signature verification + Web API wrappers.
 */
import crypto from 'node:crypto';

const SLACK_API = 'https://slack.com/api';

/* ------------------------------------------------------------------ */
/*  Signature verification                                            */
/* ------------------------------------------------------------------ */

/**
 * Verify the X-Slack-Signature header using the app's signing secret.
 * Returns false for stale timestamps (> 5 min) or mismatched HMACs.
 */
export function verifySignature(signingSecret, { timestamp, body, signature }) {
  const MAX_AGE_S = 5 * 60;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_AGE_S) return false;

  const basestring = `v0:${timestamp}:${body}`;
  const expected =
    'v0=' +
    crypto.createHmac('sha256', signingSecret).update(basestring).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    // lengths differ → definitely not equal
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Web API helpers                                                   */
/* ------------------------------------------------------------------ */

async function api(method, token, body) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Post a message (always in-thread). */
export async function postMessage(token, channel, text, threadTs) {
  return api('chat.postMessage', token, { channel, text, thread_ts: threadTs });
}

/** Add an emoji reaction to a message. */
export async function addReaction(token, channel, timestamp, name) {
  return api('reactions.add', token, { channel, timestamp, name });
}

/** Remove an emoji reaction from a message. */
export async function removeReaction(token, channel, timestamp, name) {
  return api('reactions.remove', token, { channel, timestamp, name });
}

/** Call auth.test to discover the bot's own user id. */
export async function authTest(token) {
  return api('auth.test', token, {});
}

/* ------------------------------------------------------------------ */
/*  Display names (with a simple cache so we don't spam users.info)   */
/* ------------------------------------------------------------------ */

const nameCache = new Map();

export async function displayName(token, userId) {
  if (nameCache.has(userId)) return nameCache.get(userId);
  try {
    const res = await api('users.info', token, { user: userId });
    const name =
      res.user?.profile?.display_name || res.user?.real_name || userId;
    nameCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}
