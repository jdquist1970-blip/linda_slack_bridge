import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAddress,
  summarizeQuote,
  emailQuote,
  _clearQuoteCache,
} from '../src/quote.js';

const GEO_FIXTURE = {
  formatted_address: '5206 Karlia Dr, Ave Maria, FL 34142, USA',
  address_components: [
    { long_name: '5206', short_name: '5206', types: ['street_number'] },
    { long_name: 'Karlia Drive', short_name: 'Karlia Dr', types: ['route'] },
    { long_name: 'Ave Maria', short_name: 'Ave Maria', types: ['locality', 'political'] },
    { long_name: 'Florida', short_name: 'FL', types: ['administrative_area_level_1', 'political'] },
    { long_name: '34142', short_name: '34142', types: ['postal_code'] },
  ],
  geometry: { location: { lat: 26.327714, lng: -81.426013 } },
};

const QUOTE_FIXTURE = {
  quoteId: 'abc-123',
  signedQuoteId: 'abc-123.signed',
  monthlyPremium: 218,
  annualPremium: 3669,
  coverages: [
    { label: 'Annual premium', value: '$3,118' },
    { label: 'Dwelling (Cov A)', value: '$691,175' },
  ],
  expiresAt: '2026-08-07T18:59:49.808Z',
  bindUrl: 'https://www.swyfft.com/homeowner/abc-123/bind',
  customizeUrl: 'https://www.swyfft.com/homeowner/abc-123/customize',
  city: 'Ave Maria',
  state: 'FL',
  carriers: [{ carrierCode: 'Vave', carrierName: "Lloyd's of London - VAVE" }],
};

describe('extractAddress', () => {
  it('maps Google geocoder components to the quote API shape', () => {
    const a = extractAddress(GEO_FIXTURE);
    assert.equal(a.street_number, '5206');
    assert.equal(a.route, 'Karlia Drive');
    assert.equal(a.locality, 'Ave Maria');
    assert.equal(a.administrative_area_level_1, 'FL'); // short name
    assert.equal(a.postal_code, '34142');
    assert.equal(a.geometry.location.lat, 26.327714);
    assert.equal(a.formatted_address, GEO_FIXTURE.formatted_address);
  });

  it('handles missing components without throwing', () => {
    const a = extractAddress({ formatted_address: 'x', address_components: [], geometry: {} });
    assert.equal(a.street_number, '');
    assert.equal(a.locality, '');
  });
});

describe('summarizeQuote', () => {
  it('produces a compact agent-friendly result', () => {
    const s = summarizeQuote(QUOTE_FIXTURE, '5206 Karlia Dr, Ave Maria, FL 34142, USA');
    assert.equal(s.success, true);
    assert.equal(s.quoteId, 'abc-123');
    assert.equal(s.annualPremium, 3669);
    assert.equal(s.monthlyPremium, 218);
    assert.equal(s.carrier, "Lloyd's of London - VAVE");
    assert.equal(s.coverages.length, 2);
    assert.ok(s.bindUrl.includes('swyfft.com'));
  });

  it('falls back to Swyfft when carriers are missing', () => {
    const s = summarizeQuote({ ...QUOTE_FIXTURE, carriers: undefined }, 'addr');
    assert.equal(s.carrier, 'Swyfft');
  });
});

describe('emailQuote', () => {
  beforeEach(() => _clearQuoteCache());

  it('rejects when the quote is not in the cache', async () => {
    await assert.rejects(
      () => emailQuote('nope', 'a@b.com', { emailUrl: 'http://localhost:1' }),
      /no longer available/,
    );
  });
});
