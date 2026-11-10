
import crypto from 'node:crypto';

import { providerRegistry } from './providers/providerRegistry.js';
import { parseProductIdentity } from './matching/normalizer.js';
import { parseQueryIdentity } from './queryUnderstanding.js';

import {
  evaluateProductMatch,
  deduplicateListings,
  MATCH_STATUS,
} from './matching/matcher.js';

import { comparePrices } from './comparison/comparisonEngine.js';
import { validateSafeUrl } from './security/safeUrlValidator.js';
import { fetchAndExtractProduct } from './extraction/index.js';

import {
  createProductListing,
  VERIFICATION_STATUS,
} from './extraction/baseExtractor.js';

import { generateProductIntelligence } from './productIntelligence.js';

// In-memory diagnostics store: last 100 searches.
const searchCache = new Map();

function createSearchId() {
  return `sbl_${crypto.randomBytes(6).toString('hex')}`;
}

function getProviderDiagnostics(providerStats = []) {
  const successfulProviders = providerStats.filter(
    (provider) => provider.resultsCount > 0
  );

  const noResultProviders = providerStats.filter(
    (provider) =>
      provider.resultsCount === 0 &&
      provider.status === 'Working'
  );

  const failedProviders = providerStats.filter(
    (provider) =>
      provider.resultsCount === 0 &&
      provider.status !== 'Working'
  );

  return {
    successfulProviders: successfulProviders.map((p) => p.name),

    noResultProviders: noResultProviders.map((p) => p.name),

    failedProviders: failedProviders.map((p) => ({
      name: p.name,
      status: p.status,
      error: p.error || 'No results returned',
    })),

    providerErrors: failedProviders
      .filter((p) => p.error)
      .map((p) => `${p.name}: ${p.error}`),
  };
}

function cacheSearch(searchId, payload) {
  searchCache.set(searchId, payload);

  if (searchCache.size > 100) {
    const oldestKey = searchCache.keys().next().value;
    searchCache.delete(oldestKey);
  }
}

