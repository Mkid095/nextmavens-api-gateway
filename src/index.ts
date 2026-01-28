import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { createSnapshotService, getSnapshotService } from '@/snapshot/snapshot.service.js';
import { checkSnapshotHealth } from '@/snapshot/snapshot.middleware.js';
import {
  validateProjectStatus,
  requireActiveProject,
  attachProjectData,
  type ValidatedRequest
} from '@/validation/middleware/project-status.middleware.js';
import { enforceRateLimit } from '@/rate-limit/middleware/index.js';
import { ApiError } from '@/api/middleware/error.handler.js';

const app = express();
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '8080', 10);

// Parse allowed origins from environment
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];

// Middleware
app.use(helmet({
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"]
    }
  },
  noSniff: true,
  xssFilter: true
}));
app.use(express.json());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    // Check against allowed origins
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Rate limiting to prevent abuse and project enumeration
const validationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down.',
        retryable: true
      }
    });
  }
});

// Request logging middleware
app.use((_req, res, next) => {
  const startTime = Date.now();
  const requestId = _req.headers['x-request-id'] as string || randomUUID();

  _req.headers['x-request-id'] = requestId;

  console.log(`[${requestId}] ${_req.method} ${_req.path}`);

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`[${requestId}] ${res.statusCode} - ${duration}ms`);
  });

  next();
});

// Health check endpoint
app.get('/health', (_req, res) => {
  const snapshotService = getSnapshotService();
  const snapshotStats = snapshotService ? snapshotService.getCacheStats() : null;

  res.json({
    status: 'ok',
    service: 'api-gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    snapshot: snapshotStats
  });
});

// Snapshot health check endpoint
app.get('/health/snapshot', checkSnapshotHealth);

// Gateway info endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'NextMavens API Gateway',
    version: '1.0.0',
    description: 'Central gateway for all NextMavens services with snapshot-based enforcement',
    features: [
      'Snapshot-based configuration',
      'Project status validation',
      'Service enablement checks',
      'Rate limiting enforcement',
      'Fail-closed security'
    ],
    documentation: 'https://docs.nextmavens.cloud'
  });
});

// ============================================================================
// Protected Routes - Project Status Validation
// ============================================================================

/**
 * Route: GET /api/protected
 * Description: Protected endpoint that validates project status
 * Requires: x-project-id header (NOT query parameter - security)
 *
 * SECURITY: Rate limited to prevent project enumeration attacks
 * This endpoint uses the new validation middleware from Step 2
 * It will reject requests from suspended, archived, or deleted projects
 * Enforces project-specific rate limits from snapshot
 */
app.get('/api/protected', validationLimiter, enforceRateLimit, validateProjectStatus, async (req: ValidatedRequest, res) => {
  const snapshotService = getSnapshotService();

  if (!snapshotService) {
    return res.status(503).json({
      error: {
        code: 'SNAPSHOT_UNAVAILABLE',
        message: 'Snapshot service not available',
        retryable: true
      }
    });
  }

  try {
    const snapshot = snapshotService.getSnapshot();
    return res.json({
      message: 'This endpoint is protected by project status validation',
      project: {
        id: req.project?.id,
        status: 'ACTIVE',
        validated: true
      },
      snapshotVersion: snapshot.version,
      projectCount: Object.keys(snapshot.projects).length,
      serviceCount: Object.keys(snapshot.services).length
    });
  } catch (error) {
    return res.status(503).json({
      error: {
        code: 'SNAPSHOT_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Snapshot unavailable',
        retryable: true
      }
    });
  }
});

/**
 * Route: POST /api/data
 * Description: Example data endpoint with project validation
 * Requires: x-project-id header
 *
 * SECURITY: Rate limited to prevent abuse
 * This demonstrates a more realistic use case where only active projects
 * can POST data to the gateway
 * Enforces project-specific rate limits from snapshot
 */
app.post('/api/data', validationLimiter, enforceRateLimit, validateProjectStatus, async (req: ValidatedRequest, res) => {
  res.json({
    message: 'Data received successfully',
    projectId: req.project?.id,
    timestamp: new Date().toISOString(),
    data: req.body
  });
});

/**
 * Route: GET /api/status
 * Description: Get project status information (with optional validation)
 *
 * This endpoint optionally validates project status but doesn't reject
 * if validation fails - useful for checking why a project can't access resources
 */
