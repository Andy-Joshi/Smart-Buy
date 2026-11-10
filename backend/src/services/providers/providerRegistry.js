import { YahooPublicProvider } from './yahooProvider.js';
import { DuckDuckGoProvider } from './duckDuckGoProvider.js';
import { CromaProvider } from './cromaProvider.js';
import { FlipkartProvider } from './flipkartProvider.js';
import { AmazonProvider } from './amazonProvider.js';
import { deduplicateListings } from '../matching/matcher.js';

class ProviderRegistry {
  constructor() {
    this.providers = [
      new FlipkartProvider(),
      new AmazonProvider(),
      new CromaProvider(),
      new YahooPublicProvider(),
      new DuckDuckGoProvider(),
    ];
  }

  getProviders() {
    return this.providers;
  }

  getHealthSummary() {
    return this.providers.map((p) => p.getHealth());
  }

  /**
   * Execute search across all registered providers concurrently for a SINGLE query.
   *
   * @param {string} query
   * @param {Object} [options]
   * @returns {Promise<{
   *   allListings: Array,
   *   providerStats: Array<{ id: string, name: string, status: string, durationMs: number, resultsCount: number, error: string|null }>
   * }>}
   */
  async executeSearchAll(query, options = {}) {
    const promises = this.providers.map(async (provider, index) => {
      // Slight stagger to prevent concurrent burst hammering against shared discovery endpoints
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, index * 60));
      }

      const start = Date.now();
      try {
        const result = await provider.search(query, options);
        return {
          id: provider.id,
          name: provider.name,
          status: result.status,
          durationMs: result.durationMs || Date.now() - start,
          resultsCount: (result.results || []).length,
          error: result.error,
          results: result.results || [],
        };
      } catch (err) {
        return {
          id: provider.id,
          name: provider.name,
          status: 'Unavailable',
          durationMs: Date.now() - start,
          resultsCount: 0,
          error: err.message || 'Execution failed',
          results: [],
        };
      }
    });

    const settled = await Promise.allSettled(promises);
    const providerStats = [];
    const allListings = [];

    for (const item of settled) {
      if (item.status === 'fulfilled') {
        const data = item.value;
        providerStats.push({
          id: data.id,
          name: data.name,
          status: data.status,
          durationMs: data.durationMs,
          resultsCount: data.resultsCount,
          error: data.error,
        });
        allListings.push(...data.results);
      }
    }

    return {
      allListings,
      providerStats,
    };
  }

  /**
   * Execute multi-query discovery across all providers.
   *
   * Sends up to `maxAliases` queries to all providers in parallel using
   * Promise.allSettled so that any single failure cannot block others.
   * Results are deduplicated across all queries + all providers.
   *
   * @param {Object} queryIdentity  - Structured QueryIdentity from parseQueryIdentity().
   * @param {Object} [options]
   * @param {number} [options.maxAliases=3]      - Max aliases to dispatch (caps requests).
   * @param {number} [options.timeoutMs=8000]    - Per-provider request timeout.
   * @returns {Promise<{
   *   allListings: Array,
   *   providerStats: Array,
   *   queriesDispatched: string[],
   * }>}
   */
  async executeSearchMultiQuery(queryIdentity, options = {}) {
    const { maxAliases = 3, timeoutMs = 8000 } = options;

    // Build the alias list: use queryIdentity.searchAliases first, fall back to originalQuery
    const aliases = (queryIdentity.searchAliases || []).slice(0, maxAliases);
    if (aliases.length === 0) {
      aliases.push(queryIdentity.originalQuery || queryIdentity.normalizedQuery || '');
    }

    // Deduplicate aliases (case-insensitive)
    const seen = new Set();
    const uniqueAliases = aliases.filter((a) => {
      const k = a.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // For each alias, dispatch providers with early satisfaction once multi-retailer variety is achieved.
    const aliasesToDispatch = uniqueAliases.slice(0, maxAliases);
    const providerStatsMap = new Map();
    const rawListings = [];

    for (let roundIdx = 0; roundIdx < aliasesToDispatch.length; roundIdx++) {
      const alias = aliasesToDispatch[roundIdx];
      // If round 0 already returned listings from 2 or more distinct retailers, response is complete
      if (roundIdx > 0) {
        const distinctRetailers = new Set(rawListings.map((l) => l.retailer).filter(Boolean));
        if (distinctRetailers.size >= 2) {
          break;
        }
      }

      try {
        const roundRes = await this.executeSearchAll(alias, { timeoutMs });
        rawListings.push(...roundRes.allListings);

        for (const stat of roundRes.providerStats) {
          const existing = providerStatsMap.get(stat.id);
          if (!existing) {
            providerStatsMap.set(stat.id, { ...stat });
          } else {
            existing.resultsCount += stat.resultsCount;
            existing.durationMs = Math.max(existing.durationMs, stat.durationMs);
            if (stat.error) existing.error = stat.error;
            const statusPriority = { Working: 3, 'Rate Limited': 2, Unavailable: 1 };
            if ((statusPriority[stat.status] || 0) > (statusPriority[existing.status] || 0)) {
              existing.status = stat.status;
            }
          }
        }
      } catch (_err) {
        // Continue to next alias
      }
    }

    // Deduplicate across all results
    const allListings = deduplicateListings(rawListings);

    return {
      allListings,
      providerStats: [...providerStatsMap.values()],
      queriesDispatched: aliasesToDispatch,
    };
  }
}

export const providerRegistry = new ProviderRegistry();
