# Slack Linda — Swyfft Quote Tools Setup

The bridge now exposes two endpoints that ElevenLabs webhook tools can call.
Linda (the **Slack** agent) can run a real Swyfft homeowners quote from a
plain address and email the full quote details — the same email the website
sends.

## 1. Render environment variables

In the Render dashboard for `linda-slack-bridge`, add:

| Variable | Value |
|---|---|
| `GOOGLE_MAPS_API_KEY` | A Google Cloud **server** API key with the **Geocoding API** enabled. Don't reuse the website's browser key — create a separate key and restrict it to the Geocoding API. |
| `QUOTE_TOOL_SECRET` | Any long random string (e.g. run `openssl rand -hex 24`). The same value goes in the ElevenLabs tool headers below. |

Until both are set, the tool endpoints politely refuse — nothing breaks.

## 2. ElevenLabs dashboard — add two webhook tools (Slack agent only)

Agent → **Tools** → Add tool → type **Webhook**.

### Tool 1: `get_homeowners_quote`

- **Description:** `Run a real Swyfft homeowners insurance quote for a US property address. Returns premium, coverages, and a quoteId.`
- **Method:** POST
- **URL:** `https://<your-render-app>.onrender.com/tools/quote`
- **Headers:** `X-Tool-Secret: <QUOTE_TOOL_SECRET value>`
- **Body parameters:**
  - `address` (string, required): `Full property street address including city and state, e.g. "5206 Karlia Dr, Ave Maria, FL 34142"`
  - `firstName` (string, optional): `Customer first name if known`
  - `lastName` (string, optional): `Customer last name if known`
- **Response timeout:** 30 seconds

Success response: `{ success, quoteId, address, carrier, annualPremium, monthlyPremium, coverages[], expiresAt, customizeUrl, bindUrl }`
Failure response: `{ success: false, error: "<plain-English reason>" }`

### Tool 2: `email_home_quote`

- **Description:** `Email the full Swyfft quote details (price, coverages, deductibles) to a recipient. Requires the quoteId from get_homeowners_quote.`
- **Method:** POST
- **URL:** `https://<your-render-app>.onrender.com/tools/email-quote`
- **Headers:** `X-Tool-Secret: <QUOTE_TOOL_SECRET value>`
- **Body parameters:**
  - `quoteId` (string, required): `The quoteId returned by get_homeowners_quote`
  - `email` (string, required): `Recipient email address`

## 3. Add to the Slack agent's system prompt

```
## Homeowners quotes (Swyfft)

You can run real Swyfft homeowners quotes with the get_homeowners_quote tool,
and email full quote details with the email_home_quote tool.

WHEN TO QUOTE
- Use get_homeowners_quote when someone gives you a property address and wants
  a price. You need the full street address with city and state. If part is
  missing, ask for it before calling the tool.
- If the customer's real name was mentioned, pass firstName and lastName so
  the quote is filed under their name.

WHEN A QUOTE COMES BACK (success = true)
- Lead with the number: carrier, annual premium, and monthly payment.
- Then give a one-line summary: dwelling coverage and the deductible.
- Offer both follow-ups: "Want the full coverage breakdown here, or should I
  email you the complete quote?"
- Full breakdown in Slack = list every item in coverages, one per line.
- To email it: confirm the recipient's email address, then call
  email_home_quote with the quoteId and that email. Confirm when it's sent.
- Quotes expire (see expiresAt) — mention the expiration date when relevant.
- Only report numbers the tool returned. Never estimate or invent a price.

WHEN A QUOTE FAILS (success = false)
- Do not guess a price and do not present any number as an estimate.
- Say plainly: "I couldn't pull a quote for that address — Swyfft may not
  write coverage there, or I couldn't verify the address."
- First failure: double-check the address with them (spelling, city, state)
  and try once more if anything changes.
- If it fails again: stop trying and hand off — "Let me have Jason take a
  look at this one personally. He can quote markets I can't reach from here."
- If the tool itself errors or times out, say the quoting system is having a
  moment and offer to try again in a few minutes or loop in Jason.
```

## 4. How it works

```
Slack: "quote 5206 Karlia Dr, Ave Maria FL"
  → Linda calls get_homeowners_quote
  → bridge geocodes the address (Google Geocoding API)
  → bridge POSTs the structured address to askauntlinda.com/api/swyfft-quote
  → Linda summarizes: "$3,669/yr ($218/mo) through Lloyd's of London – VAVE…"
  → "Want the full breakdown here, or should I email it?"
  → Linda calls email_home_quote → askauntlinda.com/api/email-quote
```

## Notes & limits

- **No website changes.** The bridge only *calls* the site's existing public
  endpoints; nothing about consumer quoting on askauntlinda.com changes.
- Slack quotes appear in your leads as **"Slack Internal"** unless Linda
  passes a real customer name (configurable via `QUOTE_LEAD_FIRST_NAME` /
  `QUOTE_LEAD_LAST_NAME`).
- The quote cache for emailing is **in-memory**: a quote can be emailed any
  time within 24 h, unless the Render service restarts/redeploys in between.
  If that happens Linda just needs to run the quote again (5 seconds).
- The full coverage breakdown Linda can post in Slack contains the same data
  as the email: all coverages A–F, deductible, premiums, expiration, and the
  customize/bind links.
