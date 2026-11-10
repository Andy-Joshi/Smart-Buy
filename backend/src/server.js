import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { providerRegistry } from './services/providers/providerRegistry.js';
import { searchCoordinator } from './services/searchCoordinator.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5174';

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin || origin === CORS_ORIGIN || origin.startsWith('http://localhost:')) {
        return callback(null, true);
      }
      return callback(null, true); // Permissive for local dev
    },
  })
);

app.use(express.json({ limit: '1mb' }));

// Simple in-memory rate limiter
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const clientData = rateLimits.get(ip) || { count: 0, windowStart: now };

  if (now - clientData.windowStart > RATE_LIMIT_WINDOW_MS) {
    clientData.count = 1;
    clientData.windowStart = now;
  } else {
    clientData.count++;
  }

  rateLimits.set(ip, clientData);

  if (clientData.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Please wait before making further requests.',
      retryAfterSeconds: Math.ceil((clientData.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000),
    });
  }

  next();
}

app.use(rateLimiter);

/**
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  const providersHealth = providerRegistry.getHealthSummary();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    service: 'Smart Buy Lab Comparison Engine',
    providers: providersHealth,
  });
});

/**
 * GET /api/providers
 */
app.get('/api/providers', (req, res) => {
  const providers = providerRegistry.getHealthSummary();
  res.json({
    count: providers.length,
    providers,
  });
});

/**
 * GET /api/search?q=product-name
 */
app.get('/api/search', async (req, res) => {
  const query = req.query.q;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({
      error: 'Query parameter "q" is required and must not be empty.',
    });
  }

  if (query.trim().length > 200) {
    return res.status(400).json({
      error: 'Query is too long (maximum 200 characters).',
    });
  }

  try {
    const result = await searchCoordinator.searchByProductName(query.trim());
    res.json(result);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({
      error: 'Internal search engine error',
      message: err.message,
    });
  }
});

/**
 * POST /api/search/url
 */
app.post('/api/search/url', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return res.status(400).json({
      error: 'Body parameter "url" is required and must be a valid URL string.',
    });
  }

  try {
    const result = await searchCoordinator.searchByProductUrl(url.trim());
    if (!result.success && result.diagnostics && result.diagnostics.status === 'BLOCKED_INVALID_URL') {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('URL Search error:', err);
    res.status(500).json({
      error: 'Internal URL search error',
      message: err.message,
    });
  }
});

/**
 * GET /api/search/:searchId/diagnostics
 */
app.get('/api/search/:searchId/diagnostics', (req, res) => {
  const { searchId } = req.params;
  const data = searchCoordinator.getSearch(searchId);

  if (!data) {
    return res.status(404).json({
      error: `Diagnostics not found for search ID: ${searchId}`,
    });
  }

  res.json({
    searchId,
    diagnostics: data.diagnostics,
  });
});

/**
 * GET /api/search/:searchId/results
 */
app.get('/api/search/:searchId/results', (req, res) => {
  const { searchId } = req.params;
  const data = searchCoordinator.getSearch(searchId);

  if (!data) {
    return res.status(404).json({
      error: `Search results not found for search ID: ${searchId}`,
    });
  }

  res.json(data);
});

// Central error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
  });
});

// Only listen if not imported in tests
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[Smart Buy Lab] Server running on http://localhost:${PORT}`);
  });
}

export default app;
