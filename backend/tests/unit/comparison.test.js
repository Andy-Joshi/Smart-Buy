import { describe, it, expect } from 'vitest';
import { comparePrices } from '../../src/services/comparison/comparisonEngine.js';
import { MATCH_STATUS } from '../../src/services/matching/matcher.js';
import { VERIFICATION_STATUS } from '../../src/services/extraction/baseExtractor.js';

describe('Price Comparison Engine', () => {
  const target = {
    cleanTitle: 'Sony WH-CH720N Wireless Headphones',
    brand: 'Sony',
    model: 'WH-CH720N',
  };

  it('determines lowest verified price and calculates savings accurately', () => {
    const listings = [
      {
        retailer: 'Croma',
        price: 6990,
        shippingCharge: 0,
        url: 'https://croma.com/p/1',
        verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
        matchEvaluation: { status: MATCH_STATUS.EXACT_MATCH },
      },
      {
        retailer: 'Flipkart',
        price: 7490,
        shippingCharge: 40,
        url: 'https://flipkart.com/p/2',
        verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
        matchEvaluation: { status: MATCH_STATUS.EXACT_MATCH },
      },
      {
        retailer: 'Reliance Digital',
        price: 8990,
        shippingCharge: null,
        url: 'https://reliancedigital.in/p/3',
        verificationStatus: VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
        matchEvaluation: { status: MATCH_STATUS.EXACT_MATCH },
      },
    ];

    const comparison = comparePrices(target, listings);
    expect(comparison.hasComparableOffers).toBe(true);
    expect(comparison.lowestVerifiedPrice).toBe(6990);
    expect(comparison.lowestOverallPrice).toBe(6990);
    expect(comparison.highestComparablePrice).toBe(8990);
    expect(comparison.potentialSavings).toBe(2000);
    expect(comparison.bestOffer.retailer).toBe('Croma');
    expect(comparison.lowestOffer.retailer).toBe('Croma');
    expect(comparison.highestOffer.retailer).toBe('Reliance Digital');
    expect(comparison.comparedOffers).toHaveLength(3);
  });

  it('excludes rejected listings from price comparison calculation', () => {
    const listings = [
      {
        retailer: 'Croma',
        price: 6990,
        url: 'https://croma.com/p/1',
        verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
        matchEvaluation: { status: MATCH_STATUS.EXACT_MATCH },
      },
      {
        retailer: 'Croma Cushion',
        price: 499, // cheap accessory
        url: 'https://croma.com/p/acc',
        verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
        matchEvaluation: { status: MATCH_STATUS.REJECTED },
      },
    ];

    const comparison = comparePrices(target, listings);
    expect(comparison.totalComparable).toBe(1);
    expect(comparison.lowestVerifiedPrice).toBe(6990); // Should NOT be 499!
  });

  it('handles empty comparable results gracefully', () => {
    const comparison = comparePrices(target, []);
    expect(comparison.hasComparableOffers).toBe(false);
    expect(comparison.lowestVerifiedPrice).toBeNull();
    expect(comparison.potentialSavings).toBeNull();
  });
});
