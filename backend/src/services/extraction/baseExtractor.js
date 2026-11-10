/**
 * Base extractor utilities and verification status definitions.
 */

export const VERIFICATION_STATUS = {
  VERIFIED_PAGE: 'VERIFIED_PAGE',
  VERIFIED_API: 'VERIFIED_API',
  UNVERIFIED_SNIPPET: 'UNVERIFIED_SNIPPET',
};

/**
 * Parse monetary values from strings into floating-point numbers.
 * Supports INR formats: "₹6,990", "Rs. 14,990.00", "6,990", "7599".
 *
 * @param {string|number} rawPrice
 * @returns {number|null} parsed price or null
 */
export function parsePrice(rawPrice) {
  if (rawPrice === null || rawPrice === undefined) return null;
  if (typeof rawPrice === 'number') {
    return isNaN(rawPrice) || rawPrice <= 0 ? null : Math.round(rawPrice * 100) / 100;
  }

  const str = String(rawPrice).trim();
  if (!str) return null;

  // Remove currency signs, commas, and extra spaces
  // Examples: "₹ 6,990.00" -> "6990.00", "Rs. 14,990" -> "14990"
  const cleaned = str
    .replace(/[₹Rs.\s,]/gi, (match) => (match === '.' ? '.' : ''))
    .trim();

  // If there's multiple dots or malformed numbers, extract the first valid sequence
  const match = cleaned.match(/\d+(?:\.\d{1,2})?/);
  if (!match) return null;

  const val = parseFloat(match[0]);
  return isNaN(val) || val <= 0 ? null : Math.round(val * 100) / 100;
}

/**
 * Standardize extracted product representation.
 * All missing information must be null.
 */
export function createProductListing({
  title = null,
  brand = null,
  model = null,
  variant = null,
  specifications = null,
  image = null,
  rawDescription = null,
  price = null,
  originalPrice = null,
  currency = 'INR',
  retailer = null,
  seller = null,
  url = null,
  availability = null,
  shippingCharge = null,
  discountAmount = null,
  verificationStatus = VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
  source = 'search',
  extractionNotes = null,
} = {}) {
  const parsedPrice = parsePrice(price);
  const parsedOriginalPrice = parsePrice(originalPrice);

  let calculatedDiscount = parsePrice(discountAmount);
  if (calculatedDiscount === null && parsedOriginalPrice && parsedPrice && parsedOriginalPrice > parsedPrice) {
    calculatedDiscount = Math.round((parsedOriginalPrice - parsedPrice) * 100) / 100;
  }

  return {
    title: title ? title.trim() : null,
    brand: brand ? brand.trim() : null,
    model: model ? model.trim() : null,
    variant: variant ? variant.trim() : null,
    specifications: specifications && typeof specifications === 'object' ? specifications : null,
    image: image ? String(image).trim() : null,
    rawDescription: rawDescription ? String(rawDescription).trim() : null,
    price: parsedPrice,
    originalPrice: parsedOriginalPrice,
    currency: currency || 'INR',
    retailer: retailer || null,
    seller: seller ? seller.trim() : null,
    url: url || null,
    availability: availability ? availability.trim() : null,
    shippingCharge: parsePrice(shippingCharge),
    discountAmount: calculatedDiscount,
    extractedAt: new Date().toISOString(),
    verificationStatus,
    source,
    extractionNotes,
  };
}
