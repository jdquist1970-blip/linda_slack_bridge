/**
 * Swyfft quote + email tools for Slack Linda.
 *
 * Wraps the askauntlinda.com quote API so the ElevenLabs agent can run a
 * homeowners quote from a plain-text address. The site's API expects a
 * structured (Google Places style) address, so we geocode first via the
 * Google Geocoding API.
 */

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** quoteId → { raw, address, firstName, lastName, storedAt }  */
const quoteCache = new Map();
const QUOTE_CACHE_TTL_MS = 24 * 60 * 60_000;

function pruneCache() {
  const cutoff = Date.now() - QUOTE_CACHE_TTL_MS;
  for (const [id, entry] of quoteCache) {
    if (entry.storedAt < cutoff) quoteCache.delete(id);
  }
}

/**
 * Map a Google Geocoding result to the address shape the quote API expects.
 * Pure function (exported for tests).
 */
export function extractAddress(geo) {
  const comp = (type, short = false) => {
    const c = (geo.address_components ?? []).find((x) => x.types.includes(type));
    return c ? (short ? c.short_name : c.long_name) : '';
  };
  return {
    formatted_address: geo.formatted_address,
    street_number: comp('street_number'),
    route: comp('route'),
    locality: comp('locality') || comp('sublocality') || comp('postal_town'),
    administrative_area_level_1: comp('administrative_area_level_1', true),
    postal_code: comp('postal_code'),
    geometry: { location: geo.geometry?.location },
  };
}

async function geocode(address, apiKey) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding request failed (${res.status})`);
  const data = await res.json();
  const hit = data.results?.[0];
  if (data.status !== 'OK' || !hit) {
    throw new Error(`Could not verify that address (geocoder said: ${data.status})`);
  }
  return extractAddress(hit);
}

/**
 * Run a Swyfft quote for a plain-text address.
 * Caches the raw result by quoteId so emailQuote() can replay it.
 */
export async function runQuote(
  address,
  { googleApiKey, quoteUrl, firstName, lastName },
) {
  const structured = await geocode(address, googleApiKey);
  const res = await fetch(quoteUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName,
      lastName,
      email: '',
      address: structured,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Quote API ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const raw = await res.json();
  pruneCache();
  if (raw.quoteId) {
    quoteCache.set(raw.quoteId, {
      raw,
      address: structured.formatted_address,
      firstName,
      lastName,
      storedAt: Date.now(),
    });
  }
  return raw;
}

/**
 * Compact, agent-friendly view of a raw quote response.
 * Pure function (exported for tests).
 */
export function summarizeQuote(raw, address) {
  return {
    success: true,
    quoteId: raw.quoteId,
    address,
    city: raw.city,
    state: raw.state,
    carrier: raw.carriers?.[0]?.carrierName ?? 'Swyfft',
    annualPremium: raw.annualPremium,
    monthlyPremium: raw.monthlyPremium,
    coverages: raw.coverages ?? [],
    expiresAt: raw.expiresAt,
    customizeUrl: raw.customizeUrl,
    bindUrl: raw.bindUrl,
  };
}

/**
 * Email the full quote details (same email the website sends) to a recipient.
 * Requires the quote to be in the cache (i.e. quoted since last restart).
 */
export async function emailQuote(quoteId, recipientEmail, { emailUrl }) {
  const entry = quoteCache.get(quoteId);
  if (!entry) {
    throw new Error(
      'That quote is no longer available — please run a fresh quote first.',
    );
  }
  const q = entry.raw;
  const res = await fetch(emailUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: recipientEmail,
      formEmail: '',
      firstName: entry.firstName,
      lastName: entry.lastName,
      quoteId: q.quoteId,
      signedQuoteId: q.signedQuoteId,
      address: entry.address,
      monthlyPremium: q.monthlyPremium,
      annualPremium: q.annualPremium,
      coverages: q.coverages,
      expiresAt: q.expiresAt,
      selectedCarriers: q.carriers ?? [],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Email API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => ({ ok: true }));
}

/** Test hook: clear the cache. */
export function _clearQuoteCache() {
  quoteCache.clear();
}

/** Test hook: seed the cache. */
export function _seedQuoteCache(quoteId, entry) {
  quoteCache.set(quoteId, { storedAt: Date.now(), ...entry });
}
