import * as cheerio from 'cheerio';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from './baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';

/**
 * Adapter for Flipkart (flipkart.com) product pages.
 */
export async function extractFromFlipkartHtml(html, url) {
  if (!html || typeof html !== 'string') {
    throw new Error('Empty HTML content received from Flipkart');
  }

  const $ = cheerio.load(html);

  let title = null;
  let price = null;
  let originalPrice = null;
  let brand = null;
  let model = null;
  let availability = 'In Stock';
  let seller = null;

  // Title extraction
  const ogTitle = $('meta[property="og:title"]').attr('content');
  if (ogTitle) {
    title = ogTitle;
  } else {
    title = $('h1.VU-ZEz, h1.x-ms8j, span.B_NuCI, h1').first().text().trim();
  }

  // Price extraction
  let priceText = $('div.Nx9bqj, div._30jeq3, div._16Jk6d').first().text();

  if (!priceText) {
    // Check modern Flipkart element with custom font
    const fontElem = $('[font*="fk-font"]').filter((_, el) => {
      const text = $(el).text().trim();
      return /^₹\s*[0-9,]+(?:\.\d{2})?$/.test(text);
    }).first().text();
    if (fontElem) priceText = fontElem;
  }

  if (priceText) {
    price = parsePrice(priceText);
  }

  // MRP extraction
  const mrpElem = $('div.yRaY8j, div._3I9_wc, div._2p6XSc').first().text();
  if (mrpElem) {
    originalPrice = parsePrice(mrpElem);
  }

  // Seller
  const sellerElem = $('#sellerName, div._1RLviY, div.D542hB').first().text().trim();
  if (sellerElem) {
    seller = sellerElem.replace(/\s+/g, ' ');
  }

  // Out of stock indicators
  const oosElem = $('div._16FRp0, div.C0V-kI').text().toLowerCase();
  if (oosElem.includes('out of stock') || oosElem.includes('temporarily unavailable')) {
    availability = 'Out of Stock';
  }

  if (!title) {
    return {
      success: false,
      error: 'Failed to extract product title from Flipkart page',
    };
  }

  // Image and Description extraction
  const image = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || null;
  const rawDescription = $('meta[property="og:description"]').attr('content') || $('meta[name="Description"]').attr('content') || null;

  const identity = parseProductIdentity(title);
  if (!brand && identity.brand) brand = identity.brand;
  if (!model && identity.model) model = identity.model;

  const listing = createProductListing({
    title,
    brand,
    model,
    variant: identity.storage || identity.ram || null,
    specifications: null,
    image,
    rawDescription,
    price,
    originalPrice,
    currency: 'INR',
    retailer: 'Flipkart',
    seller: seller || 'Flipkart Verified Seller',
    url,
    availability,
    shippingCharge: 0,
    verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
    source: 'flipkart-page',
    extractionNotes: 'Extracted from Flipkart product page',
  });

  return {
    success: true,
    listing,
    identity,
  };
}
