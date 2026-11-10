import * as cheerio from 'cheerio';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from './baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';

/**
 * Adapter for Reliance Digital (reliancedigital.in) product pages.
 */
export async function extractFromRelianceDigitalHtml(html, url) {
  if (!html || typeof html !== 'string') {
    throw new Error('Empty HTML content received from Reliance Digital');
  }

  const $ = cheerio.load(html);

  // Check if it's merely the default SPA shell
  const titleTag = $('title').text().trim();
  if (titleTag === 'Online Electronic Shopping Store in India - Reliance Digital') {
    return {
      success: false,
      error:
        'Reliance Digital serves an SPA shell requiring client-side JavaScript execution. Static HTML extraction cannot access product attributes without browser rendering.',
    };
  }

  let title = $('h1.pdp__title, h1').first().text().trim();
  let price = null;
  let originalPrice = null;

  const priceText = $('.pdp__priceSection__price, span.text__price').first().text();
  if (priceText) {
    price = parsePrice(priceText);
  }

  const mrpText = $('.pdp__priceSection__mrpPrice, span.text__mrp').first().text();
  if (mrpText) {
    originalPrice = parsePrice(mrpText);
  }

  if (!title) {
    return {
      success: false,
      error: 'Product details not present in Reliance Digital static response',
    };
  }

  const identity = parseProductIdentity(title);

  const listing = createProductListing({
    title,
    brand: identity.brand,
    model: identity.model,
    variant: identity.storage || identity.ram || null,
    specifications: null,
    price,
    originalPrice,
    currency: 'INR',
    retailer: 'Reliance Digital',
    seller: 'Reliance Retail Ltd.',
    url,
    availability: 'Available',
    shippingCharge: 0,
    verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
    source: 'reliance-digital-page',
    extractionNotes: 'Extracted from Reliance Digital product page',
  });

  return {
    success: true,
    listing,
    identity,
  };
}
