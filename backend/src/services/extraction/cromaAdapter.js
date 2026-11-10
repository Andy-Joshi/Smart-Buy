import * as cheerio from 'cheerio';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from './baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';

/**
 * Adapter for Croma (croma.com) product pages.
 */
export async function extractFromCromaHtml(html, url) {
  if (!html || typeof html !== 'string') {
    throw new Error('Empty HTML content received from Croma');
  }

  const $ = cheerio.load(html);

  let title = null;
  let price = null;
  let originalPrice = null;
  let brand = null;
  let model = null;
  let availability = null;
  let seller = 'Croma (Infiniti Retail Ltd.)';
  let image = null;
  let rawDescription = null;
  let specifications = {};

  // Try extracting Schema.org JSON-LD first (Croma embeds high-fidelity Product schema)
  $('script[type="application/ld+json"]').each((_, el) => {
    const rawContent = $(el).html() || '';
    if (!rawContent.includes('Product')) return;

    try {
      // First try standard parse
      const data = JSON.parse(rawContent);
      if (data['@type'] === 'Product') {
        title = data.name;
        if (data.brand) {
          brand = typeof data.brand === 'object' ? data.brand.name : data.brand;
        }
        if (data.image) {
          image = Array.isArray(data.image) ? data.image[0] : (typeof data.image === 'object' ? data.image.url : data.image);
        }
        if (data.description && typeof data.description === 'string') {
          rawDescription = data.description;
        }
        if (data.offers) {
          const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
          if (offer) {
            price = parsePrice(offer.price);
            if (offer.availability) {
              availability = offer.availability.includes('InStock') ? 'In Stock' : 'Out of Stock';
            }
          }
        }
        if (data.sku) {
          specifications.sku = data.sku;
        }
      }
    } catch (_parseErr) {
      // Lenient regex fallback for JSON containing unescaped control characters in description strings
      const nameMatch = rawContent.match(/"name"\s*:\s*"([^"]+)"/);
      const priceMatch = rawContent.match(/"price"\s*:\s*"([^"]+)"/);
      const brandMatch = rawContent.match(/"brand"\s*:\s*{\s*"@type"\s*:\s*"Brand",\s*"name"\s*:\s*"([^"]+)"/);
      const skuMatch = rawContent.match(/"sku"\s*:\s*"([^"]+)"/);
      const availMatch = rawContent.match(/"availability"\s*:\s*"([^"]+)"/);
      const imageMatch = rawContent.match(/"image"\s*:\s*"([^"]+)"/);

      if (nameMatch) title = nameMatch[1];
      if (priceMatch) price = parsePrice(priceMatch[1]);
      if (brandMatch) brand = brandMatch[1];
      if (skuMatch) specifications.sku = skuMatch[1];
      if (imageMatch) image = imageMatch[1];
      if (availMatch) {
        availability = availMatch[1].includes('InStock') ? 'In Stock' : 'Out of Stock';
      }
    }
  });

  // Fallback to OpenGraph / Meta tags
  if (!image) {
    image = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || null;
  }
  if (!rawDescription) {
    rawDescription = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || null;
  }

  // Fallback to HTML selectors
  if (!title) {
    title = $('h1.pd-title, h1[data-testid="pdp-product-title"], h1').first().text().trim();
  }

  if (!price) {
    const priceText = $('.amount, .main-product-price, [data-testid="new-price"]').first().text();
    price = parsePrice(priceText);
  }

  const mrpText = $('.old-price, .mrp-price, [data-testid="old-price"]').first().text();
  if (mrpText) {
    originalPrice = parsePrice(mrpText);
  }

  if (!title) {
    return {
      success: false,
      error: 'Failed to extract product title from Croma page',
    };
  }

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
    currency: 'INR',
    retailer: 'Croma',
    seller,
    url,
    availability: availability || 'Available',
    shippingCharge: 0, // Croma standard electronics usually free delivery
    verificationStatus: VERIFICATION_STATUS.VERIFIED_PAGE,
    source: 'croma-page',
    extractionNotes: 'Extracted from Croma structured product page',
  });

  return {
    success: true,
    listing,
    identity,
  };
}
