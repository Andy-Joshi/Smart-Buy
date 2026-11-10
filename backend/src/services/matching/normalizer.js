
/**
 * Normalization utilities for product titles, brands, models, and specifications.
 */

import {
  detectCategory,
  isConsumableProduct,
  extractQuantity,
} from '../queryUnderstanding.js';

export { detectCategory, isConsumableProduct, extractQuantity };

const KNOWN_BRANDS = [
  'apple', 'sony', 'samsung', 'logitech', 'hp', 'dell',
  'lenovo', 'asus', 'acer', 'oneplus', 'xiaomi', 'redmi',
  'realme', 'motorola', 'google', 'nothing', 'boat', 'noise',
  'boult', 'bose', 'sennheiser', 'jbl', 'lg', 'microsoft',
  'canon', 'nikon', 'oppo', 'vivo', 'iqoo', 'intel', 'amd',
  'nvidia',
];

const ACCESSORY_KEYWORDS = [
  'case', 'cover', 'pouch', 'sleeve', 'tempered glass',
  'screen protector', 'screen guard', 'skin', 'strap',
  'band', 'replacement earpads', 'earpad', 'ear cushions',
  'charging cable', 'adapter only', 'stand', 'mount',
  'silicone case',
];

export function cleanTitle(title) {
  if (!title || typeof title !== 'string') return '';

  let cleaned = title
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
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

export function extractBrand(text) {
  if (!text) return null;

  const lower = text.toLowerCase();

  for (const brand of KNOWN_BRANDS) {
    const regex = new RegExp(
      `(?:^|[^a-z0-9])${brand}(?:$|[^a-z0-9])`,
      'i'
    );

    if (regex.test(lower)) {
      if (brand === 'hp') return 'HP';
      if (brand === 'lg') return 'LG';
      if (brand === 'jbl') return 'JBL';
      if (brand === 'amd') return 'AMD';
      if (brand === 'boat') return 'boAt';

      return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
  }

  return null;
}

/**
 * Extract only identifiable model families or model numbers.
 * Generic descriptive phrases are deliberately NOT model identifiers.
 */
export function extractModel(text, brandHint = null) {
  if (!text) return null;

  const patterns = [
    // Sony headphones and earbuds
    /\b(W[HF]-[A-Z0-9]{3,7})\b/i,

    // Samsung Galaxy models
    /\b(Galaxy\s+(?:S\d{2}[A-Za-z+]*|Z\s+(?:Fold|Flip)\s*\d+|A\d{2}[A-Za-z+]*|M\d{2}[A-Za-z+]*))\b/i,
    /\b(S\d{2}(?:\s*(?:Ultra|Plus|\+|FE))?)\b/i,

    // Apple products
    /\b(MacBook\s+(?:Air|Pro))\b/i,
    /\b(iPhone\s+\d{1,2}(?:\s+(?:Pro\s+Max|Pro|Plus|Mini))?)\b/i,

    // Apple Silicon identifiers are handled separately by generation.

    // Logitech
    /\b(MX\s+Master\s+3S|MX\s+Master\s+3|MX\s+Keys\s+S|MX\s+Keys|MX\s+Anywhere\s+3S|G502\s*X)\b/i,

    // HP
    /\b(Victus\s+\d{2}|Pavilion\s+\d{2}|Envy\s+x360|Omen\s+\d{2})\b/i,

    // Lenovo identifiable families with model numbers
    /\b(ThinkPad\s+[A-Z]\d{1,2})\b/i,
    /\b(IdeaPad\s+[A-Z]?\d{1,2})\b/i,
    /\b(Legion\s+[357]\s*(?:Pro)?)\b/i,
    /\b(Yoga\s+\d{1,2})\b/i,

// boAt Airdopes model identifiers
/\b(Airdopes\s+\d{2,4}[A-Za-z0-9]*)\b/i,

    // General alphanumeric model codes
    /\b([A-Z]{2,4}-[A-Z0-9]{3,8})\b/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);

    if (match) {
      return match[1]
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    }
  }

  // No generic fallback. Words such as "Wireless Keyboard",
  // "Smartchoice Keyboard" and "Idea Tab" are not model numbers.

  return null;
}

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

export function isAccessoryItem(text) {
  if (!text) return false;

  const lower = text.toLowerCase();

  for (const keyword of ACCESSORY_KEYWORDS) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `(?:^|\\s)${escaped}(?:$|\\s)`,
      'i'
    );

    if (regex.test(lower)) {
      return true;
    }
  }

  return false;
}

/**
 * Build a structured product identity from raw text.
 */
export function parseProductIdentity(rawText) {
  const clean = cleanTitle(rawText);

  const brand = extractBrand(clean);
  const category = detectCategory(clean);
  const model = extractModel(clean, brand);
  const storage = extractStorage(clean);
  const ram = extractRam(clean);
  const generation = extractGeneration(clean);
  const isAccessory = isAccessoryItem(clean);

  return {
    raw: rawText,
    cleanTitle: clean,
    brand,
    model,
    category,
    storage,
    ram,
    generation,
    isAccessory,
  };
}
 
 
