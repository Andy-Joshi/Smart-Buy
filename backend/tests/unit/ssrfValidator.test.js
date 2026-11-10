import { describe, it, expect } from 'vitest';
import {
  isPrivateIPv4,
  isPrivateIPv6,
  validateSafeUrl,
  detectRetailerFromHostname,
} from '../../src/services/security/safeUrlValidator.js';

describe('SSRF Protection & URL Validation Service', () => {
  it('correctly detects private and loopback IPv4 addresses', () => {
    expect(isPrivateIPv4('127.0.0.1')).toBe(true);
    expect(isPrivateIPv4('10.0.0.5')).toBe(true);
    expect(isPrivateIPv4('192.168.1.1')).toBe(true);
    expect(isPrivateIPv4('172.16.0.1')).toBe(true);
    expect(isPrivateIPv4('169.254.169.254')).toBe(true); // AWS/cloud metadata
    expect(isPrivateIPv4('0.0.0.0')).toBe(true);
    expect(isPrivateIPv4('8.8.8.8')).toBe(false); // Google Public DNS
    expect(isPrivateIPv4('1.1.1.1')).toBe(false); // Cloudflare DNS
  });

  it('correctly detects private and loopback IPv6 addresses', () => {
    expect(isPrivateIPv6('::1')).toBe(true);
    expect(isPrivateIPv6('fe80::1')).toBe(true); // Link local
    expect(isPrivateIPv6('fc00::1')).toBe(true); // Unique local
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false);
  });

  it('blocks non-HTTP/HTTPS protocols', async () => {
    const fileRes = await validateSafeUrl('file:///etc/passwd');
    expect(fileRes.valid).toBe(false);
    expect(fileRes.error).toContain('Disallowed protocol');

    const ftpRes = await validateSafeUrl('ftp://internal.backup/data');
    expect(ftpRes.valid).toBe(false);
  });

  it('blocks localhost and loopback hostnames', async () => {
    const res1 = await validateSafeUrl('http://localhost:5000/api');
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain('SSRF protection');

    const res2 = await validateSafeUrl('http://127.0.0.1:8080');
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('SSRF protection');
  });

  it('blocks cloud metadata IP (169.254.169.254)', async () => {
    const res = await validateSafeUrl('http://169.254.169.254/latest/meta-data/');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('SSRF protection');
  });

  it('rejects malformed URLs', async () => {
    const res = await validateSafeUrl('not a valid url');
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Invalid URL syntax');
  });

  it('identifies supported retailer hostnames accurately', () => {
    expect(detectRetailerFromHostname('www.croma.com')).toBe('Croma');
    expect(detectRetailerFromHostname('www.amazon.in')).toBe('Amazon India');
    expect(detectRetailerFromHostname('flipkart.com')).toBe('Flipkart');
    expect(detectRetailerFromHostname('reliancedigital.in')).toBe('Reliance Digital');
    expect(detectRetailerFromHostname('example.com')).toBeNull();
  });

  it('validates public retailer URLs successfully', async () => {
    const res = await validateSafeUrl(
      'https://www.croma.com/sony-wh-ch720n-bluetooth-headphone-with-mic-dual-noise-sensor-technology-over-ear-black-/p/270320'
    );
    expect(res.valid).toBe(true);
    expect(res.retailer).toBe('Croma');
  });
});
