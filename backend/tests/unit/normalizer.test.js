import { describe, it, expect } from 'vitest';
import {
  cleanTitle,
  extractBrand,
  extractModel,
  extractStorage,
  extractRam,
  extractGeneration,
  isAccessoryItem,
  parseProductIdentity,
} from '../../src/services/matching/normalizer.js';

describe('Product Normalization Service', () => {
  it('cleans promotional noise and HTML entities from titles', () => {
    const raw = 'SONY WH-CH720N &amp; Bluetooth Headphone | Buy Online at Best Price - Flipkart.com';
    const cleaned = cleanTitle(raw);
    expect(cleaned).toContain('SONY WH-CH720N & Bluetooth Headphone');
    expect(cleaned).not.toContain('Buy Online');
    expect(cleaned).not.toContain('&amp;');
  });

  it('extracts brands accurately across diverse casing', () => {
    expect(extractBrand('Sony WH-CH720N Noise Cancelling')).toBe('Sony');
    expect(extractBrand('samsung galaxy s25 ultra 5g')).toBe('Samsung');
    expect(extractBrand('Apple MacBook Air M4')).toBe('Apple');
    expect(extractBrand('logitech mx master 3s wireless mouse')).toBe('Logitech');
    expect(extractBrand('hp victus 15 gaming laptop')).toBe('HP');
    expect(extractBrand('Unknown Gadget 123')).toBeNull();
  });

  it('extracts model numbers for various electronics', () => {
    expect(extractModel('Sony WH-CH720N Wireless Headphones')).toBe('WH-CH720N');
    expect(extractModel('Sony WH-1000XM5 Premium Noise Canceling')).toBe('WH-1000XM5');
    expect(extractModel('Samsung Galaxy S25 256GB')).toContain('S25');
    expect(extractModel('Apple MacBook Air 13 M4')).toContain('MACBOOK AIR');
    expect(extractModel('Logitech MX Master 3S Performance Mouse')).toBe('MX MASTER 3S');
    expect(extractModel('HP Victus 15 Gaming Laptop')).toBe('VICTUS 15');
  });

  it('extracts and standardizes storage variants', () => {
    expect(extractStorage('Samsung Galaxy S25 256GB Storage')).toBe('256GB');
    expect(extractStorage('Apple iPhone 16 128GB')).toBe('128GB');
    expect(extractStorage('MacBook Air 512GB SSD')).toBe('512GB');
    expect(extractStorage('MacBook Pro 1TB Storage')).toBe('1024GB');
    expect(extractStorage('Sony WH-CH720N Headphone')).toBeNull();
  });

  it('extracts RAM variants with precision', () => {
    expect(extractRam('Apple MacBook Air M4 16GB RAM')).toBe('16GB');
    expect(extractRam('Dell Inspiron 16GB Memory')).toBe('16GB');
    expect(extractRam('Asus ROG 32GB RAM')).toBe('32GB');
    expect(extractRam('Simple Mouse with 0 specs')).toBeNull();
  });

  it('extracts hardware generations accurately', () => {
    expect(extractGeneration('Apple MacBook Air M4 16GB')).toBe('M4');
    expect(extractGeneration('iPad Pro M2 11-inch')).toBe('M2');
    expect(extractGeneration('Intel Core i7 13th Gen Laptop')).toBe('13th Gen');
    expect(extractGeneration('ThinkPad X1 Carbon Gen 2')).toBe('GEN 2');
  });

  it('detects accessory items (cases, covers, cushions, guards)', () => {
    expect(isAccessoryItem('Protective Silicone Case for Sony WH-CH720N')).toBe(true);
    expect(isAccessoryItem('Replacement Earpad Cushion for WH-CH720N')).toBe(true);
    expect(isAccessoryItem('Tempered Glass Screen Protector for Galaxy S25')).toBe(true);
    expect(isAccessoryItem('Sony WH-CH720N Wireless Noise Cancelling Headphones')).toBe(false);
    expect(isAccessoryItem('Samsung Galaxy S25 Ultra 256GB')).toBe(false);
  });

  it('builds complete structured product identity', () => {
    const identity = parseProductIdentity('Samsung Galaxy S25 256GB 12GB RAM Marble Gray');
    expect(identity.brand).toBe('Samsung');
    expect(identity.storage).toBe('256GB');
    expect(identity.isAccessory).toBe(false);
  });
});
