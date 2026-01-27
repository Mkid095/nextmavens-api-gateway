const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { Pool } = require('pg');
const { RateLimiterRedis } = require('rate-limiter-flexible');
const Redis = require('redis');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const helmet = require('helmet');
const axios = require('axios');
const http = require('http');
require('dotenv').config();

const app = express();
const router = express.Router();

// Configuration
const GATEWAY_PORT = process.env.GATEWAY_PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'nextmavens-gateway-secret';

// PostgreSQL connection
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://nextmavens:Elishiba@95@nextmavens-db-m4sxnf.1.mvuvh68efk7jnvynmv8r2jm2u:5432/nextmavens',
  max: 20
});

// Redis connection for rate limiting
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.connect().catch(console.error);

// Rate limiter using Redis
const rateLimiter = new RateLimiterRedis({
  storeClient: redisClient,
  keyPrefix: 'rate_limit',
  points: 100, // Number of requests
  duration: 60, // Per 60 seconds
});

// Service endpoints configuration
const SERVICES = {
  auth: {
    target: 'http://auth-service:4000',
    path: '/api/auth',
    publicPaths: ['/api/auth/signup', '/api/auth/login', '/api/auth/forgot-password']
  },
  rest: {
    target: 'http://nextmavens-postgrestapi-srrfw0-postgrest-1:3000',
    path: '/api',
    requiresAuth: true
  },
  graphql: {
    target: 'http://nextmavens-graphql:4004',
    path: '/graphql',
    requiresAuth: true
  },
  realtime: {
    target: 'http://nextmavens-realtime:4003',
    path: '/realtime',
    requiresAuth: true,
    isWebSocket: true
  },
  storage: {
    target: 'http://nextmavens-telegram-storage:4005',
    path: '/api/storage',
    requiresAuth: true
  },
  developer: {
    target: 'http://localhost:3006',
    path: '/api/developer',
    publicPaths: ['/api/developer/register', '/api/developer/login']
  }
};

// Middleware
app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: true, // Will be dynamically set based on project config
  credentials: true
}));

// Request logging middleware
app.use((req, res, next) => {
  const requestId = uuidv4();
  req.requestId = requestId;
  req.startTime = Date.now();

  console.log(`[${requestId}] ${req.method} ${req.path} - ${req.ip}`);

  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    console.log(`[${requestId}] ${res.statusCode} - ${duration}ms`);
  });

  next();
});

