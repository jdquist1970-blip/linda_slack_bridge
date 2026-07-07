/**
 * Persistent per-thread ElevenLabs conversations (text mode).
 *
 * One WebSocket is kept alive per Slack thread so Linda retains context
 * across multiple messages in the same thread.
 */
import WebSocket from 'ws';

const API_BASE = 'https://api.elevenlabs.io/v1';
const CONNECT_TIMEOUT_MS = 15_000;
const RESPONSE_TIMEOUT_MS = 30_000;

/** threadTs → { ws } */
const conversations = new Map();

/* ------------------------------------------------------------------ */
/*  Connection                                                        */
/* ------------------------------------------------------------------ */

/**
 * Fetch a short-lived signed WebSocket URL for the agent.
 */
async function getSignedUrl(agentId, apiKey) {
  const res = await fetch(
    `${API_BASE}/convai/conversation/get_signed_url?agent_id=${agentId}`,
    { headers: { 'xi-api-key': apiKey } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ElevenLabs signed-url ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.signed_url;
}

/**
 * Open a new WebSocket conversation in text-only mode.
 * Resolves once the server confirms initiation.
 */
function connect(agentId, apiKey) {
  return new Promise(async (resolve, reject) => {
    let url;
    try {
      url = await getSignedUrl(agentId, apiKey);
    } catch (err) {
      return reject(err);
    }

    const ws = new WebSocket(url);
    let settled = false;

    ws.once('open', () => {
      // Request text-only mode (no TTS audio) and suppress the first message for Slack.
      ws.send(
        JSON.stringify({
          type: 'conversation_initiation_client_data',
          conversation_config_override: {
            agent: { 
              tts: { enabled: false },
              first_message: ""
            },
          },
        }),
      );
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);

        // Server confirms the conversation is ready.
        if (msg.type === 'conversation_initiation_metadata' && !settled) {
          settled = true;
          resolve(ws);
        }

        // Respond to keep-alive pings.
        if (msg.type === 'ping' && msg.ping_event) {
          ws.send(
            JSON.stringify({ type: 'pong', event_id: msg.ping_event.event_id }),
          );
        }
      } catch { /* ignore non-JSON frames */ }
    });

    ws.once('error', (err) => {
      if (!settled) { settled = true; reject(err); }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error('ElevenLabs conversation connection timed out'));
      }
    }, CONNECT_TIMEOUT_MS);
  });
}

/* ------------------------------------------------------------------ */
/*  Send a message and collect Linda's reply                          */
/* ------------------------------------------------------------------ */

/**
 * Send user text to the Linda conversation for the given thread.
 * Creates (or reconnects) the conversation as needed.
 *
 * @param {string} threadTs     – Slack thread timestamp (conversation key)
 * @param {string} text         – user text, e.g. "Jane: is checkout down?"
 * @param {object} opts
 * @param {string} opts.agentId
 * @param {string} opts.apiKey
 * @param {string} opts.silenceToken
 * @returns {Promise<string>}   – Linda's reply, or silenceToken
 */
export async function send(threadTs, text, { agentId, apiKey, silenceToken }) {
  let conv = conversations.get(threadTs);

  // (Re)connect if needed.
  if (!conv || conv.ws.readyState !== WebSocket.OPEN) {
    conversations.delete(threadTs);
    const ws = await connect(agentId, apiKey);
    conv = { ws };
    conversations.set(threadTs, conv);

    // Auto-clean when the socket closes.
    ws.on('close', () => {
      if (conversations.get(threadTs)?.ws === ws) {
        conversations.delete(threadTs);
      }
    });
  }

  // Send the user message and wait for Linda's full response.
  return new Promise((resolve, reject) => {
    let buffer = '';
    let done = false;

    function cleanup() {
      conv.ws.removeListener('message', onMessage);
      conv.ws.removeListener('close', onClose);
      conv.ws.removeListener('error', onError);
    }

    function finish() {
      if (done) return;
      done = true;
      cleanup();
      const reply = buffer.trim();
      resolve(reply || silenceToken);
    }

    function onMessage(raw) {
      try {
        const msg = JSON.parse(raw);

        // Accumulate text chunks from the agent.
        if (msg.type === 'agent_response') {
          buffer += msg.agent_response_event?.agent_response ?? '';
        }

        // Agent finished its turn.
        if (msg.type === 'agent_response_end' || msg.type === 'turn_end') {
          finish();
        }

        // Keep-alive.
        if (msg.type === 'ping' && msg.ping_event) {
          conv.ws.send(
            JSON.stringify({ type: 'pong', event_id: msg.ping_event.event_id }),
          );
        }
      } catch { /* ignore */ }
    }

    function onClose() { finish(); }
    function onError(err) { if (!done) { done = true; cleanup(); reject(err); } }

    conv.ws.on('message', onMessage);
    conv.ws.once('close', onClose);
    conv.ws.once('error', onError);

    // Send the user's text.
    conv.ws.send(JSON.stringify({ type: 'user_message', text }));

    // Safety net: don't hang forever.
    setTimeout(() => finish(), RESPONSE_TIMEOUT_MS);
  });
}

/** Tear down all open conversations (for graceful shutdown). */
export function closeAll() {
  for (const [, conv] of conversations) {
    try { conv.ws.close(); } catch { /* best effort */ }
  }
  conversations.clear();
}