app.get('/api/status', attachProjectData, async (req: ValidatedRequest, res) => {
  if (req.project) {
    const snapshotService = getSnapshotService();
    const projectData = snapshotService?.getProject(req.project.id);

    return res.json({
      projectId: req.project.id,
      exists: !!projectData,
      status: projectData?.status || 'UNKNOWN',
      canAccess: projectData?.status === 'ACTIVE'
    });
  }

  return res.json({
    message: 'No project ID provided',
    hint: 'Include x-project-id header to check project status'
  });
});

/**
 * Route: GET /api/strict
 * Description: Strict validation endpoint - only active projects allowed
 *
 * SECURITY: Rate limited to prevent abuse
 * This uses requireActiveProject middleware which provides a second
 * validation approach with slightly different error handling
 * Enforces project-specific rate limits from snapshot
 */
app.get('/api/strict', validationLimiter, enforceRateLimit, requireActiveProject, async (req: ValidatedRequest, res) => {
  res.json({
    message: 'Access granted - project is active',
    projectId: req.project?.id,
    validated: true,
    timestamp: new Date().toISOString()
  });
});

// Example protected endpoint using snapshot validation
// This demonstrates how to use the snapshot middleware
app.get('/api/legacy', async (_req, res) => {
  const snapshotService = getSnapshotService();

  if (!snapshotService) {
    return res.status(503).json({
      error: {
        code: 'SNAPSHOT_UNAVAILABLE',
        message: 'Snapshot service not available',
        retryable: true
      }
    });
  }

  try {
    const snapshot = snapshotService.getSnapshot();
    return res.json({
      message: 'This endpoint is protected by snapshot validation',
      snapshotVersion: snapshot.version,
      projectCount: Object.keys(snapshot.projects).length,
      serviceCount: Object.keys(snapshot.services).length
    });
  } catch (error) {
    return res.status(503).json({
      error: {
        code: 'SNAPSHOT_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Snapshot unavailable',
        retryable: true
      }
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
      retryable: false
    }
  });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Gateway] Error:', err);

  // Handle ApiError instances with proper formatting
  if (err instanceof ApiError) {
    const errorResponse = err.toJSON();
    return res.status(err.statusCode).json(errorResponse);
  }

  // Handle generic errors
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message,
      retryable: false
    }
  });
});

/**
 * Start the gateway server
 */
async function start(): Promise<void> {
  console.log('[Gateway] Starting API Gateway...');

  try {
    // Initialize snapshot service
    console.log('[Gateway] Initializing snapshot service...');
    const snapshotService = createSnapshotService();
    await snapshotService.initialize();

    console.log('[Gateway] Snapshot service initialized successfully');

    // Start HTTP server
    app.listen(GATEWAY_PORT, () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║           NextMavens API Gateway / Supervisor                ║
╠══════════════════════════════════════════════════════════════╣
║  Port: ${GATEWAY_PORT.toString().padEnd(52)}║
║  Status: Running${' '.repeat(43)}║
║  Mode: Snapshot-Based Enforcement${' '.repeat(26)}║
╠══════════════════════════════════════════════════════════════╣
║  Features:                                                 ║
║  ✓ Snapshot consumption with 30s TTL                      ║
║  ✓ Background refresh                                     ║
║  ✓ Fail-closed security                                   ║
║  ✓ Project status validation                              ║
║  ✓ Service enablement checks                              ║
║  ✓ Rate limiting enforcement (Step 7 integrated)          ║
║  ✓ Centralized error handling                             ║
╠══════════════════════════════════════════════════════════════╣
║  Public Endpoints:                                         ║
║  GET  /health          - Gateway health check              ║
║  GET  /health/snapshot - Snapshot service status          ║
║  GET  /                - Gateway information               ║
╠══════════════════════════════════════════════════════════════╣
║  Protected Endpoints (require x-project-id):              ║
║  GET  /api/protected   - Project status validation        ║
║  POST /api/data         - Data endpoint with validation   ║
║  GET  /api/status       - Check project status            ║
║  GET  /api/strict       - Strict active project check     ║
╚══════════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('[Gateway] Failed to start:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Gateway] SIGTERM received, shutting down gracefully...');
  const snapshotService = getSnapshotService();
  if (snapshotService) {
    snapshotService.stop();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Gateway] SIGINT received, shutting down gracefully...');
  const snapshotService = getSnapshotService();
  if (snapshotService) {
    snapshotService.stop();
  }
  process.exit(0);
});

// Start the server
start().catch((error) => {
  console.error('[Gateway] Fatal error during startup:', error);
  process.exit(1);
});
