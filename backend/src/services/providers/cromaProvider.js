import * as cheerio from 'cheerio';
import { BaseProvider, PROVIDER_STATUS } from './baseProvider.js';
import { fetchAndExtractProduct } from '../extraction/index.js';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from '../extraction/baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';

export class CromaProvider extends BaseProvider {
  constructor() {
    super({
      id: 'croma_direct',
      name: 'Croma Direct & Discovery',
      isEnabled: true,
    });
  }

  async search(query, options = {}) {
    const startTime = Date.now();
    const { timeoutMs = 8000 } = options;

    try {
      const searchTerms = `site:croma.com ${query}`;
      const encodedQuery = encodeURIComponent(searchTerms);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let res;
      try {
        res = await fetch(`https://in.search.yahoo.com/search?p=${encodedQuery}`, {
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
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        throw new Error(`Croma discovery query failed with HTTP ${res.status}`);
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      const candidates = [];

      $('h3 a').each((_, el) => {
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

        // Check if it is a Croma product page (contains /p/)
        if (targetUrl.includes('croma.com/') && targetUrl.includes('/p/')) {
          if (!candidates.some((c) => c.href === targetUrl)) {
            candidates.push({ href: targetUrl, rawTitle, snippet });
          }
        }
      });

      const listings = [];
      // Fetch up to 2 distinct product pages to extract verified product details
      for (const item of candidates.slice(0, 2)) {
        let extractedFromPage = false;
        try {
          const extracted = await fetchAndExtractProduct(item.href, { timeoutMs: 5000 });
          if (extracted.success && extracted.listing && extracted.listing.price) {
            listings.push(extracted.listing);
            extractedFromPage = true;
          }
        } catch (_fetchErr) {
          // If individual page fetch fails, fall back to snippet
        }

        if (!extractedFromPage && item.rawTitle) {
          let price = null;
          const match = (item.snippet + ' ' + item.rawTitle).match(/(?:₹|Rs\.?)\s*([0-9,]+)/i);
          if (match) price = parsePrice(match[1]);

          const identity = parseProductIdentity(item.rawTitle);
          listings.push(
            createProductListing({
              title: item.rawTitle,
              brand: identity.brand,
              model: identity.model,
              variant: identity.storage || identity.ram || null,
              price,
              currency: 'INR',
              retailer: 'Croma',
              url: item.href,
              verificationStatus: VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
              source: 'croma-discovery',
              extractionNotes: price
                ? `Discovered on Croma, price from snippet (${price})`
                : 'Discovered on Croma',
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
