import { describe, it, expect } from 'vitest';
import {
  parseQueryIdentity,
  detectCategory,
  isConsumableProduct,
  extractQuantity,
} from '../../src/services/queryUnderstanding.js';

describe('Query Understanding Module', () => {
  // ---------------------------------------------------------------------------
  // Brand normalisation
  // ---------------------------------------------------------------------------
  it('normalises "boat" to canonical "boAt"', () => {
    const qi = parseQueryIdentity('boat airdopes 111v2');
    expect(qi.brand).toBe('boAt');
  });

  it('normalises "SONY" to "Sony"', () => {
    const qi = parseQueryIdentity('SONY WH-CH720N wireless headphones');
    expect(qi.brand).toBe('Sony');
  });

  it('normalises "hp" to "HP"', () => {
    const qi = parseQueryIdentity('hp victus 15 gaming laptop');
    expect(qi.brand).toBe('HP');
  });

  it('normalises "samsung" to "Samsung"', () => {
    const qi = parseQueryIdentity('samsung galaxy s25 256gb');
    expect(qi.brand).toBe('Samsung');
  });

  // ---------------------------------------------------------------------------
  // Model extraction
  // ---------------------------------------------------------------------------
  it('extracts model for boAt Airdopes 111v2', () => {
    const qi = parseQueryIdentity('boat airdopes 111v2');
    expect(qi.model).not.toBeNull();
    expect(qi.model?.toUpperCase()).toContain('AIRDOPES');
    expect(qi.model?.toUpperCase()).toContain('111V2');
  });

  it('extracts model for Sony WH-CH720N', () => {
    const qi = parseQueryIdentity('sony WH-CH720N');
    expect(qi.model).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Category detection
  // ---------------------------------------------------------------------------
  it('detects "wireless earbuds" for boAt Airdopes', () => {
    const cat = detectCategory('boat airdopes 111v2');
    expect(cat).toBe('wireless earbuds');
  });

  it('detects "headphones" for WH-CH720N', () => {
    const cat = detectCategory('Sony WH-CH720N wireless headphone');
    expect(cat).toBe('headphones');
  });

  it('detects "cooking oil" for Freedom Refined Sunflower Oil', () => {
    const cat = detectCategory('Freedom Refined Sunflower Oil 1L');
    expect(cat).toBe('cooking oil');
  });

  it('detects "laptop" for HP Victus 15', () => {
    const cat = detectCategory('HP Victus 15 gaming laptop');
    expect(cat).toBe('laptop');
  });

  // ---------------------------------------------------------------------------
  // Consumable detection
  // ---------------------------------------------------------------------------
  it('marks cooking oil as consumable', () => {
    expect(isConsumableProduct('Freedom Refined Sunflower Oil 1L')).toBe(true);
  });

  it('does not mark Sony headphones as consumable', () => {
    expect(isConsumableProduct('Sony WH-CH720N headphone')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Quantity extraction
  // ---------------------------------------------------------------------------
  it('extracts 1L from "Freedom Refined Sunflower Oil 1L"', () => {
    expect(extractQuantity('Freedom Refined Sunflower Oil 1L')).toBe('1L');
  });

  it('extracts 500ml', () => {
    expect(extractQuantity('shampoo 500ml')).toBe('500ml');
  });

  it('extracts 1kg', () => {
    expect(extractQuantity('Fortune Basmati Rice 1kg')).toBe('1kg');
  });

  it('returns null when no quantity present', () => {
    expect(extractQuantity('Sony WH-CH720N wireless headphones')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Search alias generation
  // ---------------------------------------------------------------------------
  it('generates multiple aliases for boAt Airdopes 111v2', () => {
    const qi = parseQueryIdentity('boat airdopes 111v2');
    expect(Array.isArray(qi.searchAliases)).toBe(true);
    expect(qi.searchAliases.length).toBeGreaterThanOrEqual(2);
    // At least one alias should contain the canonical brand
    const hasCanonical = qi.searchAliases.some((a) => a.toLowerCase().includes('boat'));
    expect(hasCanonical).toBe(true);
  });

  it('generates aliases for Freedom Refined Sunflower Oil 1L', () => {
    const qi = parseQueryIdentity('Freedom Refined Sunflower Oil 1L');
    expect(qi.searchAliases.length).toBeGreaterThanOrEqual(1);
  });

  it('always includes originalQuery in aliases', () => {
    const qi = parseQueryIdentity('Logitech MX Master 3S');
    expect(qi.searchAliases).toContain('Logitech MX Master 3S');
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  it('handles empty string gracefully', () => {
    const qi = parseQueryIdentity('');
    expect(qi.brand).toBeNull();
    expect(qi.model).toBeNull();
    expect(qi.searchAliases).toHaveLength(0);
  });
});
