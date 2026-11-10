import * as cheerio from 'cheerio';
import { BaseProvider, PROVIDER_STATUS } from './baseProvider.js';
import { fetchAndExtractProduct } from '../extraction/index.js';

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
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
      const discoveredUrls = [];

      $('h3 a').each((_, el) => {
        const rawHref = $(el).attr('href');
        if (!rawHref) return;

        let targetUrl = rawHref;
        if (rawHref.includes('/RU=')) {
          const match = rawHref.match(/\/RU=([^/]+)/);
          if (match) targetUrl = decodeURIComponent(match[1]);
        }

        // Check if it is a Croma product page (contains /p/)
        if (targetUrl.includes('croma.com/') && targetUrl.includes('/p/')) {
          if (!discoveredUrls.includes(targetUrl)) {
            discoveredUrls.push(targetUrl);
          }
        }
      });

      const listings = [];
      // Fetch up to 2 distinct product pages to extract verified product details
      for (const productUrl of discoveredUrls.slice(0, 2)) {
        try {
          const extracted = await fetchAndExtractProduct(productUrl, { timeoutMs: 6000 });
          if (extracted.success && extracted.listing) {
            listings.push(extracted.listing);
          }
        } catch (_fetchErr) {
          // If individual page fetch fails, continue
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
