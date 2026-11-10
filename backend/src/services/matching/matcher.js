
import { parseProductIdentity } from './normalizer.js';
import { isConsumableProduct, extractQuantity } from '../queryUnderstanding.js';

export const MATCH_STATUS = {
  EXACT_MATCH: 'EXACT_MATCH',
  HIGH_CONFIDENCE: 'HIGH_CONFIDENCE',
  POSSIBLE_MATCH: 'POSSIBLE_MATCH',
  REJECTED: 'REJECTED',
};

const CATEGORY_EQUIVALENTS = {
  'wireless earbuds': ['wireless earbuds', 'earbuds'],
  headphones: ['headphones', 'headphone'],
  earphones: ['earphones', 'earphone'],
  'neckband earphones': ['neckband earphones', 'neckband'],
  speaker: ['speaker', 'speakers'],
  laptop: ['laptop', 'notebook'],
  smartphone: ['smartphone', 'mobile phone'],
  tablet: ['tablet'],
  mouse: ['mouse'],
  keyboard: ['keyboard'],
  monitor: ['monitor'],
  'cooking oil': ['cooking oil'],
  flour: ['flour'],
  rice: ['rice'],
  'personal care': ['personal care'],
};

function normalizeCategory(category) {
  if (!category) return null;

  const normalized = category.toLowerCase().trim();

  for (const [canonical, aliases] of Object.entries(CATEGORY_EQUIVALENTS)) {
    if (aliases.includes(normalized)) return canonical;
  }

  return normalized;
}

function tokenize(str) {
  if (!str) return new Set();

  return new Set(
    str.toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1)
  );
}

function tokenSimilarity(tokensA, tokensB) {
  if (!tokensA.size || !tokensB.size) return 0;

  let intersection = 0;

  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;

  return union ? intersection / union : 0;
}

function rejected(reason, candidateIdentity, confidence = 0) {
  return {
    status: MATCH_STATUS.REJECTED,
    confidence,
    reason,
    candidateIdentity,
  };
}

/**
 * Compare a discovered product against the requested product.
 */