export class SearchCoordinator {
  /**
   * Mode A: Search by Product Name.
   */
  async searchByProductName(query) {
    const searchId = createSearchId();
    const startTime = Date.now();

    // 1. Understand the user query.
    const queryIdentity = parseQueryIdentity(query);

    // Build the structured target identity.
    const targetIdentity = parseProductIdentity(query);

    // 2. Discover products across configured providers.
    const {
      allListings: rawListings,
      providerStats = [],
      queriesDispatched = [],
    } = await providerRegistry.executeSearchMultiQuery(
      queryIdentity,
      { maxAliases: 3 }
    );

    // 3. Deep extraction for selected accessible retailers.
    let deepPagesAttempted = 0;
    let deepPagesSucceeded = 0;

    for (const listing of rawListings) {
      if (
        listing.verificationStatus !==
          VERIFICATION_STATUS.UNVERIFIED_SNIPPET ||
        !listing.url
      ) {
        continue;
      }

      if (deepPagesAttempted >= 2) break;

      if (
        listing.retailer === 'Croma' ||
        listing.retailer === 'Flipkart'
      ) {
        deepPagesAttempted++;

        try {
          const pageResult = await fetchAndExtractProduct(
            listing.url,
            { timeoutMs: 5000 }
          );

          if (
            pageResult.success &&
            pageResult.listing &&
            pageResult.listing.price
          ) {
            listing.price = pageResult.listing.price;

            listing.originalPrice =
              pageResult.listing.originalPrice ||
              listing.originalPrice;

            listing.availability =
              pageResult.listing.availability;

            listing.verificationStatus =
              VERIFICATION_STATUS.VERIFIED_PAGE;

            listing.extractionNotes =
              pageResult.listing.extractionNotes;

            deepPagesSucceeded++;
          }
        } catch (_error) {
          // Retain original discovery data if extraction fails.
        }
      }
    }

    // 4. Deduplicate results.
    const deduplicated = deduplicateListings(rawListings);

    const duplicatesRemoved =
      rawListings.length - deduplicated.length;

    // 5. Evaluate every listing against the target identity.
    const evaluatedListings = deduplicated.map((item) => {
      const evaluation = evaluateProductMatch(
        targetIdentity,
        item
      );

      return {
        ...item,
        matchEvaluation: evaluation,
      };
    });

    // 6. Separate match classifications.
    const exactMatches = evaluatedListings.filter(
      (listing) =>
        listing.matchEvaluation.status ===
        MATCH_STATUS.EXACT_MATCH
    );

    const highConfidenceMatches = evaluatedListings.filter(
      (listing) =>
        listing.matchEvaluation.status ===
        MATCH_STATUS.HIGH_CONFIDENCE
    );

    const possibleMatches = evaluatedListings.filter(
      (listing) =>
        listing.matchEvaluation.status ===
        MATCH_STATUS.POSSIBLE_MATCH
    );

    const rejectedListings = evaluatedListings.filter(
      (listing) =>
        listing.matchEvaluation.status ===
        MATCH_STATUS.REJECTED
    );

    // Only sufficiently validated products enter comparison.
    const validComparable = [
      ...exactMatches,
      ...highConfidenceMatches,
    ];

    // 7. Compare prices.
    const comparison = comparePrices(
      targetIdentity,
      validComparable
    );

    // 8. Generate product intelligence.
    const baseListing = createProductListing({
      title: targetIdentity.cleanTitle,
      brand: targetIdentity.brand,
      model: targetIdentity.model,
      variant:
        targetIdentity.storage ||
        targetIdentity.ram ||
        null,
      source: 'query-understanding',
    });

    const productIntelligence = generateProductIntelligence(
      baseListing,
      targetIdentity
    );

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    // 9. Provider diagnostics.
    const providerDiagnostics = getProviderDiagnostics(
      providerStats
    );

    const retailersQueried = [
      ...new Set(
        rawListings
          .map((listing) => listing.retailer)
          .filter(Boolean)
      ),
    ];

    const validPricesExtracted = deduplicated.filter(
      (listing) =>
        typeof listing.price === 'number' &&
        Number.isFinite(listing.price) &&
        listing.price > 0
    ).length;

    const diagnostics = {
      searchId,
      query,
      searchMode: 'PRODUCT_NAME',

      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      durationMs,

      normalizedIdentity: {
        brand: queryIdentity.brand,
        model: queryIdentity.model,
        category: queryIdentity.category,
        isConsumable: queryIdentity.isConsumable,
        quantity: queryIdentity.quantity,
      },

      queriesGenerated: queriesDispatched,

      providersAttempted: providerStats,

      ...providerDiagnostics,

      retailersQueried,

      listingsDiscovered: rawListings.length,

      listingsAfterDeduplication: deduplicated.length,

      productPagesAttempted: deepPagesAttempted,

      productPagesExtracted: deepPagesSucceeded,

      validPricesExtracted,

      duplicatesRemoved,

      exactMatches: exactMatches.length,

      highConfidenceMatches: highConfidenceMatches.length,

      possibleMatches: possibleMatches.length,

      rejectedListings: rejectedListings.length,

      variantMismatchesRejected: rejectedListings.length,

      comparableProducts: validComparable.length,
    };

    // 10. Build response.
    const responsePayload = {
      searchId,
      searchMode: 'PRODUCT_NAME',
      query,

      queryIdentity,
      targetIdentity,

      productIntelligence,

      comparison,

      results: {
        exactMatches,
        highConfidenceMatches,
        possibleMatches,
        rejectedListings,

        totalDiscovered: rawListings.length,

        totalMatched: validComparable.length,

        totalRejected: rejectedListings.length,
      },

      diagnostics,
    };

    cacheSearch(searchId, responsePayload);

    return responsePayload;
  }

