import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Approved retailer domains for direct product page extraction.
 */
export const APPROVED_RETAILER_DOMAINS = [
  'amazon.in',
  'www.amazon.in',
  'flipkart.com',
  'www.flipkart.com',
  'croma.com',
  'www.croma.com',
  'reliancedigital.in',
  'www.reliancedigital.in',
  'vijaysales.com',
  'www.vijaysales.com',
  'tatacliq.com',
  'www.tatacliq.com',
  'ajio.com',
  'www.ajio.com',
  'myntra.com',
  'www.myntra.com',
];

/**
 * Check if an IPv4 address is in a private, loopback, or reserved range.
 */
export function isPrivateIPv4(ip) {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IP is treated as unsafe
  }

  const [a, b] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 169.254.0.0/16 (Link Local)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 192.0.2.0/24 (TEST-NET-1), 198.51.100.0/24 (TEST-NET-2), 203.0.113.0/24 (TEST-NET-3)
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 (Reserved)
  if (a >= 240) return true;

  return false;
}

/**
 * Check if an IPv6 address is in a private, loopback, or reserved range.
 */
export function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();

  // Loopback ::1
  if (normalized === '::1' || normalized === '0000:0000:0000:0000:0000:0000:0000:0001') {
    return true;
  }
  // Unspecified ::
  if (normalized === '::' || normalized === '0000:0000:0000:0000:0000:0000:0000:0000') {
    return true;
  }
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.replace('::ffff:', '');
    if (net.isIPv4(v4)) {
      return isPrivateIPv4(v4);
    }
    return true;
  }
  // Unique local addresses (fc00::/7 -> fc00:: to fdff::)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }
  // Link-local addresses (fe80::/10 -> fe80:: to febf::)
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }

  return false;
}

/**
 * Validates a URL for SSRF protection and retailer suitability.
 *
 * @param {string} inputUrl - The URL to validate.
 * @param {Object} options - Validation options.
 * @param {boolean} [options.requireApprovedRetailer=false] - If true, host must match approved list.
 * @returns {Promise<{ valid: boolean, parsedUrl?: URL, error?: string, retailer?: string }>}
 */
export async function validateSafeUrl(inputUrl, options = {}) {
  const { requireApprovedRetailer = false } = options;

  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, error: 'URL is required and must be a string' };
  }

  let parsed;
  try {
    parsed = new URL(inputUrl.trim());
  } catch (_e) {
    return { valid: false, error: 'Invalid URL syntax' };
  }

  // Enforce protocol
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `Disallowed protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block obvious localhost / internal hostnames
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  ) {
    return { valid: false, error: 'SSRF protection: Localhost and internal hostnames are strictly blocked' };
  }

  // Detect retailer from hostname
  const retailer = detectRetailerFromHostname(hostname);

  if (requireApprovedRetailer) {
    const isApproved = APPROVED_RETAILER_DOMAINS.some(
      (approved) => hostname === approved || hostname.endsWith(`.${approved}`)
    );
    if (!isApproved) {
      return {
        valid: false,
        error: `Host "${hostname}" is not an approved retailer. Supported retailers include Amazon India, Flipkart, Croma, Reliance Digital, and Vijay Sales.`,
      };
    }
  }

  // If hostname is directly an IP, check it
  if (net.isIPv4(hostname)) {
    if (isPrivateIPv4(hostname)) {
      return { valid: false, error: `SSRF protection: Private IPv4 destination blocked: ${hostname}` };
    }
  } else if (net.isIPv6(hostname)) {
    if (isPrivateIPv6(hostname)) {
      return { valid: false, error: `SSRF protection: Private IPv6 destination blocked: ${hostname}` };
    }
  } else {
    // Resolve DNS destination and verify all returned addresses
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      if (!addresses || addresses.length === 0) {
        return { valid: false, error: `DNS resolution failed for hostname "${hostname}"` };
      }

      for (const entry of addresses) {
        if (entry.family === 4 && isPrivateIPv4(entry.address)) {
          return {
            valid: false,
            error: `SSRF protection: Hostname resolved to private IPv4 address: ${entry.address}`,
          };
        }
        if (entry.family === 6 && isPrivateIPv6(entry.address)) {
          return {
            valid: false,
            error: `SSRF protection: Hostname resolved to private IPv6 address: ${entry.address}`,
          };
        }
      }
    } catch (dnsErr) {
      return { valid: false, error: `DNS resolution failed: ${dnsErr.message}` };
    }
  }

  return {
    valid: true,
    parsedUrl: parsed,
    retailer: retailer || 'Unknown Retailer',
  };
}

/**
 * Identify retailer brand name from hostname.
 */
export function detectRetailerFromHostname(hostname) {
  const host = (hostname || '').toLowerCase();
  if (host.includes('amazon.')) return 'Amazon India';
  if (host.includes('flipkart.')) return 'Flipkart';
  if (host.includes('croma.')) return 'Croma';
  if (host.includes('reliancedigital.')) return 'Reliance Digital';
  if (host.includes('vijaysales.')) return 'Vijay Sales';
  if (host.includes('tatacliq.')) return 'Tata CLiQ';
  if (host.includes('ajio.')) return 'Ajio';
  if (host.includes('myntra.')) return 'Myntra';
  return null;
}

/**
 * Safe fetch with SSRF verification, redirect re-validation, timeout and size limits.
 *
 * @param {string} url - Target URL.
 * @param {Object} [options] - Fetch options.
 * @param {number} [options.timeoutMs=10000] - Timeout in milliseconds.
 * @param {number} [options.maxSizeBytes=5242880] - Max allowed response size (5MB).
 * @param {number} [options.maxRedirects=5] - Maximum redirects to follow safely.
 * @param {Object} [options.headers] - Request headers.
 */
export async function safeFetch(url, options = {}) {
  const {
    timeoutMs = 10000,
    maxSizeBytes = 5242880, // 5MB
    maxRedirects = 5,
    headers = {},
  } = options;

  let currentUrl = url;
  let redirectsFollowed = 0;

  const defaultHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
    ...headers,
  };

  while (redirectsFollowed <= maxRedirects) {
    const validation = await validateSafeUrl(currentUrl);
    if (!validation.valid) {
      throw new Error(`Safe fetch blocked: ${validation.error}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

    let res;
    try {
      res = await fetch(currentUrl, {
        headers: defaultHeaders,
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    // Check for redirect status codes (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error(`Redirect response (${res.status}) missing Location header`);
      }

      // Resolve relative redirect against current URL
      const nextUrl = new URL(location, currentUrl).toString();
      redirectsFollowed++;
      if (redirectsFollowed > maxRedirects) {
        throw new Error(`Exceeded maximum allowed redirects (${maxRedirects})`);
      }
      currentUrl = nextUrl;
      continue;
    }

    // Check Content-Length header if present
    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
      throw new Error(`Response size ${contentLength} bytes exceeds limit of ${maxSizeBytes} bytes`);
    }

    // Stream and enforce max size
    const body = await res.text();
    if (body.length > maxSizeBytes) {
      throw new Error(`Response body exceeded max size of ${maxSizeBytes} bytes`);
    }

    return {
      status: res.status,
      headers: res.headers,
      finalUrl: currentUrl,
      text: body,
      retailer: validation.retailer,
    };
  }

  throw new Error('Too many redirects');
}
