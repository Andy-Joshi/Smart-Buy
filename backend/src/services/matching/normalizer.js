/**
 * Normalization utilities for product titles, brands, models, and specifications.
 */

// Re-export consumable utilities from queryUnderstanding to keep the public API consistent
export { isConsumableProduct, extractQuantity, detectCategory } from '../queryUnderstanding.js';

const KNOWN_BRANDS = [
  'apple',
  'sony',
  'samsung',
  'logitech',
  'hp',
  'dell',
  'lenovo',
  'asus',
  'acer',
  'oneplus',
  'xiaomi',
  'redmi',
  'realme',
  'motorola',
  'google',
  'nothing',
  'boat',
  'noise',
  'boult',
  'bose',
  'sennheiser',
  'jbl',
  'lg',
  'microsoft',
  'canon',
  'nikon',
  'oppo',
  'vivo',
  'iqoo',
  'intel',
  'amd',
  'nvidia',
];

const ACCESSORY_KEYWORDS = [
  'case',
  'cover',
  'pouch',
  'sleeve',
  'tempered glass',
  'screen protector',
  'screen guard',
  'skin',
  'strap',
  'band',
  'replacement earpads',
  'earpad',
  'ear cushions',
  'charging cable',
  'adapter only',
  'stand',
  'mount',
  'silicone case',
];

/**
 * Remove noise, marketing fluff, HTML entities, and redundant store copy.
 */
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

  // Strip promotional suffixes and generic noise
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
    // Word boundary check
    const regex = new RegExp(`(?:^|[^a-z0-9])${brand}(?:$|[^a-z0-9])`, 'i');
    if (regex.test(lower)) {
      // Return canonical brand capitalization
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
 * Extract model numbers or specific device family designations.
 */
export function extractModel(text, brandHint = null) {
  if (!text) return null;

  // Specific high-value product patterns
  const patterns = [
    // Sony headphones/earbuds (e.g., WH-CH720N, WH-1000XM5, WF-1000XM4, WH-CH520, WI-C100)
    /\b(W[HF]-[A-Z0-9]{3,7})\b/i,
    // Samsung S-series and Z-series (e.g. S25 Ultra, S25+, S25, Galaxy S25, Z Fold 6, Z Flip 6, S24 FE)
    /\b(Galaxy\s+(?:S\d{2}[A-Za-z+]*|Z\s+(?:Fold|Flip)\s*\d+|A\d{2}[A-Za-z+]*|M\d{2}[A-Za-z+]*))\b/i,
    /\b(S\d{2}(?:\s*(?:Ultra|Plus|\+|FE))?)\b/i,
    // Apple Mac / iPhone (e.g. MacBook Air M4, MacBook Pro M3, iPhone 16 Pro Max, iPhone 16)
    /\b(MacBook\s+(?:Air|Pro))\b/i,
    /\b(iPhone\s+\d{1,2}(?:\s+(?:Pro\s+Max|Pro|Plus|Mini))?)\b/i,
    // Logitech models (e.g. MX Master 3S, MX Master 3, MX Keys S, G502 X, Pebble 2)
    /\b(MX\s+Master\s+3S|MX\s+Master\s+3|MX\s+Keys\s+S|MX\s+Keys|MX\s+Anywhere\s+3S|G502\s*X)\b/i,
    // HP laptops (e.g. Victus 15, Pavilion 15, Envy x360, Omen 16)
    /\b(Victus\s+\d{2}|Pavilion\s+\d{2}|Envy\s+x360|Omen\s+\d{2})\b/i,
    // General alphanumeric model codes (e.g. SM-S928B, ANC-800, MDR-ZX110)
    /\b([A-Z]{2,4}-[A-Z0-9]{3,8})\b/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match) {
      return match[1].replace(/\s+/g, ' ').trim().toUpperCase();
    }
  }

  // Fallback: look for 2-word model phrases after brand
  if (brandHint) {
    const brandRegex = new RegExp(`${brandHint}\\s+([A-Za-z0-9+-]+(?:\\s+[A-Za-z0-9+-]+)?)`, 'i');
    const brandMatch = text.match(brandRegex);
    if (brandMatch) {
      const candidate = brandMatch[1].trim();
      // Exclude generic words
      if (!['price', 'online', 'buy', 'with', 'bluetooth', 'wireless', 'india'].includes(candidate.toLowerCase())) {
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
  // Match 1TB, 2TB, 512GB, 256GB, 128GB, 64GB
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
  // Match 8GB RAM, 16GB RAM, 16 GB Unified Memory, 32GB RAM
  const ramMatch = text.match(/\b(4|6|8|12|16|18|24|32|36|48|64)\s*GB(?:\s*(?:RAM|Memory|Unified\s+Memory))?\b/i);
  if (ramMatch) {
    // Verify it's explicitly RAM or in laptop/spec context if it follows "RAM"
    const isExplicitRam = /\b(RAM|Memory|Unified)\b/i.test(text);
    if (isExplicitRam) {
      return `${ramMatch[1]}GB`;
    }
  }
  return null;
}

/**
 * Extract generation (e.g. M1, M2, M3, M4, 13th Gen, Gen 2).
 */
export function extractGeneration(text) {
  if (!text) return null;

  // Apple Silicon
  const appleMatch = text.match(/\b(M[1-4](?:\s*(?:Pro|Max|Ultra))?)\b/i);
  if (appleMatch) {
    return appleMatch[1].toUpperCase();
  }

  // Intel/AMD generation
  const intelMatch = text.match(/\b(1[0-5]th\s*Gen|Core\s*Ultra\s*[579])\b/i);
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
 * Check if the title indicates an accessory (case, pouch, screen protector)
 * rather than the actual primary device.
 */
export function isAccessoryItem(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const keyword of ACCESSORY_KEYWORDS) {
    const regex = new RegExp(`(?:^|\\s)${keyword}(?:$|\\s)`, 'i');
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
    storage,
    ram,
    generation,
    isAccessory,
  };
}
