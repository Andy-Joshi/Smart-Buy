import * as cheerio from 'cheerio';
import { BaseProvider, PROVIDER_STATUS } from './baseProvider.js';
import { detectRetailerFromHostname } from '../security/safeUrlValidator.js';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from '../extraction/baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';

export class DuckDuckGoProvider extends BaseProvider {
  constructor() {
    super({
      id: 'duckduckgo_public',
      name: 'DuckDuckGo Public Search',
      isEnabled: true,
    });
  }

  async search(query, options = {}) {
    const startTime = Date.now();
    const { timeoutMs = 8000 } = options;

    try {
      const searchTerms = `${query} price India croma OR flipkart OR amazon OR reliancedigital`;
      const bodyParams = new URLSearchParams({ q: searchTerms });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let res;
      try {
        res = await fetch('https://lite.duckduckgo.com/lite/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
          body: bodyParams.toString(),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        if (res.status === 429) {
          this.markFailure(new Error('DuckDuckGo rate limit exceeded (429)'), true);
          return {
            results: [],
            durationMs: Date.now() - startTime,
            error: 'Rate limit encountered on search source',
            status: PROVIDER_STATUS.RATE_LIMITED,
          };
        }
        throw new Error(`DuckDuckGo responded with HTTP ${res.status}`);
      }

      const html = await res.text();

      // Check for anomaly / captcha modal
      if (html.includes('anomaly-modal') || html.includes('captcha')) {
        this.markFailure(new Error('Bot verification challenge received'), true);
        return {
          results: [],
          durationMs: Date.now() - startTime,
          error: 'DuckDuckGo presented a bot challenge',
          status: PROVIDER_STATUS.RATE_LIMITED,
        };
      }

      const $ = cheerio.load(html);
      const listings = [];

      $('a.result-link').each((_, el) => {
        const $link = $(el);
        let href = $link.attr('href');
        const rawTitle = $link.text().trim();

        if (!href || !rawTitle) return;

        // Skip ads
        if (href.includes('duckduckgo.com/y.js') || href.includes('bing.com/aclick') || rawTitle === 'more info') {
          return;
        }

        // Handle DDG redirect link if present
        if (href.includes('uddg=')) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) href = decodeURIComponent(match[1]);
        }

        // Snippet
        const $tr = $link.closest('tr');
        const snippet = $tr.next('tr').find('.result-snippet').text().trim();

        let hostname;
        try {
          hostname = new URL(href).hostname;
        } catch (_e) {
          return;
        }

        const retailer = detectRetailerFromHostname(hostname);
        if (!retailer) {
          // Only collect listings from supported / relevant retailers or e-commerce sites
          return;
        }

        // Attempt price extraction from snippet or title
        // e.g. "for Rs.14990", "₹6,989", "at ₹7,599", "MRP ₹14,990"
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
          url: href,
          verificationStatus: VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
          source: 'duckduckgo_lite',
          extractionNotes: price
            ? `Price extracted from DuckDuckGo snippet: "${snippet.slice(0, 100)}..."`
            : 'Discovered URL via DuckDuckGo',
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
