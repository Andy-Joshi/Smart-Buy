import { parseProductIdentity } from './normalizer.js';
import { isConsumableProduct, extractQuantity } from '../queryUnderstanding.js';

export const MATCH_STATUS = {
  EXACT_MATCH: 'EXACT_MATCH',
  HIGH_CONFIDENCE: 'HIGH_CONFIDENCE',
  POSSIBLE_MATCH: 'POSSIBLE_MATCH',
  REJECTED: 'REJECTED',
};

/**
 * Tokenize string into meaningful alphanumeric tokens.
 */
function tokenize(str) {
  if (!str) return new Set();
  const tokens = str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return new Set(tokens);
}

/**
 * Calculate Jaccard similarity between two token sets.
 */
function tokenSimilarity(tokensA, tokensB) {
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Compares a candidate product against the target product identity.
 * Returns match status, confidence score (0-1), and an explanatory rejection/matching reason.
 *
 * @param {Object} targetIdentity - Structured identity of target product.
 * @param {Object|string} candidate - Candidate product object or title string.
 * @returns {{ status: string, confidence: number, reason: string, candidateIdentity: Object }}
 */
export function evaluateProductMatch(targetIdentity, candidate) {
  const candidateRawTitle = typeof candidate === 'string' ? candidate : candidate.title || '';
  const candidateIdentity = parseProductIdentity(candidateRawTitle);

  // 1. Accessory check
  if (!targetIdentity.isAccessory && candidateIdentity.isAccessory) {
    return {
      status: MATCH_STATUS.REJECTED,
      confidence: 0,
      reason: 'Rejected: Listing is an accessory (case, cover, or part) rather than the primary device',
      candidateIdentity,
    };
  }

  // 2. Brand check (if both specify brand, they must match)
  if (targetIdentity.brand && candidateIdentity.brand) {
    if (targetIdentity.brand.toLowerCase() !== candidateIdentity.brand.toLowerCase()) {
      return {
        status: MATCH_STATUS.REJECTED,
        confidence: 0,
        reason: `Rejected: Brand mismatch (expected ${targetIdentity.brand}, got ${candidateIdentity.brand})`,
        candidateIdentity,
      };
    }
  }

  // 3. Generation check (prioritized: e.g. M4 vs M2, 13th Gen vs 14th Gen)
  if (targetIdentity.generation && candidateIdentity.generation) {
    if (targetIdentity.generation !== candidateIdentity.generation) {
      return {
        status: MATCH_STATUS.REJECTED,
        confidence: 0.15,
        reason: `Rejected: Generation mismatch (expected ${targetIdentity.generation}, found ${candidateIdentity.generation})`,
        candidateIdentity,
      };
    }
  }

  // 4. Model check
  if (targetIdentity.model && candidateIdentity.model) {
    const tModel = targetIdentity.model.toUpperCase();
    const cModel = candidateIdentity.model.toUpperCase();

    if (tModel !== cModel) {
      // Check if one is a strict superset or equivalent, otherwise reject
      // e.g. WH-CH720N vs WH-CH520
      return {
        status: MATCH_STATUS.REJECTED,
        confidence: 0.1,
        reason: `Rejected: Model mismatch (expected ${targetIdentity.model}, found ${candidateIdentity.model})`,
        candidateIdentity,
      };
    }
  } else if (targetIdentity.model && !candidateIdentity.model) {
    // If target has an explicit model code (e.g. WH-CH720N), candidate must mention it
    const tModel = targetIdentity.model.toUpperCase();
    const candidateUpper = candidateRawTitle.toUpperCase();
    if (!candidateUpper.includes(tModel)) {
      return {
        status: MATCH_STATUS.REJECTED,
        confidence: 0.2,
        reason: `Rejected: Missing target model code "${targetIdentity.model}" in title`,
        candidateIdentity,
      };
    }
  }

  // 5. Storage variant check
  if (targetIdentity.storage && candidateIdentity.storage) {
    if (targetIdentity.storage !== candidateIdentity.storage) {
      return {
        status: MATCH_STATUS.REJECTED,
        confidence: 0.15,
        reason: `Rejected: Storage variant mismatch (expected ${targetIdentity.storage}, found ${candidateIdentity.storage})`,
        candidateIdentity,
      };
    }
  }

  // 6. RAM variant check
  if (targetIdentity.ram && candidateIdentity.ram) {
    if (targetIdentity.ram !== candidateIdentity.ram) {
      return {
        status: MATCH_STATUS.REJECTED,
        confidence: 0.15,
        reason: `Rejected: RAM variant mismatch (expected ${targetIdentity.ram}, found ${candidateIdentity.ram})`,
        candidateIdentity,
      };
    }
  }

  // 7. Determine what strong identifiers are available
  const targetHasModel = !!targetIdentity.model;
  const targetHasBrand = !!targetIdentity.brand;
  const candidateHasModel = !!candidateIdentity.model;
  const candidateHasBrand = !!candidateIdentity.brand;

  // Check for consumable products (food, personal care etc.)
  const targetIsConsumable = isConsumableProduct(targetIdentity.cleanTitle);

  // For consumables: extract quantities to compare
  const targetQty = extractQuantity(targetIdentity.cleanTitle);
  const candidateQty = extractQuantity(candidateIdentity.cleanTitle);

  // 8. Token similarity calculation
  const targetTokens = tokenize(targetIdentity.cleanTitle);
  const candidateTokens = tokenize(candidateIdentity.cleanTitle);
  const similarity = tokenSimilarity(targetTokens, candidateTokens);

  // Scoring logic — start from token similarity
  let score = similarity;

  // Boost for exact model match (requires both sides to have a model)
  const hasExactModelMatch =
    targetHasModel && candidateHasModel && targetIdentity.model === candidateIdentity.model;

  if (hasExactModelMatch) {
    score = Math.max(score, 0.85);
  }

  // Boost if storage and RAM also match
  if (targetIdentity.storage && candidateIdentity.storage === targetIdentity.storage) {
    score += 0.1;
  }
  if (targetIdentity.ram && candidateIdentity.ram === targetIdentity.ram) {
    score += 0.05;
  }
  if (targetIdentity.generation && candidateIdentity.generation === targetIdentity.generation) {
    score += 0.05;
  }

  score = Math.min(1.0, Math.round(score * 100) / 100);

  // -------------------------------------------------------------------------
  // Evidence-based caps: prevent awarding EXACT_MATCH without strong proof
  // -------------------------------------------------------------------------

  // Rule A: Both sides missing brand AND model → cap at POSSIBLE_MATCH (0.64 max)
  const bothLackIdentifiers = !targetHasBrand && !targetHasModel && !candidateHasBrand && !candidateHasModel;
  if (bothLackIdentifiers) {
    score = Math.min(score, 0.64);
  }

  // Rule B: Consumable product — require brand match for HIGH_CONFIDENCE or above
  if (targetIsConsumable) {
    const brandMatches = targetHasBrand && candidateHasBrand &&
      targetIdentity.brand.toLowerCase() === candidateIdentity.brand.toLowerCase();
    const qtyMatches = targetQty && candidateQty && targetQty === candidateQty;

    if (!brandMatches) {
      // Without brand match, consumables can only be POSSIBLE_MATCH at best
      score = Math.min(score, 0.64);
    } else if (!qtyMatches && targetQty) {
      // Brand matches but quantities differ → HIGH_CONFIDENCE at most
      score = Math.min(score, 0.74);
    }
    // If brand + quantity both match → allow HIGH_CONFIDENCE (0.65-0.74) max
    // (never EXACT_MATCH for consumables unless we have a true product code)
    if (!hasExactModelMatch) {
      score = Math.min(score, 0.74);
    }
  }

  // Rule C: If target has an explicit model but score hit 0.85+ only via token similarity
  // (i.e., no actual model-to-model comparison succeeded), cap at HIGH_CONFIDENCE
  if (!hasExactModelMatch && targetHasModel && score >= 0.85) {
    score = 0.74;
  }

  // Rule D: Require at least one strong identifier to reach EXACT_MATCH
  //   Strong identifiers: model, brand+storage, brand+ram, brand+generation
  const hasStrongEvidence =
    hasExactModelMatch ||
    (targetHasBrand && candidateHasBrand &&
      targetIdentity.storage && candidateIdentity.storage === targetIdentity.storage) ||
    (targetHasBrand && candidateHasBrand &&
      targetIdentity.ram && candidateIdentity.ram === targetIdentity.ram) ||
    (targetHasBrand && candidateHasBrand &&
      targetIdentity.generation && candidateIdentity.generation === targetIdentity.generation);

  if (!hasStrongEvidence && score >= 0.85) {
    // Downgrade to HIGH_CONFIDENCE — token similarity alone is not enough
    score = 0.74;
  }

  // Confidence thresholds
  if (score >= 0.85) {
    return {
      status: MATCH_STATUS.EXACT_MATCH,
      confidence: score,
      reason: 'Exact model and variant specification match',
      candidateIdentity,
    };
  } else if (score >= 0.65) {
    return {
      status: MATCH_STATUS.HIGH_CONFIDENCE,
      confidence: score,
      reason: 'High confidence match with compatible hardware specs',
      candidateIdentity,
    };
  } else if (score >= 0.40) {
    return {
      status: MATCH_STATUS.POSSIBLE_MATCH,
      confidence: score,
      reason: 'Possible match: brand and core keywords match, but some variant details are unspecified',
      candidateIdentity,
    };
  } else {
    return {
      status: MATCH_STATUS.REJECTED,
      confidence: score,
      reason: 'Rejected: Low title similarity and missing key identifiers',
      candidateIdentity,
    };
  }
}

/**
 * Deduplicate listings across retailers or multiple results from same retailer.
 * Retains higher-quality verified listings and removes exact URL or title dupes.
 *
 * @param {Array<Object>} listings
 * @returns {Array<Object>} deduplicated listings
 */
export function deduplicateListings(listings) {
  const statusWeight = {
    VERIFIED_PAGE: 3,
    VERIFIED_API: 2,
    UNVERIFIED_SNIPPET: 1,
  };

  const results = [];
  const urlMap = new Map();
  const retailerKeyMap = new Map();

  for (const item of listings) {
    if (!item || !item.url) continue;

    // Normalize URL (strip tracking params)
    let cleanUrl;
    try {
      const u = new URL(item.url);
      cleanUrl = `${u.origin}${u.pathname}`;
    } catch (_e) {
      cleanUrl = item.url;
    }

    const currentWeight = statusWeight[item.verificationStatus] || 0;
    const existingByUrl = urlMap.get(cleanUrl);

    if (existingByUrl) {
      const existingWeight = statusWeight[existingByUrl.verificationStatus] || 0;
      if (currentWeight > existingWeight) {
        // Upgrade existing listing
        const idx = results.indexOf(existingByUrl);
        if (idx !== -1) results[idx] = item;
        urlMap.set(cleanUrl, item);
      }
      continue;
    }

    // Key by retailer + clean title
    const retailerKey = `${item.retailer || 'Unknown'}_${(item.title || '').slice(0, 40).toLowerCase()}`;
    const existingByKey = retailerKeyMap.get(retailerKey);

    if (existingByKey) {
      const existingWeight = statusWeight[existingByKey.verificationStatus] || 0;
      if (currentWeight > existingWeight) {
        const idx = results.indexOf(existingByKey);
        if (idx !== -1) results[idx] = item;
        retailerKeyMap.set(retailerKey, item);
      }
      continue;
    }

    urlMap.set(cleanUrl, item);
    retailerKeyMap.set(retailerKey, item);
    results.push(item);
  }

  return results;
}
