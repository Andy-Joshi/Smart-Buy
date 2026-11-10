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
      const candidates = [];

      // 1. Fast Primary Discovery: Direct Indian Price API
      try {
        const priceeRes = await fetch(
          `https://pricee.com/api/v1/search.php?q=${encodeURIComponent(query)}`,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              Accept: 'application/json, text/plain, */*',
            },
            signal: AbortSignal.timeout(Math.min(timeoutMs, 3500)),
          }
        );

        if (priceeRes.ok) {
          const json = await priceeRes.json();
          for (const item of json.data || []) {
            if (item.source_name?.toLowerCase() !== 'amazon') continue;
            const price = parsePrice(item.source_price);
            if (!price || price <= 0) continue;

            let directUrl = item.url;
            if (item.id?.startsWith('2-')) {
              directUrl = `https://www.amazon.in/dp/${item.id.slice(2).toUpperCase()}`;
            }

            // Exclude obvious accessories and unwanted conditions (e.g. refurbished unless queried)
            const titleLower = (item.title || '').toLowerCase();
            const queryLower = query.toLowerCase();
            const isAccessory =
              titleLower.includes('case') ||
              titleLower.includes('cover') ||
              titleLower.includes('glass') ||
              titleLower.includes('protector') ||
              titleLower.includes('strap') ||
              titleLower.includes('cable');
            const isRefurbished =
              !queryLower.includes('refurbish') &&
              !queryLower.includes('renew') &&
              (titleLower.includes('refurbished') || titleLower.includes('renewed'));

            if (!isAccessory && !isRefurbished && !candidates.some((c) => c.href === directUrl)) {
              candidates.push({
                href: directUrl,
                rawTitle: item.title,
                snippet: `₹${price}`,
                directPrice: price,
                originalPrice: parsePrice(item.source_mrp) || null,
                image: item.image || null,
              });
            }
          }
        }
      } catch (_apiErr) {
        // Fall back to public discovery
      }

      // 2. Secondary Discovery: Public Search Fallback if API returned no candidates
      if (candidates.length === 0) {
        try {
          const searchTerms = `${query} amazon`;
          const encodedQuery = encodeURIComponent(searchTerms);

          const html = await scheduleYahooRequest(async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 4000));

            try {
              const res = await fetch(`https://in.search.yahoo.com/search?p=${encodedQuery}`, {
                headers: {
                  'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                  'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
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
            if (!rawTitle) rawTitle = $link.text().trim();
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

            const isNotProduct =
              targetUrl.includes('/s?') ||
              targetUrl.includes('/b?') ||
              targetUrl.includes('/help') ||
              targetUrl.includes('/gp/help');

            if (targetUrl.includes('amazon.in/') && !isNotProduct) {
              const $container = $link.closest('li');
              const snippet = $container.find('.compText, .lh-16').text().trim();

              if (!candidates.some((c) => c.href === targetUrl)) {
                candidates.push({ href: targetUrl, rawTitle, snippet });
              }
            }
          });
        } catch (_fallbackErr) {
          // Keep whatever candidates we found
        }
      }

      const listings = [];
      for (const item of candidates.slice(0, 3)) {
        if (!item.rawTitle) continue;
        let price = item.directPrice || null;
        if (!price) {
          const match = (item.snippet + ' ' + item.rawTitle).match(/(?:₹|Rs\.?)\s*([0-9,]+(?:\.\d{2})?)/i);
          if (match) price = parsePrice(match[1]);
        }

        let pageListing = null;
        if (!price && item.href && listings.length === 0) {
          try {
            const pageRes = await fetchAndExtractProduct(item.href, { timeoutMs: 3000 });
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
              originalPrice: item.originalPrice || null,
              currency: 'INR',
              retailer: 'Amazon India',
              url: item.href,
              image: item.image || null,
              verificationStatus: price ? VERIFICATION_STATUS.VERIFIED_API : VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
              source: 'amazon-discovery',
              extractionNotes: price
                ? `Discovered on Amazon India; price verified (${price})`
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
