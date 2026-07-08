/**
 * Persistent per-channel ElevenLabs conversations (text mode).
 *
 * One WebSocket is kept alive per Slack channel so Linda retains context
 * across messages. ElevenLabs closes idle connections after a few minutes;
 * when that happens we reconnect and re-inject recent chat history via a
 * `contextual_update` event so Linda doesn't lose the thread.
 *
 * Sends are queued per channel: one turn must finish before the next
 * starts, so concurrent Slack messages can't cross-wire replies.
 */
import WebSocket from 'ws';

const API_BASE = 'https://api.elevenlabs.io/v1';
const CONNECT_TIMEOUT_MS = 15_000;
const RESPONSE_TIMEOUT_MS = 30_000;
const CONTEXT_MAX_CHARS = 3_000;

/** conversationKey → { ws, queue } */
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
  return new Promise((resolve, reject) => {
    getSignedUrl(agentId, apiKey).then((url) => {
      const ws = new WebSocket(url);
      let settled = false;

      // Persistent listener: without one, a socket 'error' emitted while the
      // conversation is idle would crash the process (unhandled 'error').
      ws.on('error', (err) => {
        console.error('ElevenLabs socket error:', err?.message ?? err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      ws.once('close', () => {
        if (!settled) {
          settled = true;
          reject(new Error('ElevenLabs socket closed before initiation'));
        }
      });

      ws.once('open', () => {
        // Request text-only mode (no TTS audio) and suppress the first
        // message for Slack.
        ws.send(
          JSON.stringify({
            type: 'conversation_initiation_client_data',
            conversation_config_override: {
              agent: {
                tts: { enabled: false },
                first_message: ' ',
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

      setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error('ElevenLabs conversation connection timed out'));
        }
      }, CONNECT_TIMEOUT_MS);
    }, reject);
  });
}

/* ------------------------------------------------------------------ */
/*  Chat-history context block                                        */
/* ------------------------------------------------------------------ */

/**
 * Build the context block injected after a reconnect.
 *
 * Walks the history newest-first so the most recent lines always fit the
 * character budget, then restores chronological order.
 *
 * @param {string[]} history – lines like "JD: I need a quote"
 * @returns {string|null}
 */
export function buildContextBlock(history) {
  if (!Array.isArray(history) || history.length === 0) return null;

  const lines = [];
  let chars = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const line = String(history[i]);
    if (chars + line.length > CONTEXT_MAX_CHARS) break;
    lines.unshift(line);
    chars += line.length + 1;
  }
  if (lines.length === 0) return null;

  return (
    'Recent conversation history (the previous session timed out). ' +
    'Use this only as background context — do not mention, repeat, or ' +
    'summarize it:\n' +
    lines.join('\n')
  );
}

/* ------------------------------------------------------------------ */
/*  Send a message and collect Linda's reply                          */
/* ------------------------------------------------------------------ */

/**
 * Send user text to the Linda conversation for the given key.
 * Creates (or reconnects) the conversation as needed. Turns for the same
 * key are serialized so replies can't get crossed.
 *
 * @param {string} conversationKey – Slack channel id (conversation key)
 * @param {string} text            – user text, e.g. "Jane: is checkout down?"
 * @param {object} opts
 * @param {string} opts.agentId
 * @param {string} opts.apiKey
 * @param {string} opts.silenceToken
 * @param {string[]} [opts.history] – recent chat lines, injected on reconnect
 * @returns {Promise<string>}      – Linda's reply, or silenceToken
 */
export function send(conversationKey, text, opts) {
  let conv = conversations.get(conversationKey);
  if (!conv) {
    conv = { ws: null, queue: Promise.resolve() };
    conversations.set(conversationKey, conv);
  }

  const result = conv.queue.then(() =>
    sendTurn(conversationKey, conv, text, opts),
  );
  // Keep the queue alive even when a turn fails.
  conv.queue = result.catch(() => {});
  return result;
}

async function sendTurn(
  conversationKey,
  conv,
  text,
  { agentId, apiKey, silenceToken, history = [] },
) {
  // (Re)connect if needed.
  if (!conv.ws || conv.ws.readyState !== WebSocket.OPEN) {
    const ws = await connect(agentId, apiKey);
    conv.ws = ws;

    // Auto-clean when the socket closes.
    ws.once('close', () => {
      if (conversations.get(conversationKey)?.ws === ws) {
        conv.ws = null;
      }
    });

    // Fresh session: re-inject recent history so Linda keeps context.
    const context = buildContextBlock(history);
    if (context) {
      ws.send(JSON.stringify({ type: 'contextual_update', text: context }));
    }
  }

  const ws = conv.ws;

  // Send the user message and wait for Linda's full response.
  return new Promise((resolve, reject) => {
    let buffer = '';
    let done = false;
    let timer;

    function cleanup() {
      clearTimeout(timer);
      ws.removeListener('message', onMessage);
      ws.removeListener('close', onClose);
      ws.removeListener('error', onError);
    }

    function succeed() {
      if (done) return;
      done = true;
      cleanup();
      resolve(buffer.trim() || silenceToken);
    }

    function fail(err) {
      if (done) return;
      done = true;
      cleanup();
      reject(err);
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
          succeed();
        }

        // Keep-alive.
        if (msg.type === 'ping' && msg.ping_event) {
          ws.send(
            JSON.stringify({ type: 'pong', event_id: msg.ping_event.event_id }),
          );
        }
      } catch { /* ignore */ }
    }

    function onClose() {
      // Partial answer is better than a silent drop; no answer is an error.
      if (buffer.trim()) succeed();
      else fail(new Error('ElevenLabs connection closed before a reply'));
    }

    function onError(err) {
      fail(err);
    }

    ws.on('message', onMessage);
    ws.once('close', onClose);
    ws.once('error', onError);

    // Safety net: don't hang forever — but never swallow a reply silently.
    timer = setTimeout(() => {
      if (buffer.trim()) succeed();
      else fail(
        new Error(`ElevenLabs response timed out after ${RESPONSE_TIMEOUT_MS} ms`),
      );
    }, RESPONSE_TIMEOUT_MS);

    // Send the user's text.
    ws.send(JSON.stringify({ type: 'user_message', text }));
  });
}

/** Tear down all open conversations (used for graceful shutdown). */
export function closeAll() {
  for (const [, conv] of conversations) {
    try { conv.ws?.close(); } catch { /* best effort */ }
  }
  conversations.clear();
}
