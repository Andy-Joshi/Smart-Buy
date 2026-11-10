import * as cheerio from 'cheerio';
import { BaseProvider, PROVIDER_STATUS } from './baseProvider.js';
import { fetchAndExtractProduct } from '../extraction/index.js';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from '../extraction/baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';
import { scheduleYahooRequest } from './yahooScheduler.js';

function decodeBingUrl(href) {
  if (!href) return null;
  const match = href.match(/[?&]u=a1([^&]+)/);
  if (match) {
    let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    try {
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  return href;
}

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
      const candidates = [];

      // 1. Primary discovery: Bing Search
      try {
        const bingController = new AbortController();
        const bingTimeout = setTimeout(() => bingController.abort(), Math.min(timeoutMs, 3500));
        const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(`${query} site:croma.com`)}&setlang=en-in&cc=IN`;

        const bingRes = await fetch(bingUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-IN,en;q=0.9',
          },
          signal: bingController.signal,
        });
        clearTimeout(bingTimeout);

        if (bingRes.ok) {
          const bingHtml = await bingRes.text();
          const $b = cheerio.load(bingHtml);
          $b('li.b_algo, .b_algo').each((_, el) => {
            const $a = $b(el).find('h2 a').first();
            const href = decodeBingUrl($a.attr('href'));
            const title = $a.text().trim();
            const snippet = $b(el).find('.b_caption p, .b_algoSlug, p').first().text().trim();

            if (href && title && href.includes('croma.com')) {
              const isNotProduct =
                href.includes('/c/') ||
                href.includes('/search') ||
                href.includes('/help') ||
                href.includes('/offers') ||
                href.includes('/unboxed') ||
                href.includes('/lp-');
              if (!isNotProduct && !candidates.some((c) => c.href === href)) {
                candidates.push({ href, rawTitle: title, snippet });
              }
            }
          });
        }
      } catch (_bingErr) {
        // Fall back to Yahoo
      }

      // 2. Secondary discovery: Yahoo Search fallback
      if (candidates.length === 0) {
        try {
          const searchTerms = `${query} croma`;
          const encodedQuery = encodeURIComponent(searchTerms);

          const html = await scheduleYahooRequest(async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 4000));

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
                throw new Error(`Croma discovery query failed with HTTP ${res.status}`);
              }

              return await res.text();
            } finally {
              clearTimeout(timeout);
            }
          });

          const $y = cheerio.load(html);
          $y('.compTitle a, h3 a, #web a[href*="/RU="]').each((_, el) => {
            const $link = $y(el);
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
              targetUrl.includes('/c/') ||
              targetUrl.includes('/search') ||
              targetUrl.includes('/help') ||
              targetUrl.includes('/offers') ||
              targetUrl.includes('/unboxed');

            if (targetUrl.includes('croma.com/') && !isNotProduct) {
              if (
                !rawTitle ||
                rawTitle.toLowerCase() === 'croma' ||
                rawTitle.toLowerCase().startsWith('online shopping') ||
                rawTitle.length < 8
              ) {
                const slugMatch = targetUrl.match(/croma\.com\/([^/]+?)(?:\/p\/|\/|$)/i);
                if (slugMatch) {
                  rawTitle = decodeURIComponent(slugMatch[1]).replace(/[-_]/g, ' ').trim();
                }
              }

              const $container = $link.closest('li');
              const snippet = $container.find('.compText, .lh-16').text().trim();
              if (!candidates.some((c) => c.href === targetUrl)) {
                candidates.push({ href: targetUrl, rawTitle, snippet });
              }
            }
          });
        } catch (_yahooErr) {
          // Candidates remain as discovered
        }
      }

      const listings = [];
      for (const item of candidates.slice(0, 3)) {
        if (!item.rawTitle) continue;
        let price = null;
        const match = (item.snippet + ' ' + item.rawTitle).match(/(?:₹|Rs\.?)\s*([0-9,]+(?:\.\d{2})?)/i);
        if (match) price = parsePrice(match[1]);

        let extractedListing = null;
        if (!price && item.href && listings.length === 0) {
          try {
            const extracted = await fetchAndExtractProduct(item.href, { timeoutMs: 2500 });
            if (extracted.success && extracted.listing && extracted.listing.price) {
              extractedListing = extracted.listing;
            }
          } catch (_fetchErr) {
            // Keep snippet fallback
          }
        }

        if (extractedListing) {
          listings.push(extractedListing);
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
