import * as cheerio from 'cheerio';
import { BaseProvider, PROVIDER_STATUS } from './baseProvider.js';
import { detectRetailerFromHostname } from '../security/safeUrlValidator.js';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from '../extraction/baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';
import { scheduleYahooRequest } from './yahooScheduler.js';

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
      const searchTerms = `${query} buy online India`;
      const encodedQuery = encodeURIComponent(searchTerms);

      const html = await scheduleYahooRequest(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const res = await fetch(`https://in.search.yahoo.com/search?p=${encodedQuery}`, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
              'Sec-Fetch-User': '?1',
              'Upgrade-Insecure-Requests': '1',
            },
            signal: controller.signal,
          });

          if (!res.ok) {
            throw new Error(`Yahoo search responded with HTTP ${res.status}`);
          }

          return await res.text();
        } finally {
          clearTimeout(timeout);
        }
      });

      const $ = cheerio.load(html);
      const listings = [];

      $('h3 a').each((_, el) => {
        const $link = $(el);
        const rawHref = $link.attr('href');
        
        let rawTitle = $link.attr('aria-label')?.trim();
        if (!rawTitle) {
          const $clone = $link.clone();
          $clone.find('span').remove();
          rawTitle = $clone.text().trim();
        }
        if (!rawTitle) {
          rawTitle = $link.text().trim();
        }

        if (!rawHref || !rawTitle) return;

        // Skip ads or irrelevant items
        if (rawTitle === 'Images' || rawTitle === 'Videos') return;

        // Clean breadcrumb text prepended to title if present (e.g. "www.croma.com › ...")
        rawTitle = rawTitle
          .replace(/^[a-zA-Z0-9.-]+\.[a-z]{2,4}(?:\s*›\s*[^›\n\s]+)*\s*›?\s*/i, '')
          .replace(/\s+/g, ' ')
          .trim();

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

        // Recover product title from URL slug or snippet if rawTitle is generic
        const genericNames = ['amazon', 'flipkart', 'croma', 'reliance digital', 'vijay sales'];
        const isGenericTitle = genericNames.some((g) => rawTitle.toLowerCase() === g || rawTitle.toLowerCase().startsWith('online electronic') || rawTitle.toLowerCase().startsWith('online shopping'));
        if (isGenericTitle) {
          try {
            const parsedUrl = new URL(targetUrl);
            const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
            const slug = pathSegments.find((s) => s.length > 5 && !s.match(/^[0-9]+$/));
            if (slug) {
              rawTitle = decodeURIComponent(slug)
                .replace(/[-_]/g, ' ')
                .replace(/\b(dp|p|itm|product|buy|online)\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            } else if (snippet && snippet.length > 15) {
              rawTitle = snippet.split(/[.|•|-]/)[0].trim();
            }
          } catch (_e) {}
        }

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