  /**
   * Mode B: Paste Product URL.
   */
  async searchByProductUrl(rawUrl) {
    const searchId = createSearchId();
    const startTime = Date.now();

    // 1. Validate the supplied URL.
    const validation = await validateSafeUrl(rawUrl);

    if (!validation.valid) {
      const durationMs = Date.now() - startTime;

      const errorPayload = {
        searchId,
        searchMode: 'PRODUCT_URL',
        url: rawUrl,
        success: false,
        error: validation.error,

        diagnostics: {
          searchId,
          query: rawUrl,
          searchMode: 'PRODUCT_URL',
          durationMs,
          status: 'BLOCKED_INVALID_URL',
          reason: validation.error,
        },
      };

      cacheSearch(searchId, errorPayload);

      return errorPayload;
    }

    const targetUrl = rawUrl.trim();

    let initialListing = null;
    let initialIdentity = null;
    let extractionError = null;
    let isBlocked = false;

    // 2. Extract the supplied product page.
    try {
      const pageResult = await fetchAndExtractProduct(
        targetUrl,
        { timeoutMs: 8000 }
      );

      if (pageResult.success && pageResult.listing) {
        initialListing = pageResult.listing;
        initialIdentity = pageResult.identity;
      } else {
        extractionError =
          pageResult.error ||
          'Failed to extract product details from page';

        isBlocked = !!pageResult.blocked;
      }
    } catch (error) {
      extractionError =
        error.message ||
        'Network error fetching product page';
    }

    // 3. Handle extraction failure.
    if (!initialListing || !initialIdentity) {
      const durationMs = Date.now() - startTime;

      let suggestedQuery = null;

      try {
        const parsed = new URL(targetUrl);

        const pathSegments = parsed.pathname
          .split('/')
          .filter(Boolean);

        const slug = pathSegments.find(
          (segment) =>
            segment.length > 5 &&
            !/^[0-9]+$/.test(segment)
        );

        if (slug) {
          suggestedQuery = slug
            .replace(/[-_]/g, ' ')
            .replace(
              /\b(dp|p|itm|product|buy|online)\b/gi,
              ''
            )
            .replace(/\s+/g, ' ')
            .trim();
        }
      } catch (_error) {
        // Ignore slug parsing failures.
      }

      const failurePayload = {
        searchId,
        searchMode: 'PRODUCT_URL',
        url: targetUrl,
        retailer: validation.retailer,
        success: false,
        error: extractionError,
        isBlocked,
        suggestedQuery,

        diagnostics: {
          searchId,
          query: targetUrl,
          searchMode: 'PRODUCT_URL',
          durationMs,

          status: isBlocked
            ? 'BLOCKED_BOT_PROTECTION'
            : 'EXTRACTION_FAILED',

          providerErrors: [
            `${validation.retailer}: ${extractionError}`,
          ],
        },
      };

      cacheSearch(searchId, failurePayload);

      return failurePayload;
    }

    // 4. Generate product intelligence.
    const productIntelligence = generateProductIntelligence(
      initialListing,
      initialIdentity
    );

    // 5. Build cross-retailer query.
    const crossRetailerQuery = [
      initialIdentity.brand,
      initialIdentity.model,
      initialIdentity.category,
      initialIdentity.storage,
      initialIdentity.ram,
    ]
      .filter(Boolean)
      .join(' ');

    // 6. Run the same validated product-name pipeline.
    const crossResults = await this.searchByProductName(
      crossRetailerQuery
    );

    // 7. Preserve the user's supplied starting product.
    const originalListingEvaluated = {
      ...initialListing,

      isPastedStartingProduct: true,

      matchEvaluation: {
        status: MATCH_STATUS.EXACT_MATCH,
        confidence: 1.0,
        reason: 'User-provided starting product URL',
        candidateIdentity: initialIdentity,
      },
    };

    // 8. Merge only validated comparable offers.
    const combinedListings = deduplicateListings([
      originalListingEvaluated,
      ...crossResults.results.exactMatches,
      ...crossResults.results.highConfidenceMatches,
    ]);

    const evaluatedComparable = combinedListings.filter(
      (listing) =>
        listing.matchEvaluation &&
        (
          listing.matchEvaluation.status ===
            MATCH_STATUS.EXACT_MATCH ||
          listing.matchEvaluation.status ===
            MATCH_STATUS.HIGH_CONFIDENCE
        )
    );

    // 9. Compare prices.
    const comparison = comparePrices(
      initialIdentity,
      evaluatedComparable
    );

    const totalDurationMs = Date.now() - startTime;

    const exactMatchesList = evaluatedComparable.filter(
      (listing) => !listing.isPastedStartingProduct
    );

    // 10. Build response.
    const responsePayload = {
      searchId,
      searchMode: 'PRODUCT_URL',
      url: targetUrl,
      success: true,

      productIntelligence,

      startingProduct: originalListingEvaluated,

      targetIdentity: initialIdentity,

      comparison,

      results: {
        startingProduct: originalListingEvaluated,

        exactMatches: exactMatchesList,

        possibleMatches:
          crossResults.results.possibleMatches,

        rejectedListings:
          crossResults.results.rejectedListings,

        totalDiscovered:
          crossResults.results.totalDiscovered + 1,

        totalMatched: evaluatedComparable.length,

        totalRejected:
          crossResults.results.totalRejected,
      },

      diagnostics: {
        ...crossResults.diagnostics,

        searchId,
        query: targetUrl,
        searchMode: 'PRODUCT_URL',

        durationMs: totalDurationMs,

        originalUrl: targetUrl,

        identifiedRetailer: validation.retailer,

        extractedProductIdentity: initialIdentity,

        productInformationSources:
          productIntelligence
            ? productIntelligence.confidence
            : null,

        productDescriptionEvidence:
          productIntelligence
            ? productIntelligence.description
            : null,

        exactMatchesCount: exactMatchesList.length,

        possibleMatchesCount:
          crossResults.results.possibleMatches.length,

        rejectedListingsCount:
          crossResults.results.rejectedListings.length,
      },
    };

    cacheSearch(searchId, responsePayload);

    return responsePayload;
  }

  /**
   * Retrieve a previous search by ID.
   */
  getSearch(searchId) {
    return searchCache.get(searchId) || null;
  }
}

export const searchCoordinator = new SearchCoordinator();
