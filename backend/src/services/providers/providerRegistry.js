import { YahooPublicProvider } from './yahooProvider.js';
import { DuckDuckGoProvider } from './duckDuckGoProvider.js';
import { CromaProvider } from './cromaProvider.js';
import { FlipkartProvider } from './flipkartProvider.js';
import { AmazonProvider } from './amazonProvider.js';
import { deduplicateListings } from '../matching/matcher.js';

class ProviderRegistry {
  constructor() {
    this.providers = [
      new YahooPublicProvider(),
      new DuckDuckGoProvider(),
      new CromaProvider(),
      new FlipkartProvider(),
      new AmazonProvider(),
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
    const promises = this.providers.map(async (provider) => {
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

    // For each alias, dispatch all providers simultaneously.
    // We collect per-alias, per-provider results then merge.
    const allRoundResults = await Promise.allSettled(
      uniqueAliases.map((alias) => this.executeSearchAll(alias, { timeoutMs }))
    );

    // Merge providerStats: aggregate across rounds, summing resultsCounts, keeping worst status
    const providerStatsMap = new Map();
    const rawListings = [];

    for (const round of allRoundResults) {
      if (round.status !== 'fulfilled') continue;
      const { allListings, providerStats } = round.value;
      rawListings.push(...allListings);

      for (const stat of providerStats) {
        const existing = providerStatsMap.get(stat.id);
        if (!existing) {
          providerStatsMap.set(stat.id, { ...stat });
        } else {
          // Accumulate result count; keep the worst status and last error
          existing.resultsCount += stat.resultsCount;
          existing.durationMs = Math.max(existing.durationMs, stat.durationMs);
          if (stat.error) existing.error = stat.error;
          // Upgrade status to reflect the best seen across rounds
          const statusPriority = { Working: 3, 'Rate Limited': 2, Unavailable: 1 };
          if ((statusPriority[stat.status] || 0) > (statusPriority[existing.status] || 0)) {
            existing.status = stat.status;
          }
        }
      }
    }

    // Deduplicate across all results
    const allListings = deduplicateListings(rawListings);

    return {
      allListings,
      providerStats: [...providerStatsMap.values()],
      queriesDispatched: uniqueAliases,
    };
  }
}

export const providerRegistry = new ProviderRegistry();