// API Key validation middleware
async function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] ||
                 req.query.api_key ||
                 req.body.api_key;

  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required',
      message: 'Please provide a valid API key via X-API-Key header'
    });
  }

  try {
    // Query the database for API key
    const result = await pgPool.query(`
      SELECT
        ak.id,
        ak.key_type,
        ak.scopes,
        ak.rate_limit,
        p.id as project_id,
        p.project_name,
        p.tenant_id,
        p.allowed_origins,
        d.id as developer_id,
        d.email as developer_email
      FROM api_keys ak
      JOIN projects p ON ak.project_id = p.id
      JOIN developers d ON p.developer_id = d.id
      WHERE ak.key_prefix || ak.key_hash = $1
        AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
        AND d.status = 'active'
        AND ak.revoked_at IS NULL
    `, [apiKey]);

    if (result.rows.length === 0) {
      await logRequest(req, res, { success: false, error: 'Invalid API key' });
      return res.status(401).json({
        error: 'Invalid API key',
        message: 'The provided API key is invalid or has been revoked'
      });
    }

    const keyData = result.rows[0];
    req.apiKey = keyData;
    req.projectId = keyData.project_id;
    req.tenantId = keyData.tenant_id;

    // Check if key type is appropriate for the request
    const isSecretKey = apiKey.startsWith('nm_live_sk_');
    const isClientSide = req.headers['user-agent']?.includes('Mozilla') ||
                        req.headers['referer']?.includes('http');

    if (isSecretKey && isClientSide) {
      await logRequest(req, res, { success: false, error: 'Secret key exposed on client' });
      return res.status(403).json({
        error: 'Secret key cannot be used on client side',
        message: 'Use your public key (nm_live_pk_) in client applications'
      });
    }

    // Check scopes
    const requiredScope = getRequiredScope(req.method, req.path);
    if (!keyData.scopes.includes(requiredScope) && !keyData.scopes.includes('*')) {
      await logRequest(req, res, { success: false, error: 'Insufficient scope' });
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `This operation requires '${requiredScope}' scope`
      });
    }

    // Apply rate limiting
    try {
      await rateLimiter.consume(apiKey);
    } catch (rejRes) {
      await logRequest(req, res, { success: false, error: 'Rate limit exceeded' });
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Limit: ${keyData.rate_limit || 100} per minute`,
        retryAfter: Math.round(rejRes.msBeforeNext / 1000)
      });
    }

    // Inject tenant context into headers for backend services
    req.headers['x-tenant-id'] = keyData.tenant_id;
    req.headers['x-project-id'] = keyData.project_id;
    req.headers['x-developer-id'] = keyData.developer_id;

    next();
  } catch (error) {
    console.error('[Gateway] API key validation error:', error);
    await logRequest(req, res, { success: false, error: error.message });
    return res.status(500).json({ error: 'API key validation failed' });
  }
}

function getRequiredScope(method, path) {
  if (method === 'GET') return 'read';
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') return 'write';
  if (method === 'DELETE') return 'delete';
  return 'read';
}

// Log request to database
async function logRequest(req, res, metadata = {}) {
  try {
    await pgPool.query(`
      INSERT INTO gateway_logs (
        request_id,
        project_id,
        developer_id,
        method,
        path,
        status_code,
        duration_ms,
        success,
        error_message,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      req.requestId,
      req.projectId || null,
      req.apiKey?.developer_id || null,
      req.method,
      req.path,
      res.statusCode,
      Date.now() - req.startTime,
      metadata.success !== false,
      metadata.error || null,
      req.ip,
      req.headers['user-agent']
    ]);
  } catch (error) {
    console.error('[Gateway] Failed to log request:', error);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'api-gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Gateway info endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'NextMavens API Gateway',
    version: '1.0.0',
    description: 'Central gateway for all NextMavens services',
    endpoints: {
      auth: '/api/auth/*',
      rest: '/api/*',
      graphql: '/graphql',
      realtime: '/realtime',
      storage: '/api/storage/*',
      developer: '/api/developer/*'
    },
    documentation: 'https://docs.nextmavens.cloud'
  });
});

// Service health check
app.get('/status/services', async (req, res) => {
  const services = {};

  for (const [name, config] of Object.entries(SERVICES)) {
    try {
      const response = await axios.get(`${config.target}/health`, { timeout: 2000 });
      services[name] = {
        status: 'healthy',
        target: config.target,
        responseTime: response.headers['x-response-time'] || 'N/A'
      };
    } catch (error) {
      services[name] = {
        status: 'unhealthy',
        target: config.target,
        error: error.message
      };
    }
  }

  res.json({ services });
});

