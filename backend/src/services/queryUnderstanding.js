/**
 * Query Understanding Module
 *
 * Parses a raw user search query into a structured QueryIdentity with:
 * - Normalized brand name
 * - Normalized model identifier
 * - Product category
 * - Search aliases used for multi-query discovery
 *
 * No network calls. No fabricated data. Pure text analysis.
 */

// ---------------------------------------------------------------------------
// Brand alias table: canonical form is the VALUE.
// Keys cover common misspellings, casing variants and compressed forms.
// ---------------------------------------------------------------------------
const BRAND_ALIASES = {
  boat: 'boAt',
  'bo at': 'boAt',
  bose: 'Bose',
  sony: 'Sony',
  samsung: 'Samsung',
  apple: 'Apple',
  logitech: 'Logitech',
  hp: 'HP',
  dell: 'Dell',
  lenovo: 'Lenovo',
  asus: 'Asus',
  acer: 'Acer',
  oneplus: 'OnePlus',
  'one plus': 'OnePlus',
  xiaomi: 'Xiaomi',
  redmi: 'Redmi',
  realme: 'Realme',
  motorola: 'Motorola',
  google: 'Google',
  nothing: 'Nothing',
  noise: 'Noise',
  boult: 'Boult',
  sennheiser: 'Sennheiser',
  jbl: 'JBL',
  lg: 'LG',
  microsoft: 'Microsoft',
  canon: 'Canon',
  nikon: 'Nikon',
  oppo: 'Oppo',
  vivo: 'Vivo',
  iqoo: 'iQOO',
  intel: 'Intel',
  amd: 'AMD',
  nvidia: 'Nvidia',
  freedom: 'Freedom',
  fortune: 'Fortune',
  saffola: 'Saffola',
  tata: 'Tata',
};

// ---------------------------------------------------------------------------
// Model number normalisation: compress common mangling patterns.
// e.g. "WHCH720N" → "WH-CH720N", "whch520" → "WH-CH520"
// ---------------------------------------------------------------------------
const MODEL_NORMALIZATIONS = [
  // Sony WH / WF / WI without hyphen
  [/\b(w[hf])(ch|1000|xm|c)([0-9a-z]+)/i, (_, a, b, c) => `${a.toUpperCase()}-${b.toUpperCase()}${c.toUpperCase()}`],
];

// ---------------------------------------------------------------------------
// Category keyword detection
// ---------------------------------------------------------------------------
const CATEGORY_MAP = [
  { keywords: ['airdopes', 'tws', 'truly wireless', 'earbuds', 'earbud'], category: 'wireless earbuds' },
  { keywords: ['headphone', 'headphones', 'over-ear', 'over ear', 'on-ear', 'on ear'], category: 'headphones' },
  { keywords: ['earphone', 'earphones', 'in-ear', 'in ear', 'iem'], category: 'earphones' },
  { keywords: ['neckband', 'neck band'], category: 'neckband earphones' },
  { keywords: ['speaker', 'speakers', 'soundbar', 'subwoofer'], category: 'speaker' },
  { keywords: ['laptop', 'notebook', 'macbook', 'victus', 'pavilion', 'inspiron', 'thinkpad', 'zenbook', 'vivobook', 'omen', 'envy'], category: 'laptop' },
  { keywords: ['smartphone', 'mobile', 'phone', 'galaxy', 'iphone', 'pixel'], category: 'smartphone' },
  { keywords: ['tablet', 'ipad'], category: 'tablet' },
  { keywords: ['mouse', 'mice', 'trackpad'], category: 'mouse' },
  { keywords: ['keyboard'], category: 'keyboard' },
  { keywords: ['monitor', 'display', 'screen'], category: 'monitor' },
  { keywords: ['oil', 'sunflower', 'mustard', 'olive', 'refined', 'cooking oil'], category: 'cooking oil' },
  { keywords: ['atta', 'flour', 'wheat'], category: 'flour' },
  { keywords: ['rice', 'basmati', 'parboiled'], category: 'rice' },
  { keywords: ['shampoo', 'conditioner', 'soap', 'detergent', 'handwash'], category: 'personal care' },
];

// ---------------------------------------------------------------------------
// Consumable product category set (food, cleaning, beverages)
// ---------------------------------------------------------------------------
const CONSUMABLE_CATEGORIES = new Set([
  'cooking oil', 'flour', 'rice', 'personal care',
]);