export function evaluateProductMatch(targetIdentity, candidate) {
  const candidateRawTitle =
    typeof candidate === 'string'
      ? candidate
      : candidate?.title || '';

  const candidateIdentity = parseProductIdentity(candidateRawTitle);

  if (!targetIdentity || !candidateRawTitle) {
    return rejected(
      'Rejected: Missing target or candidate product information',
      candidateIdentity
    );
  }

  const targetCategory = normalizeCategory(targetIdentity.category);
  const candidateCategory = normalizeCategory(candidateIdentity.category);

  // 1. Accessory validation.
  if (!targetIdentity.isAccessory && candidateIdentity.isAccessory) {
    return rejected(
      'Rejected: Candidate is an accessory rather than the primary product',
      candidateIdentity
    );
  }

  // 2. Strict category validation.
  if (targetCategory && candidateCategory) {
    if (targetCategory !== candidateCategory) {
      return rejected(
        `Rejected: Category mismatch (expected ${targetCategory}, found ${candidateCategory})`,
        candidateIdentity
      );
    }
  }

  // 3. Brand validation.
  if (targetIdentity.brand && candidateIdentity.brand) {
    if (
      targetIdentity.brand.toLowerCase() !==
      candidateIdentity.brand.toLowerCase()
    ) {
      return rejected(
        `Rejected: Brand mismatch (expected ${targetIdentity.brand}, found ${candidateIdentity.brand})`,
        candidateIdentity
      );
    }
  }

  // 4. Generation validation.
  if (targetIdentity.generation && candidateIdentity.generation) {
    if (
      targetIdentity.generation.toLowerCase() !==
      candidateIdentity.generation.toLowerCase()
    ) {
      return rejected(
        `Rejected: Generation mismatch (expected ${targetIdentity.generation}, found ${candidateIdentity.generation})`,
        candidateIdentity
      );
    }
  }

  // 5. Model validation.
  if (targetIdentity.model) {
    if (!candidateIdentity.model) {
      return rejected(
        `Rejected: Candidate does not identify the requested model "${targetIdentity.model}"`,
        candidateIdentity
      );
    }

    if (
      targetIdentity.model.toUpperCase() !==
      candidateIdentity.model.toUpperCase()
    ) {
      return rejected(
        `Rejected: Model mismatch (expected ${targetIdentity.model}, found ${candidateIdentity.model})`,
        candidateIdentity
      );
    }
  }

  // 6. Storage validation.
  if (targetIdentity.storage && candidateIdentity.storage) {
    if (targetIdentity.storage !== candidateIdentity.storage) {
      return rejected(
        `Rejected: Storage mismatch (expected ${targetIdentity.storage}, found ${candidateIdentity.storage})`,
        candidateIdentity
      );
    }
  }

  // 7. RAM validation.
  if (targetIdentity.ram && candidateIdentity.ram) {
    if (targetIdentity.ram !== candidateIdentity.ram) {
      return rejected(
        `Rejected: RAM mismatch (expected ${targetIdentity.ram}, found ${candidateIdentity.ram})`,
        candidateIdentity
      );
    }
  }

  // 8. Consumable quantity validation.
  const targetIsConsumable = isConsumableProduct(
    targetIdentity.cleanTitle
  );

  const targetQty = extractQuantity(targetIdentity.cleanTitle);
  const candidateQty = extractQuantity(candidateIdentity.cleanTitle);

  if (targetIsConsumable && targetQty && candidateQty) {
    if (targetQty !== candidateQty) {
      return rejected(
        `Rejected: Quantity mismatch (expected ${targetQty}, found ${candidateQty})`,
        candidateIdentity
      );
    }
  }

  // 9. Calculate title similarity.
  const targetTokens = tokenize(targetIdentity.cleanTitle);
  const candidateTokens = tokenize(candidateIdentity.cleanTitle);

  let score = tokenSimilarity(targetTokens, candidateTokens);

  const hasExactModelMatch =
    !!targetIdentity.model &&
    !!candidateIdentity.model &&
    targetIdentity.model.toUpperCase() ===
      candidateIdentity.model.toUpperCase();

  const hasBrandMatch =
    !!targetIdentity.brand &&
    !!candidateIdentity.brand &&
    targetIdentity.brand.toLowerCase() ===
      candidateIdentity.brand.toLowerCase();

  const hasCategoryMatch =
    !!targetCategory &&
    !!candidateCategory &&
    targetCategory === candidateCategory;

  // Evidence-based scoring.
  if (hasExactModelMatch) {
    score = Math.max(score, 0.90);
  }

  if (hasBrandMatch && hasCategoryMatch) {
    score += 0.08;
  }

  if (
    targetIdentity.storage &&
    candidateIdentity.storage === targetIdentity.storage
  ) {
    score += 0.04;
  }

  if (
    targetIdentity.ram &&
    candidateIdentity.ram === targetIdentity.ram
  ) {
    score += 0.03;
  }

  if (
    targetIdentity.generation &&
    candidateIdentity.generation === targetIdentity.generation
  ) {
    score += 0.03;
  }

  score = Math.min(1, Math.round(score * 100) / 100);

  // 10. Evidence-based confidence caps.

  // Missing category evidence cannot reach comparable status.
  if (targetCategory && !candidateCategory) {
    score = Math.min(score, 0.64);
  }

  // Missing brand evidence cannot reach comparable status.
  if (targetIdentity.brand && !candidateIdentity.brand) {
    score = Math.min(score, 0.64);
  }

  // Consumables require brand and quantity evidence.
  if (targetIsConsumable) {
    if (!hasBrandMatch) {
      score = Math.min(score, 0.64);
    }

    if (targetQty && !candidateQty) {
      score = Math.min(score, 0.64);
    }

    if (!hasExactModelMatch) {
      score = Math.min(score, 0.74);
    }
  }

  // A model-less candidate cannot become an exact match
  // when the target has an explicit model.
  if (targetIdentity.model && !hasExactModelMatch) {
    score = Math.min(score, 0.74);
  }

  // Exact matches require strong identifying evidence.
  const hasStrongEvidence =
    hasExactModelMatch ||
    (
      hasBrandMatch &&
      hasCategoryMatch &&
      (
        (
          targetIdentity.storage &&
          candidateIdentity.storage === targetIdentity.storage
        ) ||
        (
          targetIdentity.ram &&
          candidateIdentity.ram === targetIdentity.ram
        ) ||
        (
          targetIdentity.generation &&
          candidateIdentity.generation === targetIdentity.generation
        )
      )
    );

  if (!hasStrongEvidence) {
    score = Math.min(score, 0.74);
  }

  // 11. Final classification.
  if (score >= 0.85 && hasStrongEvidence) {
    return {
      status: MATCH_STATUS.EXACT_MATCH,
      confidence: score,
      reason: 'Exact model match with compatible product identity',
      candidateIdentity,
    };
  }

  if (score >= 0.65) {
    return {
      status: MATCH_STATUS.HIGH_CONFIDENCE,
      confidence: score,
      reason: 'High confidence match with compatible product identity',
      candidateIdentity,
    };
  }

  if (score >= 0.40) {
    return {
      status: MATCH_STATUS.POSSIBLE_MATCH,
      confidence: score,
      reason: 'Possible match; insufficient evidence for price comparison',
      candidateIdentity,
    };
  }

  return rejected(
    'Rejected: Insufficient product identity and title similarity',
    candidateIdentity,
    score
  );
}

/**
 * Deduplicate listings across retailers and search providers.
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

    let cleanUrl;

    try {
      const url = new URL(item.url);
      cleanUrl = `${url.origin}${url.pathname}`;
    } catch {
      cleanUrl = item.url;
    }

    const currentWeight =
      statusWeight[item.verificationStatus] || 0;

    const existingByUrl = urlMap.get(cleanUrl);

    if (existingByUrl) {
      const existingWeight =
        statusWeight[existingByUrl.verificationStatus] || 0;

      if (currentWeight > existingWeight) {
        const index = results.indexOf(existingByUrl);

        if (index !== -1) results[index] = item;

        urlMap.set(cleanUrl, item);
      }

      continue;
    }

    const retailerKey =
      `${item.retailer || 'Unknown'}_${(item.title || '')
        .slice(0, 40)
        .toLowerCase()}`;

    const existingByKey = retailerKeyMap.get(retailerKey);

    if (existingByKey) {
      const existingWeight =
        statusWeight[existingByKey.verificationStatus] || 0;

      if (currentWeight > existingWeight) {
        const index = results.indexOf(existingByKey);

        if (index !== -1) results[index] = item;

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