// Create proxy for each service
for (const [serviceName, config] of Object.entries(SERVICES)) {
  // Check if this path should be public
  const isPublicPath = (path) => {
    return config.publicPaths?.some(publicPath => path.startsWith(publicPath));
  };

  // Create manual proxy handler using axios
  app.use(config.path, async (req, res, next) => {
    const fullPath = req.originalUrl || req.path;

    // Log request
    console.log(`[Gateway] Request to ${serviceName}: ${req.method} ${fullPath}`);

    // Check if this is a public path
    if (isPublicPath(fullPath)) {
      console.log(`[Gateway] Public path - skipping auth: ${fullPath}`);
    } else {
      console.log(`[Gateway] Protected path - validating API key: ${fullPath}`);
      // Validate API key for protected paths
      const apiKey = req.headers['x-api-key'] || req.query.api_key || req.body.api_key;
      if (!apiKey) {
        return res.status(401).json({
          error: 'API key required',
          message: 'Please provide a valid API key via X-API-Key header'
        });
      }
      // Note: Full API key validation would happen here
      // For now, just check presence and log the API key prefix
      console.log(`[Gateway] API key provided: ${apiKey.substring(0, 20)}...`);
    }

    // Build target URL
    const needsPathRewrite = serviceName !== 'auth';
    const targetPath = needsPathRewrite ? fullPath.replace(new RegExp(`^${config.path}`), '') : fullPath;
    const targetUrl = `${config.target}${targetPath}`;

    console.log(`[Gateway] Proxying to: ${targetUrl}`);

    try {
      // Forward request using axios (without streaming)
      const response = await axios({
        method: req.method,
        url: targetUrl,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          // Forward tenant context headers
          ...(req.headers['x-tenant-id'] && { 'x-tenant-id': req.headers['x-tenant-id'] }),
          ...(req.headers['x-project-id'] && { 'x-project-id': req.headers['x-project-id'] }),
          ...(req.headers['x-developer-id'] && { 'x-developer-id': req.headers['x-developer-id'] })
        },
        data: req.body,
        params: req.query,
        timeout: 30000,
        validateStatus: false, // Don't throw on error status codes
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      console.log(`[Gateway] ${serviceName} response: ${response.status}`);

      // Forward response headers
      Object.keys(response.headers).forEach(key => {
        if (['content-length', 'content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
          return; // Skip these headers
        }
        try {
          res.setHeader(key, response.headers[key]);
        } catch (e) {
          // Skip headers that can't be set
        }
      });

      // Send response
      res.status(response.status).send(response.data);
    } catch (error) {
      console.error(`[Gateway] Proxy error for ${serviceName}:`, error.message);

      if (error.code === 'ECONNREFUSED') {
        return res.status(503).json({
          error: 'Service Unavailable',
          service: serviceName,
          message: `${serviceName} service is not running`
        });
      }

      if (!res.headersSent) {
        res.status(502).json({
          error: 'Bad Gateway',
          service: serviceName,
          message: `Failed to reach ${serviceName} service: ${error.message}`
        });
      }
    }
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    availableEndpoints: Object.values(SERVICES).map(s => s.path)
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Gateway] Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Initialize database tables
async function initializeDatabase() {
  try {
    await pgPool.query(`
      -- Developers table
      CREATE TABLE IF NOT EXISTS developers (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        organization VARCHAR(255),
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Projects table
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        developer_id INTEGER REFERENCES developers(id),
        project_name VARCHAR(255) NOT NULL,
        tenant_id UUID REFERENCES tenants(id),
        allowed_origins TEXT[],
        webhook_url TEXT,
        rate_limit INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- API Keys table
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        key_type VARCHAR(10) NOT NULL CHECK (key_type IN ('public', 'secret')),
        key_prefix VARCHAR(20) NOT NULL,
        key_hash VARCHAR(255) UNIQUE NOT NULL,
        scopes TEXT[] DEFAULT ARRAY['read', 'write'],
        rate_limit INTEGER,
        last_used TIMESTAMP,
        expires_at TIMESTAMP,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Gateway logs table
      CREATE TABLE IF NOT EXISTS gateway_logs (
        id SERIAL PRIMARY KEY,
        request_id UUID,
        project_id INTEGER REFERENCES projects(id),
        developer_id INTEGER REFERENCES developers(id),
        method VARCHAR(10),
        path TEXT,
        status_code INTEGER,
        duration_ms INTEGER,
        success BOOLEAN DEFAULT true,
        error_message TEXT,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id);
      CREATE INDEX IF NOT EXISTS idx_gateway_logs_project ON gateway_logs(project_id);
      CREATE INDEX IF NOT EXISTS idx_gateway_logs_developer ON gateway_logs(developer_id);
      CREATE INDEX IF NOT EXISTS idx_gateway_logs_created ON gateway_logs(created_at);
    `);

    console.log('[Gateway] Database tables initialized');
  } catch (error) {
    console.error('[Gateway] Error initializing database:', error);
  }
}

// Start server
async function start() {
  await initializeDatabase();

  app.listen(GATEWAY_PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           NextMavens API Gateway / Supervisor                ║
╠══════════════════════════════════════════════════════════════╣
║  Port: ${GATEWAY_PORT}                                          ║
║  Status: Running                                            ║
║  Services Protected: ${Object.keys(SERVICES).length}                             ║
╠══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                 ║
${Object.entries(SERVICES).map(([name, config]) => `║  - ${name.padEnd(12)}: ${config.path.padEnd(20)} -> ${config.target}`).join('\n')}
╚══════════════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);

module.exports = { app, pgPool, redisClient };
