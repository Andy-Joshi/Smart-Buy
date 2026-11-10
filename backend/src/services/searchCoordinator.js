import crypto from 'node:crypto';
import { providerRegistry } from './providers/providerRegistry.js';
import { parseProductIdentity } from './matching/normalizer.js';
import { parseQueryIdentity } from './queryUnderstanding.js';
import { evaluateProductMatch, deduplicateListings, MATCH_STATUS } from './matching/matcher.js';
import { comparePrices } from './comparison/comparisonEngine.js';
import { validateSafeUrl } from './security/safeUrlValidator.js';
import { fetchAndExtractProduct } from './extraction/index.js';
import { createProductListing, VERIFICATION_STATUS } from './extraction/baseExtractor.js';
import { generateProductIntelligence } from './productIntelligence.js';

// In-memory diagnostics store (last 100 searches)
const searchCache = new Map();

export class SearchCoordinator {
  /**
   * Mode A: Search by Product Name
   */
  async searchByProductName(query) {
    const searchId = `sbl_${crypto.randomBytes(6).toString('hex')}`;
    const startTime = Date.now();

    // 1. Query Understanding — structured identity + search aliases
    const queryIdentity = parseQueryIdentity(query);

    // Also build the classic product identity used by the matcher
    const targetIdentity = parseProductIdentity(query);

    // 2. Multi-query discovery across all providers
    const { allListings: rawListings, providerStats, queriesDispatched } =
      await providerRegistry.executeSearchMultiQuery(queryIdentity, { maxAliases: 3 });

    // 3. Perform deep extraction on up to 3 candidate URLs to upgrade snippet prices
    let deepPagesAttempted = 0;
    let deepPagesSucceeded = 0;

    for (const listing of rawListings) {
      if (listing.verificationStatus === VERIFICATION_STATUS.UNVERIFIED_SNIPPET && listing.url && !listing.price) {
        if (deepPagesAttempted >= 2) break; // Keep search fast
        // Only deep-fetch accessible retailers
        if (listing.retailer === 'Croma' || listing.retailer === 'Flipkart') {
          deepPagesAttempted++;
          try {
            const pageRes = await fetchAndExtractProduct(listing.url, { timeoutMs: 3000 });
            if (pageRes.success && pageRes.listing && pageRes.listing.price) {
              listing.price = pageRes.listing.price;
              listing.originalPrice = pageRes.listing.originalPrice || listing.originalPrice;
              listing.availability = pageRes.listing.availability;
              listing.verificationStatus = VERIFICATION_STATUS.VERIFIED_PAGE;
              listing.extractionNotes = pageRes.listing.extractionNotes;
              if (pageRes.listing.title) listing.title = pageRes.listing.title;
              if (pageRes.listing.brand) listing.brand = pageRes.listing.brand;
              if (pageRes.listing.model) listing.model = pageRes.listing.model;
              if (pageRes.listing.image) listing.image = pageRes.listing.image;
              if (pageRes.listing.seller) listing.seller = pageRes.listing.seller;
              if (pageRes.listing.specifications) listing.specifications = pageRes.listing.specifications;
              deepPagesSucceeded++;
            }
          } catch (_e) {
            // Keep original snippet if deep fetch fails
          }
        }
      }
    }

    // 4. Deduplicate listings (multi-query produces duplicates)
    const deduplicated = deduplicateListings(rawListings);
    const duplicatesRemoved = rawListings.length - deduplicated.length;

    // 5. Product Matching Engine
    const evaluatedListings = deduplicated.map((item) => {
      const evaluation = evaluateProductMatch(targetIdentity, item);
      return {
        ...item,
        matchEvaluation: evaluation,
      };
    });

    const exactMatches = evaluatedListings.filter(
      (l) => l.matchEvaluation.status === MATCH_STATUS.EXACT_MATCH
    );
    const highConfidenceMatches = evaluatedListings.filter(
      (l) => l.matchEvaluation.status === MATCH_STATUS.HIGH_CONFIDENCE
    );
    const possibleMatches = evaluatedListings.filter(
      (l) => l.matchEvaluation.status === MATCH_STATUS.POSSIBLE_MATCH
    );
    const rejectedListings = evaluatedListings.filter(
      (l) => l.matchEvaluation.status === MATCH_STATUS.REJECTED
    );

    const validComparable = [...exactMatches, ...highConfidenceMatches];

    // 6. Price Comparison
    const comparison = comparePrices(targetIdentity, validComparable);

    const baseListing = createProductListing({
      title: targetIdentity.cleanTitle,
      brand: targetIdentity.brand,
      model: targetIdentity.model,
      variant: targetIdentity.storage || targetIdentity.ram || null,
      source: 'query-understanding',
    });
    const productIntelligence = generateProductIntelligence(baseListing, targetIdentity);

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    // 7. Diagnostics
    const successfulProviders = providerStats.filter((p) => p.status === 'Working' || p.resultsCount > 0);
    const failedProviders = providerStats.filter((p) => p.status !== 'Working' && p.resultsCount === 0);
    const retailersQueried = [...new Set(rawListings.map((l) => l.retailer).filter(Boolean))];
    const validPricesExtracted = deduplicated.filter((l) => l.price !== null && l.price > 0).length;

    const diagnostics = {
      searchId,
      query,
      searchMode: 'PRODUCT_NAME',
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      durationMs,
      // V2 additions
      normalizedIdentity: {
        brand: queryIdentity.brand,
        model: queryIdentity.model,
        category: queryIdentity.category,
        isConsumable: queryIdentity.isConsumable,
        quantity: queryIdentity.quantity,
      },
      queriesGenerated: queriesDispatched,
      providersAttempted: providerStats,
      retailersQueried,
      successfulProviders: successfulProviders.map((p) => p.name),
      failedProviders: failedProviders.map((p) => ({ name: p.name, error: p.error })),
      listingsDiscovered: rawListings.length,
      productPagesExtracted: deepPagesSucceeded,
      validPricesExtracted,
      duplicatesRemoved,
      variantMismatchesRejected: rejectedListings.length,
      providerErrors: failedProviders.filter((p) => p.error).map((p) => `${p.name}: ${p.error}`),
    };

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

    searchCache.set(searchId, responsePayload);
    // Keep cache bounded
    if (searchCache.size > 100) {
      const oldestKey = searchCache.keys().next().value;
      searchCache.delete(oldestKey);
    }

    return responsePayload;
  }

