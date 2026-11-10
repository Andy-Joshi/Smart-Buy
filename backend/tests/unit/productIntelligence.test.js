import { describe, it, expect } from 'vitest';
import { generateProductIntelligence, CATEGORY_LAYOUTS } from '../../src/services/productIntelligence.js';
import { parseProductIdentity } from '../../src/services/matching/normalizer.js';
import { createProductListing, VERIFICATION_STATUS } from '../../src/services/extraction/baseExtractor.js';

describe('Product Intelligence Engine', () => {
  it('generates structured product overview for audio headphones', () => {
    const rawTitle = 'Sony WH-CH720N Wireless Noise Cancelling Headphones with Mic Black';
    const identity = parseProductIdentity(rawTitle);
    const listing = createProductListing({
      title: rawTitle,
      brand: 'Sony',
      model: 'WH-CH720N',
      price: 6990,
      originalPrice: 14990,
      retailer: 'Croma',
      url: 'https://www.croma.com/p/270320',
      image: 'https://media.croma.com/image/upload/sony-wh-ch720n.jpg',
      verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
      source: 'croma-page',
    });

    const intel = generateProductIntelligence(listing, identity);

    expect(intel).toBeDefined();
    // Identity
    expect(intel.identity.productName).toBe(rawTitle);
    expect(intel.identity.brand).toBe('Sony');
    expect(intel.identity.model).toBe('WH-CH720N');
    expect(intel.identity.imageUrl).toBe('https://media.croma.com/image/upload/sony-wh-ch720n.jpg');
    expect(intel.identity.originalUrl).toBe('https://www.croma.com/p/270320');
    expect(intel.identity.retailer).toBe('Croma');

    // Layout
    expect(intel.specifications.layout).toBe(CATEGORY_LAYOUTS.AUDIO);

    // Description is factual and mentions ANC & mic
    expect(intel.description.text).toContain('Sony');
    expect(intel.description.text).toContain('WH-CH720N');
    expect(intel.description.text).toContain('Noise Cancellation');
    expect(intel.description.isAiGenerated).toBe(false);

    // Specifications contain verified fields
    const specLabels = intel.specifications.items.map((s) => s.label);
    expect(specLabels).toContain('Brand');
    expect(specLabels).toContain('Noise Cancellation');
    expect(specLabels).toContain('Connectivity');

    // Highlights
    expect(intel.highlights.length).toBeGreaterThan(0);
    expect(intel.highlights.some((h) => h.text.includes('Noise Cancellation'))).toBe(true);

    // Confidence
    expect(intel.confidence.tier).toBe('VERIFIED_PAGE');
    expect(intel.confidence.auditStatement).toContain('Zero fabricated specifications');
  });

  it('generates computing-specific overview for laptops without inventing battery or performance', () => {
    const rawTitle = 'Apple MacBook Air M4 16GB RAM 256GB SSD 13.6-inch Space Gray';
    const identity = parseProductIdentity(rawTitle);
    const listing = createProductListing({
      title: rawTitle,
      brand: 'Apple',
      model: 'MacBook Air',
      retailer: 'Flipkart',
      url: 'https://www.flipkart.com/p/macbook-air-m4',
      verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
      source: 'flipkart-page',
    });

    const intel = generateProductIntelligence(listing, identity);

    expect(intel.specifications.layout).toBe(CATEGORY_LAYOUTS.ELECTRONICS);
    expect(intel.description.text).toContain('MacBook Air');
    expect(intel.description.text).toContain('M4');
    expect(intel.description.text).toContain('16GB');

    // Check specifications
    const specMap = Object.fromEntries(intel.specifications.items.map((s) => [s.label, s.value]));
    expect(specMap['Processor / Chipset']).toBe('M4');
    expect(specMap['Memory (RAM)']).toBe('16GB');
    expect(specMap['Internal Storage']).toBe('256GB');

    // Must NOT invent battery life when absent
    expect(specMap['Battery']).toBeUndefined();
    expect(specMap['Battery Life']).toBeUndefined();
  });

  it('generates consumable-specific overview for food and cooking oils', () => {
    const rawTitle = 'Freedom Refined Sunflower Oil 1L Pouch';
    const identity = parseProductIdentity(rawTitle);
    const listing = createProductListing({
      title: rawTitle,
      brand: 'Freedom',
      retailer: 'Flipkart',
      url: 'https://www.flipkart.com/p/freedom-oil-1l',
      verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
      source: 'flipkart-page',
    });

    const intel = generateProductIntelligence(listing, identity);

    expect(intel.specifications.layout).toBe(CATEGORY_LAYOUTS.CONSUMABLES);
    expect(intel.description.text).toContain('Freedom');
    expect(intel.description.text).toContain('1L');
    expect(intel.description.text).toContain('culinary');

    const specMap = Object.fromEntries(intel.specifications.items.map((s) => [s.label, s.value]));
    expect(specMap['Net Quantity / Volume']).toBe('1L');
  });

  it('flags unverified snippet confidence when source is not a verified page', () => {
    const rawTitle = 'Generic Gadget 1000';
    const identity = parseProductIdentity(rawTitle);
    const listing = createProductListing({
      title: rawTitle,
      verificationStatus: VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
      source: 'search-snippet',
    });

    const intel = generateProductIntelligence(listing, identity);
    expect(intel.confidence.tier).toBe('UNVERIFIED_SNIPPET');
    expect(intel.confidence.label).toContain('Unverified');
  });

  it('handles null listing gracefully', () => {
    expect(generateProductIntelligence(null, null)).toBeNull();
  });
});
