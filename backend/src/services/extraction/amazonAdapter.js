import * as cheerio from 'cheerio';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from './baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';

/**
 * Adapter for Amazon India (amazon.in) product pages.
 */
export async function extractFromAmazonHtml(html, url) {
  if (!html || typeof html !== 'string') {
    throw new Error('Empty HTML content received from Amazon');
  }

  // Detect anti-bot / CAPTCHA blocks
  if (
    html.includes('api-services-support@amazon.com') ||
    html.includes('validateCaptcha') ||
    html.includes('Robot Check') ||
    html.includes('To discuss automated access to Amazon data')
  ) {
    return {
      success: false,
      blocked: true,
      error:
        'Amazon anti-bot verification (Robot Check / CAPTCHA) blocked direct automated page access. Real data extraction could not proceed without bypassing anti-bot controls.',
    };
  }

  const $ = cheerio.load(html);

  const title = $('#productTitle').first().text().trim();
  if (!title) {
    return {
      success: false,
      error: 'Product title not found on Amazon page',
    };
  }

  // Price extraction
  let price = null;
  const priceOffscreen = $('.a-price .a-offscreen').first().text();
  if (priceOffscreen) {
    price = parsePrice(priceOffscreen);
  } else {
    const whole = $('.a-price-whole').first().text();
    const fraction = $('.a-price-fraction').first().text();
    if (whole) {
      price = parsePrice(`${whole}.${fraction || '00'}`);
    }
  }

  // MRP
  let originalPrice = null;
  const mrpElem = $('.a-text-price .a-offscreen').first().text();
  if (mrpElem) {
    originalPrice = parsePrice(mrpElem);
  }

  // Availability
  let availability = 'In Stock';
  const availText = $('#availability').text().trim();
  if (availText) {
    if (availText.toLowerCase().includes('currently unavailable') || availText.toLowerCase().includes('out of stock')) {
      availability = 'Currently Unavailable';
    }
  }

  // Seller
  let seller = null;
  const sellerElem = $('#sellerProfileTriggerId, #merchant-info').first().text().trim();
  if (sellerElem) {
    seller = sellerElem.replace(/\s+/g, ' ');
  }

  // Image & Description
  const image =
    $('#landingImage').attr('data-old-hires') ||
    $('#landingImage').attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    null;
  const rawDescription =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    null;

  const identity = parseProductIdentity(title);

  const listing = createProductListing({
    title,
    brand: identity.brand,
    model: identity.model,
    variant: identity.storage || identity.ram || null,
    specifications: null,
    image,
    rawDescription,
    price,
    originalPrice,
    currency: 'INR',
    retailer: 'Amazon India',
    seller: seller || 'Amazon Verified Seller',
    url,
    availability,
    shippingCharge: 0,
    verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
    source: 'amazon-page',
    extractionNotes: 'Extracted from Amazon India product page',
  });

  return {
    success: true,
    listing,
    identity,
  };
}
