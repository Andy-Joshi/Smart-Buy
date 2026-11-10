import { safeFetch } from '../security/safeUrlValidator.js';
import { extractFromCromaHtml } from './cromaAdapter.js';
import { extractFromFlipkartHtml } from './flipkartAdapter.js';
import { extractFromAmazonHtml } from './amazonAdapter.js';
import { extractFromRelianceDigitalHtml } from './relianceDigitalAdapter.js';
import { extractFromGenericHtml } from './genericExtractor.js';

/**
 * Route HTML content to retailer-specific extractor or generic fallback.
 */
export async function extractProductFromHtml(html, url) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();

  if (host.includes('croma.com')) {
    return extractFromCromaHtml(html, url);
  }
  if (host.includes('flipkart.com')) {
    return extractFromFlipkartHtml(html, url);
  }
  if (host.includes('amazon.')) {
    return extractFromAmazonHtml(html, url);
  }
  if (host.includes('reliancedigital.in')) {
    return extractFromRelianceDigitalHtml(html, url);
  }

  return extractFromGenericHtml(html, url);
}

/**
 * Safely fetches a URL and extracts product information.
 */
export async function fetchAndExtractProduct(url, options = {}) {
  const fetchResult = await safeFetch(url, options);
  const extractionResult = await extractProductFromHtml(fetchResult.text, fetchResult.finalUrl || url);

  return {
    ...extractionResult,
    statusCode: fetchResult.status,
    finalUrl: fetchResult.finalUrl,
  };
}
