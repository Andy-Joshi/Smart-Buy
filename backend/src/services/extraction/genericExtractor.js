import * as cheerio from 'cheerio';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from './baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';
import { detectRetailerFromHostname } from '../security/safeUrlValidator.js';

/**
 * Generic product page extractor utilizing Schema.org JSON-LD, OpenGraph, and standard e-commerce microdata.
 */
export async function extractFromGenericHtml(html, url) {
  if (!html || typeof html !== 'string') {
    throw new Error('Empty HTML content');
  }

  const $ = cheerio.load(html);

  let title = null;
  let brand = null;
  let model = null;
  let price = null;
  let originalPrice = null;
  let currency = 'INR';
  let availability = null;
  let seller = null;
  let image = null;
  let rawDescription = null;
  let specifications = {};

  // 1. Check Schema.org JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html());
      const items = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type'] === 'IndividualProduct') {
          title = title || item.name;
          if (item.brand) {
            brand = brand || (typeof item.brand === 'object' ? item.brand.name : item.brand);
          }
          if (item.model) {
            model = model || (typeof item.model === 'object' ? item.model.name : item.model);
          }
          if (item.image) {
            image = image || (Array.isArray(item.image) ? item.image[0] : (typeof item.image === 'object' ? item.image.url : item.image));
          }
          if (item.description && typeof item.description === 'string') {
            rawDescription = rawDescription || item.description;
          }
          if (item.offers) {
            const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            if (offer) {
              price = price || parsePrice(offer.price || offer.lowPrice);
              currency = offer.priceCurrency || currency;
              if (offer.availability) {
                availability = offer.availability.includes('InStock') ? 'In Stock' : 'Out of Stock';
              }
              if (offer.seller) {
                seller = typeof offer.seller === 'object' ? offer.seller.name : offer.seller;
              }
            }
          }
        }
      }
    } catch (_e) {
      // Ignore JSON parse errors
    }
  });

  // 2. OpenGraph Meta Tags
  if (!title) {
    title = $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content');
  }

  if (!image) {
    image = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || null;
  }

  if (!rawDescription) {
    rawDescription = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || null;
  }

  if (!price) {
    const ogPrice = $('meta[property="product:price:amount"]').attr('content');
    if (ogPrice) price = parsePrice(ogPrice);
  }

  const ogCurrency = $('meta[property="product:price:currency"]').attr('content');
  if (ogCurrency) currency = ogCurrency;

  // 3. HTML fallback
  if (!title) {
    title = $('h1').first().text().trim();
  }

  if (!price) {
    // Check standard price classes or microdata
    const priceText = $('[itemprop="price"], .price, .product-price, .current-price').first().text();
    if (priceText) price = parsePrice(priceText);
  }

  if (!title) {
    return {
      success: false,
      error: 'Could not extract product title from page',
    };
  }

  const hostname = new URL(url).hostname;
  const retailerName = detectRetailerFromHostname(hostname) || hostname;
  const identity = parseProductIdentity(title);

  if (!brand && identity.brand) brand = identity.brand;
  if (!model && identity.model) model = identity.model;

  const listing = createProductListing({
    title,
    brand,
    model,
    variant: identity.storage || identity.ram || null,
    specifications: Object.keys(specifications).length > 0 ? specifications : null,
    image,
    rawDescription,
    price,
    originalPrice,
    currency,
    retailer: retailerName,
    seller,
    url,
    availability: availability || 'Available',
    shippingCharge: null,
    verificationStatus: price ? VERIFICATION_STATUS.VERIFIED_PAGE : VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
    source: 'generic-page',
    extractionNotes: 'Extracted via generic Schema.org / OpenGraph parser',
  });

  return {
    success: true,
    listing,
    identity,
  };
}