  /**
   * Mode B: Paste Product URL
   */
  async searchByProductUrl(rawUrl) {
    const searchId = `sbl_${crypto.randomBytes(6).toString('hex')}`;
    const startTime = Date.now();

    // 1. SSRF & Safe URL validation
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
      searchCache.set(searchId, errorPayload);
      return errorPayload;
    }

    const targetUrl = rawUrl.trim();
    let initialListing = null;
    let initialIdentity = null;
    let extractionError = null;
    let isBlocked = false;

    // 2. Fetch and extract starting product
    try {
      const pageResult = await fetchAndExtractProduct(targetUrl, { timeoutMs: 8000 });
      if (pageResult.success && pageResult.listing) {
        initialListing = pageResult.listing;
        initialIdentity = pageResult.identity;
      } else {
        extractionError = pageResult.error || 'Failed to extract product details from page';
        isBlocked = !!pageResult.blocked;
      }
    } catch (err) {
      extractionError = err.message || 'Network error fetching product page';
    }

    // If starting product extraction failed, recover from URL slug:
    if (!initialListing) {
      // Deduce suggested search query from URL slug
      let suggestedQuery = null;
      try {
        const parsed = new URL(targetUrl);
        const pathSegments = parsed.pathname.split('/').filter(Boolean);
        // Find longest slug segment
        const slug = pathSegments.find((s) => s.length > 5 && !s.match(/^[0-9]+$/));
        if (slug) {
          suggestedQuery = slug
            .replace(/[-_]/g, ' ')
            .replace(/\b(dp|p|itm|product|buy|online)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        }
      } catch (_e) {
        // Ignore slug parsing error
      }

      if (suggestedQuery && suggestedQuery.length > 3) {
        initialIdentity = parseProductIdentity(suggestedQuery);
        // Build search query from extracted brand, model, storage or slug
        const crossRetailerQuery = `${initialIdentity.brand || ''} ${initialIdentity.model || suggestedQuery} ${initialIdentity.storage || ''}`.trim();
        const crossResults = await this.searchByProductName(crossRetailerQuery);

        // Find if any match from the target retailer already exists in discovery
        const retailerMatch = [...crossResults.results.exactMatches, ...crossResults.results.highConfidenceMatches]
          .find((l) => (l.retailer || '').toLowerCase() === (validation.retailer || '').toLowerCase());

        initialListing = createProductListing({
          title: retailerMatch?.title || initialIdentity.cleanTitle || suggestedQuery,
          brand: initialIdentity.brand || retailerMatch?.brand || null,
          model: initialIdentity.model || retailerMatch?.model || null,
          variant: initialIdentity.storage || initialIdentity.ram || retailerMatch?.variant || null,
          price: retailerMatch?.price || crossResults.comparison?.lowestOverallPrice || null,
          originalPrice: retailerMatch?.originalPrice || null,
          currency: 'INR',
          retailer: validation.retailer,
          url: targetUrl,
          verificationStatus: retailerMatch ? retailerMatch.verificationStatus : VERIFICATION_STATUS.UNVERIFIED_SNIPPET,
          source: `${(validation.retailer || 'direct').toLowerCase()}-url-recovery`,
          extractionNotes: retailerMatch
            ? `Extracted via multi-retailer discovery for ${validation.retailer}`
            : `Identified product from URL slug (${suggestedQuery})`,
        });

        const productIntelligence = generateProductIntelligence(initialListing, initialIdentity);
        const originalListingEvaluated = {
          ...initialListing,
          isPastedStartingProduct: true,
          matchEvaluation: {
            status: MATCH_STATUS.EXACT_MATCH,
            confidence: 1.0,
            reason: 'User-provided starting product URL',
          },
        };

        const combinedListings = deduplicateListings([
          originalListingEvaluated,
          ...crossResults.results.exactMatches,
          ...crossResults.results.highConfidenceMatches,
        ]);

        const evaluatedComparable = combinedListings.filter(
          (l) =>
            l.matchEvaluation &&
            (l.matchEvaluation.status === MATCH_STATUS.EXACT_MATCH ||
              l.matchEvaluation.status === MATCH_STATUS.HIGH_CONFIDENCE)
        );

        const comparison = comparePrices(initialIdentity, evaluatedComparable);
        const totalDurationMs = Date.now() - startTime;
        const exactMatchesList = evaluatedComparable.filter((l) => !l.isPastedStartingProduct);

        const recoveryPayload = {
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
            possibleMatches: crossResults.results.possibleMatches,
            rejectedListings: crossResults.results.rejectedListings,
            totalDiscovered: crossResults.results.totalDiscovered + 1,
            totalMatched: evaluatedComparable.length,
            totalRejected: crossResults.results.totalRejected,
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
            productInformationSources: productIntelligence ? productIntelligence.confidence : null,
            productDescriptionEvidence: productIntelligence ? productIntelligence.description : null,
          },
        };
        searchCache.set(searchId, recoveryPayload);
        return recoveryPayload;
      }

      const durationMs = Date.now() - startTime;
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
          status: isBlocked ? 'BLOCKED_BOT_PROTECTION' : 'EXTRACTION_FAILED',
          providerErrors: [`${validation.retailer}: ${extractionError}`],
        },
      };
      searchCache.set(searchId, failurePayload);
      return failurePayload;
    }

    // 3. Extracted starting product successfully → Product Intelligence & Cross-retailer search
    const productIntelligence = generateProductIntelligence(initialListing, initialIdentity);

    // Build a QueryIdentity from the extracted product so Mode B uses identical discovery
    const crossRetailerQuery = `${initialIdentity.brand || ''} ${initialIdentity.model || initialListing.title} ${initialIdentity.storage || ''}`.trim();

    // Run Mode A search using the extracted identity — same pipeline as Mode A
    const crossResults = await this.searchByProductName(crossRetailerQuery);

    // Merge original pasted listing as the baseline offer
    const originalListingEvaluated = {
      ...initialListing,
      isPastedStartingProduct: true,
      matchEvaluation: {
        status: MATCH_STATUS.EXACT_MATCH,
        confidence: 1.0,
        reason: 'User-provided starting product URL',
      },
    };

    // Combine original listing with alternative retailer offers (deduplicating against original)
    const combinedListings = deduplicateListings([originalListingEvaluated, ...crossResults.results.exactMatches, ...crossResults.results.highConfidenceMatches]);

    const evaluatedComparable = combinedListings.filter(
      (l) =>
        l.matchEvaluation &&
        (l.matchEvaluation.status === MATCH_STATUS.EXACT_MATCH ||
          l.matchEvaluation.status === MATCH_STATUS.HIGH_CONFIDENCE)
    );

    const comparison = comparePrices(initialIdentity, evaluatedComparable);

    const totalDurationMs = Date.now() - startTime;

    const exactMatchesList = evaluatedComparable.filter((l) => !l.isPastedStartingProduct);

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
        possibleMatches: crossResults.results.possibleMatches,
        rejectedListings: crossResults.results.rejectedListings,
        totalDiscovered: crossResults.results.totalDiscovered + 1,
        totalMatched: evaluatedComparable.length,
        totalRejected: crossResults.results.totalRejected,
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
        productInformationSources: productIntelligence ? productIntelligence.confidence : null,
        productDescriptionEvidence: productIntelligence ? productIntelligence.description : null,
        exactMatchesCount: exactMatchesList.length,
        possibleMatchesCount: crossResults.results.possibleMatches.length,
        rejectedListingsCount: crossResults.results.rejectedListings.length,
      },
    };

    searchCache.set(searchId, responsePayload);
    return responsePayload;
  }

  getSearch(searchId) {
    return searchCache.get(searchId) || null;
  }
}

export const searchCoordinator = new SearchCoordinator();
