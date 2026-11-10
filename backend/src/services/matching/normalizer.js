
/**
 * Normalization utilities for product titles, brands, models, and specifications.
 */

import { detectCategory } from '../queryUnderstanding.js';

// Re-export consumable utilities to keep the public API consistent.
export {
  isConsumableProduct,
  extractQuantity,
  detectCategory,
} from '../queryUnderstanding.js';

const KNOWN_BRANDS = [
  'apple', 'sony', 'samsung', 'logitech', 'hp', 'dell',
  'lenovo', 'asus', 'acer', 'oneplus', 'xiaomi', 'redmi',
  'realme', 'motorola', 'google', 'nothing', 'boat', 'noise',
  'boult', 'bose', 'sennheiser', 'jbl', 'lg', 'microsoft',
  'canon', 'nikon', 'oppo', 'vivo', 'iqoo', 'intel',
  'amd', 'nvidia',
];

const ACCESSORY_KEYWORDS = [
  'case', 'cover', 'pouch', 'sleeve', 'tempered glass',
  'screen protector', 'screen guard', 'skin', 'strap',
  'band', 'replacement earpads', 'earpad', 'ear cushions',
  'charging cable', 'adapter only', 'stand', 'mount',
  'silicone case',
];

/**
 * Remove HTML entities, marketing fluff and redundant store copy.
 */
export function cleanTitle(title) {
  if (!title || typeof title !== 'string') return '';

  let cleaned = title
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

  const promotionalPatterns = [
    /\|\s*Buy\s+Online.*$/i,
    /\|\s*Online\s+Electronics\s+Shopping.*$/i,
    /:\s*Flipkart\.com.*$/i,
    /-\s*Amazon\.in.*$/i,
    /-\s*Croma.*$/i,
    /-\s*Reliance\s+Digital.*$/i,
    /\(Price\s+in\s+India[^)]*\)/i,
    /Price\s+in\s+India\s*-\s*Buy.*$/i,
    /Only\s+Genuine\s+Products.*$/i,
    /30\s+Day\s+Replacement.*$/i,
    /Free\s+Shipping.*$/i,
  ];

  for (const pattern of promotionalPatterns) {
    cleaned = cleaned.replace(pattern, '').trim();
  }

  return cleaned;
}

/**
 * Detect brand name from text.
 */
export function extractBrand(text) {
  if (!text) return null;

  const lower = text.toLowerCase();

  for (const brand of KNOWN_BRANDS) {
    const regex = new RegExp(
      `(?:^|[^a-z0-9])${brand}(?:$|[^a-z0-9])`,
      'i'
    );

    if (regex.test(lower)) {
      const canonicalNames = {
        hp: 'HP',
        lg: 'LG',
        jbl: 'JBL',
        amd: 'AMD',
        boat: 'boAt',
      };

      return canonicalNames[brand] ||
        brand.charAt(0).toUpperCase() + brand.slice(1);
    }
  }

  return null;
}

/**
 * Extract model numbers or product family designations.
 */
export function extractModel(text, brandHint = null) {
  if (!text) return null;

  const patterns = [
    /\b(W[HF]-[A-Z0-9]{3,7})\b/i,
    /\b(Galaxy\s+(?:S\d{2}[A-Za-z+]*|Z\s+(?:Fold|Flip)\s*\d+|A\d{2}[A-Za-z+]*|M\d{2}[A-Za-z+]*))\b/i,
    /\b(S\d{2}(?:\s*(?:Ultra|Plus|\+|FE))?)\b/i,
    /\b(MacBook\s+(?:Air|Pro))\b/i,
    /\b(iPhone\s+\d{1,2}(?:\s+(?:Pro\s+Max|Pro|Plus|Mini))?)\b/i,
    /\b(MX\s+Master\s+3S|MX\s+Master\s+3|MX\s+Keys\s+S|MX\s+Keys|MX\s+Anywhere\s+3S|G502\s*X)\b/i,
    /\b(Victus\s+\d{2}|Pavilion\s+\d{2}|Envy\s+x360|Omen\s+\d{2})\b/i,
    /\b([A-Z]{2,4}-[A-Z0-9]{3,8})\b/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);

    if (match) {
      return match[1].replace(/\s+/g, ' ').trim().toUpperCase();
    }
  }

  if (brandHint) {
    const escapedBrand = brandHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const brandRegex = new RegExp(
      `${escapedBrand}\\s+([A-Za-z0-9+-]+(?:\\s+[A-Za-z0-9+-]+)?)`,
      'i'
    );

    const brandMatch = text.match(brandRegex);

    if (brandMatch) {
      const candidate = brandMatch[1].trim();

      const excludedWords = [
        'price', 'online', 'buy', 'with',
        'bluetooth', 'wireless', 'india',
      ];

      if (!excludedWords.includes(candidate.toLowerCase())) {
        return candidate.toUpperCase();
      }
    }
  }

  return null;
}

/**
 * Extract storage capacity in standardized GB format.
 */
export function extractStorage(text) {
  if (!text) return null;

  const tbMatch = text.match(/\b([1-8])\s*TB\b/i);

  if (tbMatch) {
    return `${parseInt(tbMatch[1], 10) * 1024}GB`;
  }

  const gbMatch = text.match(/\b(32|64|128|256|512)\s*GB\b/i);

  if (gbMatch) {
    return `${gbMatch[1]}GB`;
  }

  return null;
}

/**
 * Extract RAM capacity in standardized GB format.
 */
export function extractRam(text) {
  if (!text) return null;

  const ramMatch = text.match(
    /\b(4|6|8|12|16|18|24|32|36|48|64)\s*GB(?:\s*(?:RAM|Memory|Unified\s+Memory))?\b/i
  );

  if (ramMatch) {
    const isExplicitRam = /\b(RAM|Memory|Unified)\b/i.test(text);

    if (isExplicitRam) {
      return `${ramMatch[1]}GB`;
    }
  }

  return null;
}

/**
 * Extract generation.
 */
export function extractGeneration(text) {
  if (!text) return null;

  const appleMatch = text.match(
    /\b(M[1-4](?:\s*(?:Pro|Max|Ultra))?)\b/i
  );

  if (appleMatch) {
    return appleMatch[1].toUpperCase();
  }

  const intelMatch = text.match(
    /\b(1[0-5]th\s*Gen|Core\s*Ultra\s*[579])\b/i
  );

  if (intelMatch) {
    return intelMatch[1].replace(/\s+/g, ' ');
  }

  const genMatch = text.match(/\b(Gen\s*[1-5])\b/i);

  if (genMatch) {
    return genMatch[1].toUpperCase();
  }

  return null;
}

/**
 * Detect accessories rather than primary devices.
 */
export function isAccessoryItem(text) {
  if (!text) return false;

  const lower = text.toLowerCase();

  return ACCESSORY_KEYWORDS.some((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i');

    return regex.test(lower);
  });
}

/**
 * Build a structured product identity from raw text.
 */
export function parseProductIdentity(rawText) {
  const clean = cleanTitle(rawText);

  const brand = extractBrand(clean);
  const model = extractModel(clean, brand);
  const storage = extractStorage(clean);
  const ram = extractRam(clean);
  const generation = extractGeneration(clean);
  const isAccessory = isAccessoryItem(clean);

  // New: detect and attach product category.
  const category = detectCategory(clean);

  return {
    raw: rawText,
    cleanTitle: clean,
    brand,
    model,
    storage,
    ram,
    generation,
    isAccessory,
    category,
  };
}
