import * as cheerio from 'cheerio';
import { BaseProvider, PROVIDER_STATUS } from './baseProvider.js';
import { detectRetailerFromHostname } from '../security/safeUrlValidator.js';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from '../extraction/baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';

export class YahooPublicProvider extends BaseProvider {
  constructor() {
    super({
      id: 'yahoo_public',
      name: 'Public Search (Yahoo India)',
      isEnabled: true,
    });
  }

  async search(query, options = {}) {
    const startTime = Date.now();
    const { timeoutMs = 8000 } = options;

    try {
      const searchTerms = `${query} price India croma OR flipkart OR amazon OR reliancedigital`;
      const encodedQuery = encodeURIComponent(searchTerms);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let res;
      try {
        res = await fetch(`https://in.search.yahoo.com/search?p=${encodedQuery}`, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        throw new Error(`Yahoo search responded with HTTP ${res.status}`);
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      const listings = [];

      $('h3 a').each((_, el) => {
        const $link = $(el);
        const rawHref = $link.attr('href');
        let rawTitle = $link.text().trim();

        if (!rawHref || !rawTitle) return;

        // Skip ads or irrelevant items
        if (rawTitle === 'Images' || rawTitle === 'Videos') return;

        // Clean breadcrumb text prepended to title if present (e.g. "www.croma.com › ...")
        rawTitle = rawTitle.replace(/^[a-zA-Z0-9.-]+\.[a-z]{2,4}\s*›[^›\n]+\s*/i, '').trim();

        // Decode Yahoo redirect URL (/RU=...)
        let targetUrl = rawHref;
        if (rawHref.includes('/RU=')) {
          const match = rawHref.match(/\/RU=([^/]+)/);
          if (match) {
            targetUrl = decodeURIComponent(match[1]);
          }
        }

        let hostname;
        try {
          hostname = new URL(targetUrl).hostname;
        } catch (_e) {
          return;
        }

        const retailer = detectRetailerFromHostname(hostname);
        if (!retailer) {
          return;
        }

        // Snippet
        const $container = $link.closest('li');
        const snippet = $container.find('.compText, .lh-16').text().trim();

        // Price parsing from snippet or title
        let price = null;
        let originalPrice = null;
        const priceRegex = /(?:₹|Rs\.?)\s*([0-9,]+(?:\.\d{2})?)/gi;
        const matches = [...(snippet + ' ' + rawTitle).matchAll(priceRegex)];
        if (matches.length > 0) {
          price = parsePrice(matches[0][1]);
          if (matches.length > 1) {
            const secondPrice = parsePrice(matches[1][1]);
            if (secondPrice && price && secondPrice > price) {
              originalPrice = secondPrice;
            }
          }
        }

        const identity = parseProductIdentity(rawTitle);

        const listing = createProductListing({
          title: rawTitle,
          brand: identity.brand,
          model: identity.model,
          variant: identity.storage || identity.ram || null,
          price,
          originalPrice,
          currency: 'INR',
          retailer,
          url: targetUrl,
          verificationStatus: VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
          source: 'yahoo_public',
          extractionNotes: price
            ? `Price extracted from public search snippet (${price})`
            : 'Discovered URL via public search',
        });

        listings.push(listing);
      });

      this.markSuccess();
      return {
        results: listings,
        durationMs: Date.now() - startTime,
        error: null,
        status: PROVIDER_STATUS.WORKING,
      };
    } catch (err) {
      this.markFailure(err);
      return {
        results: [],
        durationMs: Date.now() - startTime,
        error: err.message,
        status: PROVIDER_STATUS.UNAVAILABLE,
      };
    }
  }
}
