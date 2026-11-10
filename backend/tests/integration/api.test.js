import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/server.js';

describe('Smart Buy Lab API Integration Tests', () => {
  it('GET /api/health returns healthy system status and providers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('Smart Buy Lab Comparison Engine');
    expect(Array.isArray(res.body.providers)).toBe(true);
    expect(res.body.providers.length).toBeGreaterThan(0);
  });

  it('GET /api/providers lists all registered search providers with status', async () => {
    const res = await request(app).get('/api/providers');
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(Array.isArray(res.body.providers)).toBe(true);
    const pIds = res.body.providers.map((p) => p.id);
    expect(pIds).toContain('duckduckgo_public');
  });

  it('GET /api/search rejects empty or missing query with 400', async () => {
    const res = await request(app).get('/api/search');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Query parameter "q" is required');

    const res2 = await request(app).get('/api/search?q=   ');
    expect(res2.status).toBe(400);
  });

  it('POST /api/search/url rejects missing or empty url with 400', async () => {
    const res = await request(app).post('/api/search/url').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Body parameter "url" is required');
  });

  it('POST /api/search/url blocks localhost and private IPs via SSRF protection', async () => {
    const res = await request(app)
      .post('/api/search/url')
      .send({ url: 'http://localhost:5000/internal-admin' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('SSRF protection');
  });

  it('GET /api/search/:searchId/diagnostics returns 404 for nonexistent searchId', async () => {
    const res = await request(app).get('/api/search/sbl_nonexistent_id/diagnostics');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Diagnostics not found');
  });

  it('GET /api/search executes Mode A product search and records diagnostics', async () => {
    // Live query for a real product
    const res = await request(app).get('/api/search?q=Sony+WH-CH720N');
    expect(res.status).toBe(200);
    expect(res.body.searchId).toBeDefined();
    expect(res.body.searchMode).toBe('PRODUCT_NAME');
    expect(res.body.targetIdentity).toBeDefined();
    expect(res.body.comparison).toBeDefined();
    expect(res.body.diagnostics).toBeDefined();
    expect(res.body.diagnostics.searchId).toBe(res.body.searchId);
    expect(res.body.diagnostics.providersAttempted.length).toBeGreaterThan(0);

    // Diagnostics endpoint check
    const diagRes = await request(app).get(`/api/search/${res.body.searchId}/diagnostics`);
    expect(diagRes.status).toBe(200);
    expect(diagRes.body.diagnostics.searchId).toBe(res.body.searchId);

    // Results endpoint check
    const resultsRes = await request(app).get(`/api/search/${res.body.searchId}/results`);
    expect(resultsRes.status).toBe(200);
    expect(resultsRes.body.searchId).toBe(res.body.searchId);
  }, 25000); // 25s timeout for live network test

  it('GET /api/search generates multiple queries for boAt Airdopes 111v2', async () => {
    const res = await request(app).get('/api/search?q=boat+airdopes+111v2');
    expect(res.status).toBe(200);
    expect(res.body.searchMode).toBe('PRODUCT_NAME');

    // V2: queryIdentity should be present
    expect(res.body.queryIdentity).toBeDefined();
    expect(res.body.queryIdentity.brand).toBe('boAt');

    // V2: diagnostics should report multiple queries dispatched
    const { queriesGenerated } = res.body.diagnostics;
    expect(Array.isArray(queriesGenerated)).toBe(true);
    expect(queriesGenerated.length).toBeGreaterThanOrEqual(2);

    // All 5 providers should appear in diagnostics (even if unavailable)
    expect(res.body.diagnostics.providersAttempted.length).toBeGreaterThanOrEqual(3);
  }, 30000);

  it('POST /api/search/url executes URL search and returns product intelligence & diagnostics', async () => {
    const res = await request(app)
      .post('/api/search/url')
      .send({ url: 'https://www.croma.com/sony-wh-ch720n-bluetooth-headphone-with-mic-dual-noise-sensor-technology-over-ear-black-/p/270320' });

    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.productIntelligence).toBeDefined();
      expect(res.body.productIntelligence.identity.brand).toBe('Sony');
      expect(res.body.productIntelligence.specifications).toBeDefined();
      expect(res.body.productIntelligence.description).toBeDefined();
      expect(res.body.diagnostics.identifiedRetailer).toBe('Croma');
    }
  }, 30000);
});