// ---------------------------------------------------------------------------
// Generic search noise tokens that should NOT appear in model aliases
// ---------------------------------------------------------------------------
const GENERIC_NOISE = new Set([
  'price', 'online', 'buy', 'with', 'bluetooth', 'wireless', 'india', 'review',
  'best', 'amazon', 'flipkart', 'croma', 'official', 'vs', 'vs.', 'and',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a raw model string.
 * Applies MODEL_NORMALIZATIONS and strips leading/trailing noise.
 */
function normalizeModelString(raw) {
  if (!raw) return null;
  let result = raw.trim();
  for (const [pattern, replacer] of MODEL_NORMALIZATIONS) {
    result = result.replace(pattern, replacer);
  }
  return result.toUpperCase();
}

/**
 * Detect canonical brand from text.
 * Returns the canonical form or null.
 */
function detectBrand(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const [alias, canonical] of Object.entries(BRAND_ALIASES)) {
    // Word-boundary check to avoid false matches inside larger words
    const re = new RegExp(`(?:^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i');
    if (re.test(lower)) {
      return canonical;
    }
  }

  // Infer brand for famous product lines when brand name is omitted
  if (/\b(?:iphone|ipad|macbook|airpods|imac|apple\s*watch)\b/i.test(lower)) {
    return 'Apple';
  }
  if (/\b(?:galaxy\s*s\d+|galaxy\s*z|galaxy\s*fold|galaxy\s*flip|galaxy\s*tab)\b/i.test(lower)) {
    return 'Samsung';
  }
  if (/\b(?:thinkpad|ideapad|legion|yoga)\b/i.test(lower)) {
    return 'Lenovo';
  }
  if (/\b(?:pixel\s*\d+|chromecast)\b/i.test(lower)) {
    return 'Google';
  }
  if (/\b(?:playstation|ps[45]|bravia)\b/i.test(lower)) {
    return 'Sony';
  }

  return null;
}

/**
 * Detect product category from text.
 */
export function detectCategory(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const { keywords, category } of CATEGORY_MAP) {
    for (const kw of keywords) {
      const regex = new RegExp(`(?:^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i');
      if (regex.test(lower)) return category;
    }
  }
  return null;
}

/**
 * Returns true when the category is a consumable (food/personal care).
 */
export function isConsumableProduct(text) {
  const cat = detectCategory(text);
  return cat !== null && CONSUMABLE_CATEGORIES.has(cat);
}

/**
 * Extract quantity from text: 1L, 500g, 2kg, 6-pack, 1 litre, 500 ml, etc.
 */
export function extractQuantity(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // e.g. 1L, 2.5L, 500ML, 500ml, 1 litre, 1.5 litres
  const litreMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*(?:l|lit|litre?s?|ltr|ml|millilitre?s?)\b/);
  if (litreMatch) {
    const val = parseFloat(litreMatch[1]);
    const unit = litreMatch[0].includes('ml') || litreMatch[0].includes('milli') ? 'ml' : 'L';
    return `${val}${unit}`;
  }

  // e.g. 500g, 1kg, 2 kg, 500 grams
  const weightMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*(?:kg|kilogram?s?|g|gm|gram?s?)\b/);
  if (weightMatch) {
    const val = parseFloat(weightMatch[1]);
    const unit = weightMatch[0].includes('kg') || weightMatch[0].includes('kilo') ? 'kg' : 'g';
    return `${val}${unit}`;
  }

  // e.g. 6-pack, 12 pack
  const packMatch = lower.match(/\b(\d+)\s*[-\s]?pack\b/);
  if (packMatch) return `${packMatch[1]}-pack`;

  // e.g. 1 piece, 2 units
  const pieceMatch = lower.match(/\b(\d+)\s*(?:piece?s?|units?|pcs?)\b/);
  if (pieceMatch) return `${pieceMatch[1]}pc`;

  return null;
}

/**
 * Extract the core model token(s) from the query after the brand has been removed.
 * Returns the leading alphanumeric+punctuation segment most likely to be the model ID.
 *
 * Example: "boat airdopes 111v2" → brand="boAt" → remainder "airdopes 111v2" → "AIRDOPES 111V2"
 */
function extractModelFromRemainder(remainder) {
  if (!remainder) return null;

  // Strip generic noise words
  const tokens = remainder
    .split(/\s+/)
    .filter((t) => t.length > 0 && !GENERIC_NOISE.has(t.toLowerCase()));

  if (tokens.length === 0) return null;

  // A strong model token: contains a digit or is all-caps/mixed alphanumeric
  const hasDigit = (s) => /\d/.test(s);
  const MODEL_MODIFIERS = new Set([
    'pro', 'max', 'plus', 'ultra', 'mini', 'lite', 'fe', 'se', 'super', 'ti', '5g', '4g', 'slim', 'air'
  ]);

  // Keep tokens up to and including the first token with a digit + any immediately following model modifiers
  // e.g. "airdopes 111v2 earbuds" → ["airdopes", "111v2"]
  // e.g. "iphone 17 pro max 256gb" → ["iphone", "17", "pro", "max"]
  let modelTokens = [];
  let foundDigit = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const cleanT = t.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!foundDigit) {
      modelTokens.push(t);
      if (hasDigit(t)) {
        foundDigit = true;
      }
    } else {
      if (MODEL_MODIFIERS.has(cleanT)) {
        modelTokens.push(t);
      } else {
        break;
      }
    }
  }

  // If nothing has a digit, take the first two non-noise tokens as a family name
  if (!hasDigit(modelTokens[modelTokens.length - 1]) && !foundDigit) {
    modelTokens = tokens.slice(0, 2);
  }

  return modelTokens.join(' ').toUpperCase();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse a raw user query into a structured QueryIdentity.
 *
 * @param {string} rawQuery  - The user's raw search string.
 * @returns {QueryIdentity}
 *
 * @typedef {Object} QueryIdentity
 * @property {string}        originalQuery    - Verbatim user input.
 * @property {string}        normalizedQuery  - Lower-cased, collapsed whitespace.
 * @property {string|null}   brand            - Canonical brand (e.g. "boAt").
 * @property {string|null}   model            - Normalised model string (e.g. "AIRDOPES 111V2").
 * @property {string|null}   category         - Detected product category.
 * @property {boolean}       isConsumable     - True for food/personal-care products.
 * @property {string|null}   quantity         - Quantity if present (e.g. "1L").
 * @property {string[]}      searchAliases    - Ordered list of queries for multi-query discovery.
 */
