
import { describe, it, expect } from 'vitest';
import { parseProductIdentity } from '../../src/services/matching/normalizer.js';
import {
  evaluateProductMatch,
  deduplicateListings,
  MATCH_STATUS,
} from '../../src/services/matching/matcher.js';

describe('Product Matching Engine', () => {
  it('identifies exact match for identical model and brand', () => {
    const target = parseProductIdentity('Sony WH-CH720N');
    const candidate = 'SONY WH-CH720N Bluetooth Headphone with Mic Black';

    const match = evaluateProductMatch(target, candidate);
    expect(match.status).toBe(MATCH_STATUS.EXACT_MATCH);
    expect(match.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('rejects model number mismatch (WH-CH720N vs WH-CH520)', () => {
    const target = parseProductIdentity('Sony WH-CH720N');
    const candidate = 'Sony WH-CH520 Wireless Bluetooth Headphones';

    const match = evaluateProductMatch(target, candidate);
    expect(match.status).toBe(MATCH_STATUS.REJECTED);
    expect(match.reason).toContain('Model mismatch');
  });

  it('rejects storage variant mismatch (Samsung Galaxy S25 256GB vs 512GB)', () => {
    const target = parseProductIdentity('Samsung Galaxy S25 256GB');
    const candidate = 'Samsung Galaxy S25 512GB Smartphone Silver';

    const match = evaluateProductMatch(target, candidate);
    expect(match.status).toBe(MATCH_STATUS.REJECTED);
    expect(match.reason).toContain('Storage variant mismatch');
  });

  it('rejects iPhone storage variant mismatch (256GB vs 512GB)', () => {
    const target = parseProductIdentity('Apple iPhone 17 Pro 256GB');
    const candidate = 'Apple iPhone 17 Pro 512GB Smartphone';

    const match = evaluateProductMatch(target, candidate);
    expect(match.status).toBe(MATCH_STATUS.REJECTED);
    expect(match.reason).toContain('Storage variant mismatch');
  });

  it('rejects generation mismatch (MacBook Air M4 vs MacBook Air M2)', () => {
    const target = parseProductIdentity('Apple MacBook Air M4');
    const candidate = 'Apple MacBook Air 13-inch M2 Chip 256GB Space Gray';

    const match = evaluateProductMatch(target, candidate);
    expect(match.status).toBe(MATCH_STATUS.REJECTED);
    expect(match.reason).toContain('Generation mismatch');
  });

  it('rejects accessories when searching for a primary device', () => {
    const target = parseProductIdentity('Sony WH-CH720N');
    const candidate = 'Hard Travel Case for Sony WH-CH720N Wireless Headphones';

    const match = evaluateProductMatch(target, candidate);
    expect(match.status).toBe(MATCH_STATUS.REJECTED);
    expect(match.reason).toContain('accessory');
  });

  it('flags uncertain items as possible match rather than exact', () => {
    const target = parseProductIdentity('Logitech MX Master 3S');
    const candidate = 'Logitech Wireless Ergonomic Performance Mouse with Darkfield';

    const match = evaluateProductMatch(target, candidate);
    expect(match.status).not.toBe(MATCH_STATUS.EXACT_MATCH);
  });

  it('deduplicates listings across URLs and keeps highest verification tier', () => {
    const listings = [
      {
        url: 'https://www.croma.com/p/270320?utm_source=test',
        retailer: 'Croma',
        title: 'Sony WH-CH720N Headphone',
        price: 6990,
        verificationStatus: 'UNVERIFIED_SNIPPET',
      },
      {
        url: 'https://www.croma.com/p/270320',
        retailer: 'Croma',
        title: 'Sony WH-CH720N Headphone',
        price: 6990,
        verificationStatus: 'VERIFIED_PAGE',
      },
    ];

    const deduped = deduplicateListings(listings);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].verificationStatus).toBe('VERIFIED_PAGE');
  });

  it('does NOT grant EXACT_MATCH to generic consumable with no brand or model', () => {
    const target = parseProductIdentity('Freedom Refined Sunflower Oil 1L');
    const candidate = 'Freedom Refined Sunflower Oil 1 Litre';

    const match = evaluateProductMatch(target, candidate);
    expect(match.status).not.toBe(MATCH_STATUS.EXACT_MATCH);
    expect(match.confidence).toBeLessThan(0.85);
  });

  it('caps consumable at HIGH_CONFIDENCE when brand matches but no model', () => {
    const target = parseProductIdentity('Freedom Refined Sunflower Oil 1L');
    const candidate = 'Freedom Sunflower Oil Refined 1 Litre';

    const match = evaluateProductMatch(target, candidate);
    expect(match.status).not.toBe(MATCH_STATUS.EXACT_MATCH);
  });

  it('recognises boAt brand match for Airdopes products', () => {
    const target = parseProductIdentity('boAt Airdopes 141');
    const candidate = 'boAt Airdopes 141 TWS Earbuds with 42H Playback';

    const match = evaluateProductMatch(target, candidate);
    expect([MATCH_STATUS.EXACT_MATCH, MATCH_STATUS.HIGH_CONFIDENCE]).toContain(match.status);
  });

  // Lenovo keyboard vs tablet regression tests

  it('rejects a Lenovo tablet when searching for a Lenovo keyboard', () => {
    const target = parseProductIdentity('Lenovo Smartchoice Keyboard');
    const candidate = 'Lenovo Idea Tab 256GB Tablet';

    const match = evaluateProductMatch(target, candidate);

    expect(match.status).toBe(MATCH_STATUS.REJECTED);
    expect(match.reason).toContain('Category mismatch');
  });

  it('does not reject a genuine Lenovo keyboard as a category mismatch', () => {
    const target = parseProductIdentity('Lenovo Smartchoice Keyboard');
    const candidate = 'Lenovo Wireless Keyboard with USB Receiver';

    const match = evaluateProductMatch(target, candidate);

    expect(match.status).not.toBe(MATCH_STATUS.REJECTED);
  });
});
