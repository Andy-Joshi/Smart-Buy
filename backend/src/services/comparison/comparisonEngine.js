import { VERIFICATION_STATUS } from '../extraction/baseExtractor.js';
import { MATCH_STATUS } from '../matching/matcher.js';

/**
 * Price Comparison Engine
 * Computes price differences, lowest verified price, and savings exclusively
 * across adequately matched products.
 */
export function comparePrices(targetIdentity, evaluatedListings = []) {
  // Only compare listings with EXACT_MATCH or HIGH_CONFIDENCE
  const comparableListings = evaluatedListings.filter(
    (item) =>
      item.matchEvaluation &&
      (item.matchEvaluation.status === MATCH_STATUS.EXACT_MATCH ||
        item.matchEvaluation.status === MATCH_STATUS.HIGH_CONFIDENCE) &&
      item.price &&
      item.price > 0
  );

  if (comparableListings.length === 0) {
    return {
      hasComparableOffers: false,
      totalComparable: 0,
      lowestVerifiedPrice: null,
      lowestOverallPrice: null,
      highestComparablePrice: null,
      potentialSavings: null,
      savingsPercentage: null,
      bestOffer: null,
      comparedOffers: [],
    };
  }

  // Find lowest verified price (from product page or authorized API)
  const verifiedListings = comparableListings.filter(
    (item) =>
      item.verificationStatus === VERIFICATION_STATUS.VERIFIED_PAGE ||
      item.verificationStatus === VERIFICATION_STATUS.VERIFIED_API
  );

  let lowestVerifiedPrice = null;
  if (verifiedListings.length > 0) {
    lowestVerifiedPrice = Math.min(...verifiedListings.map((l) => l.price));
  }

  const lowestOverallPrice = Math.min(...comparableListings.map((l) => l.price));
  const highestComparablePrice = Math.max(...comparableListings.map((l) => l.price));
  const potentialSavings = Math.max(0, Math.round((highestComparablePrice - lowestOverallPrice) * 100) / 100);
  const savingsPercentage =
    highestComparablePrice > 0
      ? Math.round((potentialSavings / highestComparablePrice) * 1000) / 10
      : 0;

  // Best offer: prefer lowest verified price; fallback to lowest overall
  let bestOffer = null;
  if (verifiedListings.length > 0) {
    bestOffer = verifiedListings.find((l) => l.price === lowestVerifiedPrice);
  } else {
    bestOffer = comparableListings.find((l) => l.price === lowestOverallPrice);
  }

  // Calculate price delta for each offer
  const referencePrice = lowestVerifiedPrice || lowestOverallPrice;
  const comparedOffers = comparableListings
    .map((item) => {
      const priceDelta = Math.round((item.price - referencePrice) * 100) / 100;
      const totalKnownPrice =
        item.shippingCharge !== null && item.shippingCharge !== undefined
          ? Math.round((item.price + item.shippingCharge) * 100) / 100
          : item.price;

      return {
        ...item,
        isLowestOffer: bestOffer && bestOffer.url === item.url,
        priceDifference: priceDelta,
        totalKnownPrice,
        shippingKnown: item.shippingCharge !== null && item.shippingCharge !== undefined,
      };
    })
    .sort((a, b) => a.price - b.price);

  return {
    hasComparableOffers: true,
    totalComparable: comparableListings.length,
    lowestVerifiedPrice,
    lowestOverallPrice,
    highestComparablePrice,
    potentialSavings,
    savingsPercentage,
    bestOffer,
    comparedOffers,
  };
}
