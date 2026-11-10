import * as cheerio from 'cheerio';
import { BaseProvider, PROVIDER_STATUS } from './baseProvider.js';
import { fetchAndExtractProduct } from '../extraction/index.js';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from '../extraction/baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';

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
      const searchTerms = `site:amazon.in ${query}`;
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
        throw new Error(`Amazon discovery search failed with HTTP ${res.status}`);
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      const candidates = [];

      $('h3 a').each((_, el) => {
        const $link = $(el);
        const rawHref = $link.attr('href');
        let rawTitle = $link.text().trim();
        if (!rawHref || !rawTitle) return;

        rawTitle = rawTitle.replace(/^[a-zA-Z0-9.-]+\.[a-z]{2,4}\s*›[^›\n]+\s*/i, '').trim();

        let targetUrl = rawHref;
        if (rawHref.includes('/RU=')) {
          const match = rawHref.match(/\/RU=([^/]+)/);
          if (match) targetUrl = decodeURIComponent(match[1]);
        }

        const $container = $link.closest('li');
        const snippet = $container.find('.compText, .lh-16').text().trim();

        if (targetUrl.includes('amazon.in/') && (targetUrl.includes('/dp/') || targetUrl.includes('/gp/product/'))) {
          candidates.push({ href: targetUrl, rawTitle, snippet });
        }
      });

      const listings = [];
      let encounteredBlock = false;

      for (const item of candidates.slice(0, 2)) {
        let extractedFromPage = false;
        try {
          const pageRes = await fetchAndExtractProduct(item.href, { timeoutMs: 5000 });
          if (pageRes.success && pageRes.listing && pageRes.listing.price) {
            listings.push(pageRes.listing);
            extractedFromPage = true;
          } else if (pageRes.blocked) {
            encounteredBlock = true;
          }
        } catch (_e) {
          // Fall back to snippet
        }

        if (!extractedFromPage) {
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
              retailer: 'Amazon India',
              url: item.href,
              verificationStatus: VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
              source: 'amazon-discovery',
              extractionNotes: price
                ? `Discovered on Amazon India; price extracted from search snippet (${price})`
                : 'Discovered on Amazon India (Direct page verification restricted by Amazon anti-bot)',
            })
          );
        }
      }

      if (encounteredBlock) {
        this.markFailure(new Error('Amazon anti-bot challenge (Robot Check) encountered'), true);
      } else {
        this.markSuccess();
      }

      return {
        results: listings,
        durationMs: Date.now() - startTime,
        error: encounteredBlock ? 'Direct page scraping restricted by Amazon anti-bot' : null,
        status: encounteredBlock ? PROVIDER_STATUS.RATE_LIMITED : PROVIDER_STATUS.WORKING,
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
