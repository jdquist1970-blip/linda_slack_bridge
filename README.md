# Linda ↔ Slack bridge

Makes your ElevenLabs agent **Linda** an active participant in a Slack channel (e.g. **DTC**):
she sees every message, decides when to chime in, and replies in-thread — no `@`-mention required.

This is a small always-on web service. It replaces the ElevenLabs native Slack
integration (which only responds to `@`-mentions in channels). You do **not** need the
ElevenLabs Slack connection for this; the bridge talks to Linda directly via the Agents API.

```
Slack (DTC)  ──event──▶  bridge (/slack/events)  ──WebSocket──▶  ElevenLabs (Linda)
     ▲                                                                   │
     └───────────────  chat.postMessage (as Aunt Linda)  ◀──────────────┘
```

## How it behaves

- Every human message in the configured channel(s) is forwarded to Linda, prefixed with the
  speaker's name so she can follow a group conversation (`"Jane: is checkout down?"`).
- One ElevenLabs conversation is kept alive per Slack thread, so Linda remembers context.
- If Linda decides a message needs no reply, she outputs the **silence token** (`[[SKIP]]` by
  default) and the bridge posts nothing. This is what keeps her from replying to every line.
- She adds an `:eyes:` reaction while thinking and removes it when she replies.
- The bridge ignores its own messages, other bots, edits, and deletions (no loops).

## What you need to do (the parts I can't: secrets + hosting)

### 1. Collect five values

| Env var | Where to get it |
| --- | --- |
| `SLACK_SIGNING_SECRET` | Aunt Linda app → **Basic Information** → App Credentials → Signing Secret |
| `SLACK_BOT_TOKEN` | Aunt Linda app → **OAuth & Permissions** → **Bot** User OAuth Token (`xoxb-…`) |
| `ELEVENLABS_API_KEY` | ElevenLabs → profile menu → **API keys** |
| `ELEVENLABS_AGENT_ID` | ElevenLabs → Agents → **Linda** → agent id (in the URL / settings) |
| `DTC_CHANNEL_IDS` | In Slack, open the DTC channel → channel name → **Copy link**; the id is the `C…` part |

Bot token scopes needed (you already have most): `channels:history` (public) or `groups:history`
(private), `chat:write`, `reactions:write`, `app_mentions:read`, and `users:read` (optional, for
nicer speaker names). Reinstall the app if you add any.

### 2. Turn on text mode for Linda (one-time, in ElevenLabs)

Open **Linda → Advanced → enable "Text only"**, OR **Linda → Security → allow conversation
overrides** (the bridge requests text-only at runtime). Without this the agent may try to speak
audio and won't return text. Save.

Recommended: add one line to Linda's system prompt so she participates naturally:
> "You are in a group Slack channel. Reply only when you can genuinely help or move the
> conversation forward. If a message doesn't need your input, respond with exactly `[[SKIP]]`."

### 3. Deploy the service

Easiest is **Render** (free/starter tier works):

1. Push this folder to a GitHub repo.
2. Render → **New → Blueprint** → pick the repo (it reads `render.yaml`).
3. When prompted, paste the five values from step 1 into the secret env vars.
4. Deploy. Copy the service URL, e.g. `https://linda-slack-bridge.onrender.com`.

(Any Node host works — there's also a `Dockerfile`. Local run: `cp .env.example .env`, fill it,
`npm install`, then `node --env-file=.env src/server.js`.)

### 4. Point Slack at the bridge

In the Aunt Linda app → **Event Subscriptions**:

1. Enable events.
2. **Request URL** = `https://YOUR-DEPLOY-URL/slack/events` → wait for **Verified**.
3. Under **Subscribe to bot events**, add `message.channels` (and `message.groups` if DTC is
   private). Save.
4. Reinstall the app if prompted. Make sure Aunt Linda is in the DTC channel (she is).

That's it. Post a message in DTC and Linda will join in.

> Note: Slack allows only one Event Subscriptions Request URL per app. Pointing it at this bridge
> means the ElevenLabs native Slack connection won't receive events — that's expected; the bridge
> handles everything.

## Test

```
npm install
npm test
```

Unit + endpoint tests cover Slack signature verification (valid / tampered / stale), the event
filter, and the `/slack/events` challenge + auth handshake.

## Files

- `src/server.js` — HTTP endpoint, signature check, dedupe, event routing.
- `src/elevenlabs.js` — persistent per-thread ElevenLabs conversations (text mode).
- `src/slack.js` — signature verify, post message, reactions, auth.test, user names.
- `src/filter.js` — which events to act on (pure, tested).
- `render.yaml` / `Dockerfile` — deployment.
- `.env.example` — the variables to set.
