/**
 * linda-slack-bridge
 *
 * HTTP endpoint that receives Slack events, forwards messages to Linda
 * (via ElevenLabs Conversational AI), and posts her replies back.
 */
import express from 'express';
import {
  verifySignature,
  postMessage,
  addReaction,
  removeReaction,
  authTest,
  displayName,
} from './slack.js';
import { shouldHandle } from './filter.js';
import { send as sendToLinda } from './elevenlabs.js';

/* ------------------------------------------------------------------ */
/*  Configuration (from environment)                                  */
/* ------------------------------------------------------------------ */

const {
  SLACK_SIGNING_SECRET = '',
  SLACK_BOT_TOKEN = '',
  ELEVENLABS_API_KEY = '',
  ELEVENLABS_AGENT_ID = '',
  DTC_CHANNEL_IDS = '',
  SILENCE_TOKEN = '[[SKIP]]',
  THINKING_EMOJI = 'eyes',
  PORT = '3000',
} = process.env;

const channelIds = DTC_CHANNEL_IDS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/* ------------------------------------------------------------------ */
/*  Chat history (short-term memory per channel)                       */
/*                                                                     */
/*  ElevenLabs closes idle voice connections after a few minutes. We   */
/*  keep the last messages per channel in memory and re-inject them    */
/*  when the bridge reconnects, so Linda keeps her context.            */
/*  Note: in-memory only — a redeploy or Render restart clears it.     */
/* ------------------------------------------------------------------ */

const LINDA_NAME = 'Aunt Linda';
const HISTORY_MAX_MESSAGES = 20;
const HISTORY_TTL_MS = 24 * 60 * 60_000;

/** channel → { messages: string[], touched: number } */
const chatHistory = new Map();

function remember(channel, line) {
  let h = chatHistory.get(channel);
  if (!h) {
    h = { messages: [], touched: 0 };
    chatHistory.set(channel, h);
  }
  h.messages.push(line);
  if (h.messages.length > HISTORY_MAX_MESSAGES) {
    h.messages.splice(0, h.messages.length - HISTORY_MAX_MESSAGES);
  }
  h.touched = Date.now();
}

function recentHistory(channel) {
  return chatHistory.get(channel)?.messages.slice() ?? [];
}

// Evict idle channels hourly so the Map can't grow forever.
setInterval(() => {
  const cutoff = Date.now() - HISTORY_TTL_MS;
  for (const [channel, h] of chatHistory) {
    if (h.touched < cutoff) chatHistory.delete(channel);
  }
}, 60 * 60_000).unref();

/* ------------------------------------------------------------------ */
/*  Event deduplication                                                */
/* ------------------------------------------------------------------ */

const seen = new Set();
const DEDUP_TTL_MS = 5 * 60_000;

function isDuplicate(eventId) {
  if (seen.has(eventId)) return true;
  seen.add(eventId);
  setTimeout(() => seen.delete(eventId), DEDUP_TTL_MS);
  return false;
}

/* ------------------------------------------------------------------ */
/*  Express app                                                       */
/* ------------------------------------------------------------------ */

const app = express();

// We need the raw body for Slack signature verification, so parse as Buffer.
app.use(express.raw({ type: '*/*' }));

/** Health-check (Render uses this). */
app.get('/', (_req, res) => res.send('ok v2'));

/** Cache the bot's own user id (lazy-loaded on first event). */
let botUserId = null;

app.post('/slack/events', async (req, res) => {
  const rawBody = req.body.toString();
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];

  /* --- Verify signature --- */
  if (
    !verifySignature(SLACK_SIGNING_SECRET, {
      timestamp,
      body: rawBody,
      signature,
    })
  ) {
    return res.status(401).send('invalid signature');
  }

  const payload = JSON.parse(rawBody);

  /* --- URL verification challenge (one-time setup handshake) --- */
  if (payload.type === 'url_verification') {
    return res.json({ challenge: payload.challenge });
  }

  /* --- Acknowledge immediately (Slack wants a response in < 3 s) --- */
  res.status(200).send();

  if (payload.type !== 'event_callback') return;

  const event = payload.event;
  if (!event || event.type !== 'message') return;

  /* --- Dedup (Slack can retry) --- */
  if (isDuplicate(payload.event_id)) return;

  /* --- Lazy-discover our own user id --- */
  if (!botUserId) {
    try {
      const auth = await authTest(SLACK_BOT_TOKEN);
      botUserId = auth.user_id;
    } catch {
      /* proceed without — filter will just skip the botUserId check */
    }
  }

  /* --- Filter --- */
  if (!shouldHandle(event, { botUserId, channelIds })) return;

  // Use the channel ID as the conversation key so Linda remembers the whole room's context
  const conversationKey = event.channel;

  try {
    // 👀 thinking indicator
    await addReaction(SLACK_BOT_TOKEN, event.channel, event.ts, THINKING_EMOJI);

    // Build "Speaker: message" prompt
    const speaker = await displayName(SLACK_BOT_TOKEN, event.user);
    const prompt = `${speaker}: ${event.text}`;

    // Snapshot history BEFORE recording the current message — the message is
    // sent as the user turn itself; including it in the injected context
    // block would duplicate it.
    const history = recentHistory(conversationKey);
    remember(conversationKey, prompt);

    // Send to Linda and wait for reply
    const reply = await sendToLinda(conversationKey, prompt, {
      agentId: ELEVENLABS_AGENT_ID,
      apiKey: ELEVENLABS_API_KEY,
      silenceToken: SILENCE_TOKEN,
      history,
    });

    // Remove thinking indicator
    await removeReaction(
      SLACK_BOT_TOKEN, event.channel, event.ts, THINKING_EMOJI,
    ).catch(() => {});

    // Post reply (unless Linda chose silence)
    // If the user's message was in a thread, reply in that thread.
    // If it was a normal channel message, post a normal channel message.
    if (reply !== SILENCE_TOKEN) {
      remember(conversationKey, `${LINDA_NAME}: ${reply}`);
      await postMessage(SLACK_BOT_TOKEN, event.channel, reply, event.thread_ts);
    }
  } catch (err) {
    console.error('Error handling message:', err);
    // Best-effort: remove the thinking emoji so it doesn't stick
    await removeReaction(
      SLACK_BOT_TOKEN, event.channel, event.ts, THINKING_EMOJI,
    ).catch(() => {});
  }
});

/* ------------------------------------------------------------------ */
/*  Start (skip when imported by tests)                               */
/* ------------------------------------------------------------------ */

if (process.env.NODE_ENV !== 'test') {
  app.listen(Number(PORT), () =>
    console.log(`linda-slack-bridge listening on :${PORT}`),
  );
}

export { app };