export function parseQueryIdentity(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return {
      originalQuery: rawQuery || '',
      normalizedQuery: '',
      brand: null,
      model: null,
      category: null,
      isConsumable: false,
      quantity: null,
      searchAliases: [],
    };
  }

  const originalQuery = rawQuery.trim();
  const normalizedQuery = originalQuery.toLowerCase().replace(/\s+/g, ' ');

  // 1. Brand detection
  const brand = detectBrand(normalizedQuery);

  // 2. Build the "remainder" (query with brand removed) for model extraction
  let remainder = normalizedQuery;
  if (brand) {
    // Remove the brand alias that was matched (longest match wins)
    for (const alias of Object.keys(BRAND_ALIASES).sort((a, b) => b.length - a.length)) {
      if (BRAND_ALIASES[alias] === brand) {
        const re = new RegExp(`(?:^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i');
        if (re.test(remainder)) {
          remainder = remainder.replace(re, ' ').replace(/\s+/g, ' ').trim();
          break;
        }
      }
    }
  }

  // 3. Model extraction
  let rawModel = extractModelFromRemainder(remainder);
  const model = rawModel ? normalizeModelString(rawModel) : null;

  // 4. Category & consumable detection
  const category = detectCategory(normalizedQuery);
  const isConsumable = category !== null && CONSUMABLE_CATEGORIES.has(category);

  // 5. Quantity (for consumables)
  const quantity = extractQuantity(normalizedQuery);

  // 6. Build search aliases
  const aliases = buildSearchAliases({ brand, model, category, originalQuery, remainder, isConsumable, quantity });

  return {
    originalQuery,
    normalizedQuery,
    brand,
    model,
    category,
    isConsumable,
    quantity,
    searchAliases: aliases,
  };
}

/**
 * Build an ordered array of search aliases for multi-query discovery.
 * Aliases go from most specific to most general.
 * Max aliases returned: 4 (to cap parallel request count).
 */
function buildSearchAliases({ brand, model, category, originalQuery, remainder, isConsumable }) {
  const aliases = new Set();

  // Priority 1: If brand + model both detected → use canonical form
  if (brand && model) {
    // Model is already UPPERCASED; rebuild readable form preserving case
    const readableModel = model; // keep uppercase for model numbers — standard practice

    // If model has a space before digits (e.g. "FLIP 6" -> "FLIP6", "S 24" -> "S24"), prioritize compressed variant
    // as Indian e-commerce sites (Amazon, Croma, Flipkart) predominantly index product models without spaces
    const compactModel = readableModel.replace(/\b(FLIP|FOLD|[A-Za-z])\s+(\d+)\b/gi, '$1$2');
    if (compactModel !== readableModel) {
      aliases.add(`${brand} ${compactModel}`);
    }

    aliases.add(`${brand} ${readableModel}`);

    // If model has no space before digits (e.g. "FLIP6" -> "FLIP 6", "S24" -> "S 24"), add spaced variant
    const spacedModel = readableModel.replace(/\b(FLIP|FOLD|[A-Za-z])(\d+)\b/gi, '$1 $2');
    if (spacedModel !== readableModel) {
      aliases.add(`${brand} ${spacedModel}`);
    }

    // e.g. "boAt Airdopes 111V2 earbuds" (category suffix)
    if (category && !isConsumable) {
      const catWord = category.split(' ').pop(); // "earbuds" from "wireless earbuds"
      aliases.add(`${brand} ${compactModel} ${catWord}`);
    }

    // brand only + remainder as-is from user (e.g. "boAt airdopes 111v2")
    if (remainder && remainder !== model.toLowerCase()) {
      aliases.add(`${brand} ${remainder}`);
    }
  }

  // Priority 2: original query verbatim
  aliases.add(originalQuery);

  // Priority 3: original query with "India" to bias Indian results
  if (!originalQuery.toLowerCase().includes('india')) {
    aliases.add(`${originalQuery} India`);
  }

  // Priority 4: brand alone if model is long (for category-level discovery)
  if (brand && model && model.split(' ').length >= 2) {
    // skip — too broad
  }

  // Convert to array and limit
  return [...aliases].slice(0, 4);
}
