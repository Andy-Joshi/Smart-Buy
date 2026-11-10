import * as cheerio from 'cheerio';
import { BaseProvider, PROVIDER_STATUS } from './baseProvider.js';
import { fetchAndExtractProduct } from '../extraction/index.js';
import { createProductListing, parsePrice, VERIFICATION_STATUS } from '../extraction/baseExtractor.js';
import { parseProductIdentity } from '../matching/normalizer.js';

export class FlipkartProvider extends BaseProvider {
  constructor() {
    super({
      id: 'flipkart_direct',
      name: 'Flipkart Direct & Discovery',
      isEnabled: true,
    });
  }

  async search(query, options = {}) {
    const startTime = Date.now();
    const { timeoutMs = 8000 } = options;

    try {
      const candidates = [];

      // 1. First attempt: Direct Flipkart Search
      try {
        const directController = new AbortController();
        const directTimeout = setTimeout(() => directController.abort(), Math.min(timeoutMs, 4000));
        const directRes = await fetch(`https://www.flipkart.com/search?q=${encodeURIComponent(query)}`, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-IN,en;q=0.9',
          },
          signal: directController.signal,
        });
        clearTimeout(directTimeout);

        if (directRes.ok) {
          const directHtml = await directRes.text();
          const $direct = cheerio.load(directHtml);
          
          $direct('div[data-id], div[class*="_1AtVbE"], div[class*="cPHDOP"]').each((_, el) => {
            const $el = $direct(el);
            const $link = $el.find('a[href*="/p/"]').first();
            if (!$link.length) return;

            const href = $link.attr('href');
            if (!href) return;
            const fullUrl = href.startsWith('http') ? href : `https://www.flipkart.com${href.split('?')[0]}`;

            let title = $link.attr('title') || $el.find('img[alt]').first().attr('alt') || $el.find('div[class*="wjcEIp"]').first().text().trim();
            if (!title) {
              title = $link.text().trim().replace(/₹[\d,]+.*$/, '').trim();
            }

            const priceText = $el.find('div[class*="Nx9bqj"], div[class*="_30jeq3"]').first().text().trim() ||
                              $el.text().match(/₹\s*([0-9,]+)/)?.[0];
            const price = parsePrice(priceText);

            if (title && !candidates.some((c) => c.href === fullUrl)) {
              candidates.push({ href: fullUrl, rawTitle: title, snippet: priceText || '', directPrice: price });
            }
          });
        }
      } catch (_directErr) {
        // Fall back to Yahoo search discovery below
      }

      // 2. Secondary discovery via Yahoo if direct search yielded no candidates
      if (candidates.length === 0) {
        const searchTerms = `site:flipkart.com ${query}`;
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

        if (res.ok) {
          const html = await res.text();
          const $ = cheerio.load(html);

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

            if (targetUrl.includes('flipkart.com/') && (targetUrl.includes('/p/') || targetUrl.includes('pid='))) {
              if (!candidates.some((c) => c.href === targetUrl)) {
                candidates.push({ href: targetUrl, rawTitle, snippet });
              }
            }
          });
        }
      }

      const listings = [];

      for (const item of candidates.slice(0, 3)) {
        let extractedFromPage = false;
        try {
          const pageRes = await fetchAndExtractProduct(item.href, { timeoutMs: 5000 });
          if (pageRes.success && pageRes.listing && pageRes.listing.price) {
            listings.push(pageRes.listing);
            extractedFromPage = true;
          }
        } catch (_e) {
          // Fall back to snippet
        }

        if (!extractedFromPage && item.rawTitle) {
          let price = item.directPrice || null;
          if (!price) {
            const match = (item.snippet + ' ' + item.rawTitle).match(/(?:₹|Rs\.?)\s*([0-9,]+)/i);
            if (match) price = parsePrice(match[1]);
          }

          const identity = parseProductIdentity(item.rawTitle);
          listings.push(
            createProductListing({
              title: item.rawTitle,
              brand: identity.brand,
              model: identity.model,
              variant: identity.storage || identity.ram || null,
              price,
              currency: 'INR',
              retailer: 'Flipkart',
              url: item.href,
              verificationStatus: VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
              source: 'flipkart-discovery',
              extractionNotes: price
                ? `Discovered on Flipkart, price from snippet (${price})`
                : 'Discovered on Flipkart',
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
