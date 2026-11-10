import * as cheerio from 'cheerio';
import { BaseProvider, PROVIDER_STATUS } from './baseProvider.js';
import { fetchAndExtractProduct } from '../extraction/index.js';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from '../extraction/baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';
import { scheduleYahooRequest } from './yahooScheduler.js';

export class AmazonProvider extends BaseProvider {
  constructor() {
    super({
      id: 'amazon_direct',
      name: 'Amazon India Direct & Discovery',
      isEnabled: true,
    });
  }

  async search(query, options = {}) {
    const startTime = Date.now();
    const { timeoutMs = 8000 } = options;

    try {
      const searchTerms = `${query} amazon`;
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
            throw new Error(`Amazon discovery search failed with HTTP ${res.status}`);
          }

          return await res.text();
        } finally {
          clearTimeout(timeout);
        }
      });

      const $ = cheerio.load(html);
      const candidates = [];

      $('.compTitle a, h3 a, #web a[href*="/RU="]').each((_, el) => {
        const $link = $(el);
        const rawHref = $link.attr('href');
        if (!rawHref) return;

        let rawTitle = $link.attr('aria-label')?.trim();
        if (!rawTitle) {
          const $clone = $link.clone();
          $clone.find('span').remove();
          rawTitle = $clone.text().trim();
        }
        if (!rawTitle) {
          rawTitle = $link.text().trim();
        }

        if (!rawTitle || rawTitle === 'Images' || rawTitle === 'Videos') return;

        rawTitle = rawTitle
          .replace(/^[a-zA-Z0-9.-]+\.[a-z]{2,4}(?:\s*›\s*[^›\n\s]+)*\s*›?\s*/i, '')
          .replace(/\s+/g, ' ')
          .trim();

        let targetUrl = rawHref;
        if (rawHref.includes('/RU=')) {
          const match = rawHref.match(/\/RU=([^/]+)/);
          if (match) targetUrl = decodeURIComponent(match[1]);
        }

        const $container = $link.closest('li');
        const snippet = $container.find('.compText, .lh-16').text().trim();

        const isNotProduct =
          targetUrl.includes('/s?') ||
          targetUrl.includes('/b?') ||
          targetUrl.includes('/help/') ||
          targetUrl.includes('/gp/help/');

        if (targetUrl.includes('amazon.in/') && !isNotProduct) {
          // If title is generic (e.g. "Amazon" or very short), recover from URL slug
          if (!rawTitle || rawTitle.toLowerCase() === 'amazon' || rawTitle.length < 8) {
            const slugMatch = targetUrl.match(/amazon\.in\/([^/]+?)(?:\/dp\/|\/|$)/i);
            if (slugMatch) {
              rawTitle = decodeURIComponent(slugMatch[1]).replace(/[-_]/g, ' ').trim();
            }
          }

          candidates.push({ href: targetUrl, rawTitle, snippet });
        }
      });

      const listings = [];
      for (const item of candidates.slice(0, 3)) {
        if (!item.rawTitle) continue;
        let price = null;
        const match = (item.snippet + ' ' + item.rawTitle).match(/(?:₹|Rs\.?)\s*([0-9,]+(?:\.\d{2})?)/i);
        if (match) price = parsePrice(match[1]);

        let pageListing = null;
        if (!price && item.href && listings.length === 0) {
          try {
            const pageRes = await fetchAndExtractProduct(item.href, { timeoutMs: 3500 });
            if (pageRes.success && pageRes.listing && pageRes.listing.price) {
              pageListing = pageRes.listing;
            }
          } catch (_e) {}
        }

        if (pageListing) {
          listings.push(pageListing);
        } else {
          const identity = parseProductIdentity(item.rawTitle);
          listings.push(
            createProductListing({
              title: item.rawTitle,
              brand: identity.brand,
              model: identity.model,
              variant: identity.storage || identity.ram || null,
              price,
              currency: 'INR',
              retailer: 'Amazon India',
              url: item.href,
              verificationStatus: VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
              source: 'amazon-discovery',
              extractionNotes: price
                ? `Discovered on Amazon India; price extracted from search snippet (${price})`
                : 'Discovered on Amazon India',
            })
          );
        }
      }

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
