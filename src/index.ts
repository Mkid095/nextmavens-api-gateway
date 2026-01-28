import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createSnapshotService, getSnapshotService } from '@/snapshot/snapshot.service.js';
import { checkSnapshotHealth } from '@/snapshot/snapshot.middleware.js';
import {
  validateProjectStatus,
  requireActiveProject,
  attachProjectData,
  type ValidatedRequest
} from '@/validation/middleware/project-status.middleware.js';
import { enforceRateLimit } from '@/rate-limit/middleware/index.js';
import { ApiError, ApiErrorCode } from '@/api/middleware/error.handler.js';
import {
  requireJwtAuth,
  optionalJwtAuth,
  extractProjectIdFromJwt
} from '@/api/middleware/jwt.middleware.js';
import {
  correlationMiddleware,
  formatLogWithCorrelation
} from '@/api/middleware/correlation.middleware.js';
import { requestLoggerMiddleware } from '@/api/middleware/request-logger.middleware.js';
import { durationTrackingMiddleware } from '@/duration/index.js';
import { createHealthCheckService, getHealthCheckService } from '@/health/index.js';

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

// Correlation ID middleware (US-006)
// Must be applied early in the middleware chain to ensure all requests have a correlation ID
app.use(correlationMiddleware);

// Duration tracking middleware (US-009)
// Tracks request duration for performance monitoring
// Applied after correlation middleware to ensure correlation_id exists
// Applied before routes to track all requests
// Non-blocking operation - records asynchronously
app.use(durationTrackingMiddleware);

// Rate limiting to prevent abuse and project enumeration
const validationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    const error = ApiError.rateLimited();
    res.status(error.statusCode).json(error.toJSON());
  }
});

// Health check endpoint (US-010)
// Enhanced health check with dependency monitoring
// Returns 503 if any critical dependency is unhealthy (fail-closed)
app.get('/health', async (_req, res) => {
  try {
    const healthService = getHealthCheckService();

    if (!healthService) {
      const error = new ApiError(
        ApiErrorCode.SERVICE_UNAVAILABLE,
        'Health check service not available',
        503,
        true
      );
      return res.status(error.statusCode).json(error.toJSON());
    }

    const health = await healthService.getHealth();

    // Return appropriate HTTP status based on health status
    const statusCode = health.status === 'unhealthy' ? 503 :
                       health.status === 'degraded' ? 200 : 200;

    return res.status(statusCode).json(health);
  } catch (error) {
    const apiError = new ApiError(
      ApiErrorCode.INTERNAL_ERROR,
      error instanceof Error ? error.message : 'Health check failed',
      500,
      false
    );
    return res.status(apiError.statusCode).json(apiError.toJSON());
  }
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
// Protected Routes - JWT Authentication (US-005)
// ============================================================================

/**
 * Route: GET /api/jwt/protected
 * Description: JWT-protected endpoint with project validation
 * Requires: Bearer token in Authorization header with project_id claim
 *
 * SECURITY: Rate limited to prevent abuse
 * This endpoint demonstrates JWT authentication integration
 * JWT middleware extracts project_id from token claim
 * Project status validation ensures only active projects can access
 * Enforces project-specific rate limits from snapshot
 *
 * MIDDLEWARE CHAIN ORDER (US-008):
 * 1. validationLimiter - Rate limiting
 * 2. enforceRateLimit - Project-specific rate limits
 * 3. requireJwtAuth - JWT authentication
 * 4. extractProjectIdFromJwt - Extract project_id from JWT
 * 5. validateProjectStatus - Validate project status
 * 6. requestLoggerMiddleware - Log request with project_id (US-008)
 */
app.get('/api/jwt/protected', validationLimiter, enforceRateLimit, requireJwtAuth, extractProjectIdFromJwt, validateProjectStatus, requestLoggerMiddleware, async (req: ValidatedRequest, res) => {
  const snapshotService = getSnapshotService();

  if (!snapshotService) {
    const error = ApiError.snapshotUnavailable('Snapshot service not available');
    return res.status(error.statusCode).json(error.toJSON());
  }

  try {
    const snapshot = snapshotService.getSnapshot();
    return res.json({
      message: 'This endpoint is protected by JWT authentication and project validation',
      authentication: {
        method: 'JWT',
        projectId: req.projectId,
        jwtPayload: req.jwtPayload
      },
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
    const apiError = ApiError.snapshotUnavailable(error instanceof Error ? error.message : 'Snapshot unavailable');
    return res.status(apiError.statusCode).json(apiError.toJSON());
  }
});

/**
 * Route: POST /api/jwt/data
 * Description: JWT-protected data endpoint with project validation
 * Requires: Bearer token with project_id claim
 *
 * SECURITY: Rate limited to prevent abuse
 * Demonstrates JWT authentication for data operations
 * Enforces project-specific rate limits from snapshot
 *
 * MIDDLEWARE CHAIN ORDER (US-008):
 * 1. validationLimiter - Rate limiting
 * 2. enforceRateLimit - Project-specific rate limits
 * 3. requireJwtAuth - JWT authentication
 * 4. extractProjectIdFromJwt - Extract project_id from JWT
 * 5. validateProjectStatus - Validate project status
 * 6. requestLoggerMiddleware - Log request with project_id (US-008)
 */
app.post('/api/jwt/data', validationLimiter, enforceRateLimit, requireJwtAuth, extractProjectIdFromJwt, validateProjectStatus, requestLoggerMiddleware, async (req: ValidatedRequest, res) => {
  res.json({
    message: 'Data received successfully via JWT authentication',
    authentication: {
      method: 'JWT',
      projectId: req.projectId,
      issuer: req.jwtPayload?.iss,
      audience: req.jwtPayload?.aud
    },
    timestamp: new Date().toISOString(),
    data: req.body
  });
});

/**
 * Route: GET /api/jwt/status
 * Description: Check JWT authentication status
 *
 * This endpoint optionally validates JWT but doesn't reject if missing
 * Useful for checking authentication status and token validity
 */
app.get('/api/jwt/status', optionalJwtAuth, async (req: ValidatedRequest, res) => {
  if (req.projectId && req.jwtPayload) {
    return res.json({
      authenticated: true,
      projectId: req.projectId,
      issuer: req.jwtPayload.iss,
      audience: req.jwtPayload.aud,
      expiresAt: req.jwtPayload.exp ? new Date(req.jwtPayload.exp * 1000).toISOString() : undefined
    });
  }

  return res.json({
    authenticated: false,
    message: 'No valid JWT token provided',
    hint: 'Include Bearer token in Authorization header to authenticate'
  });
});

// ============================================================================
// Protected Routes - Project Status Validation (Header-based)
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
 *
 * MIDDLEWARE CHAIN ORDER (US-008):
 * 1. validationLimiter - Rate limiting
 * 2. enforceRateLimit - Project-specific rate limits
 * 3. validateProjectStatus - Validate project status (sets req.project)
 * 4. requestLoggerMiddleware - Log request with project_id (US-008)
 */
app.get('/api/protected', validationLimiter, enforceRateLimit, validateProjectStatus, requestLoggerMiddleware, async (req: ValidatedRequest, res) => {
  const snapshotService = getSnapshotService();

  if (!snapshotService) {
    const error = ApiError.snapshotUnavailable('Snapshot service not available');
    return res.status(error.statusCode).json(error.toJSON());
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
    const apiError = ApiError.snapshotUnavailable(error instanceof Error ? error.message : 'Snapshot unavailable');
    return res.status(apiError.statusCode).json(apiError.toJSON());
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
 *
 * MIDDLEWARE CHAIN ORDER (US-008):
 * 1. validationLimiter - Rate limiting
 * 2. enforceRateLimit - Project-specific rate limits
 * 3. validateProjectStatus - Validate project status (sets req.project)
 * 4. requestLoggerMiddleware - Log request with project_id (US-008)
 */
app.post('/api/data', validationLimiter, enforceRateLimit, validateProjectStatus, requestLoggerMiddleware, async (req: ValidatedRequest, res) => {
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
 *
 * MIDDLEWARE CHAIN ORDER (US-008):
 * 1. validationLimiter - Rate limiting
 * 2. enforceRateLimit - Project-specific rate limits
 * 3. requireActiveProject - Require active project
 * 4. requestLoggerMiddleware - Log request with project_id (US-008)
 */
app.get('/api/strict', validationLimiter, enforceRateLimit, requireActiveProject, requestLoggerMiddleware, async (req: ValidatedRequest, res) => {
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
    const error = ApiError.snapshotUnavailable('Snapshot service not available');
    return res.status(error.statusCode).json(error.toJSON());
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
    const apiError = ApiError.snapshotUnavailable(error instanceof Error ? error.message : 'Snapshot unavailable');
    return res.status(apiError.statusCode).json(apiError.toJSON());
  }
});

// 404 handler
app.use((req, res) => {
  const error = new ApiError(
    ApiErrorCode.NOT_FOUND,
    `Cannot ${req.method} ${req.path}`,
    404,
    false
  );
  res.status(error.statusCode).json(error.toJSON());
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(formatLogWithCorrelation(req, `[Gateway] Error: ${err.message}`));

  // Handle ApiError instances with proper formatting
  if (err instanceof ApiError) {
    const errorResponse = err.toJSON();
    return res.status(err.statusCode).json(errorResponse);
  }

  // Handle generic errors
  const apiError = new ApiError(
    ApiErrorCode.INTERNAL_ERROR,
    err.message,
    500,
    false
  );
  return res.status(apiError.statusCode).json(apiError.toJSON());
});

/**
 * Start the gateway server
 */
async function start(): Promise<void> {
  console.log('[Gateway] Starting API Gateway...');

  try {
    // Initialize health check service
    console.log('[Gateway] Initializing health check service...');
    createHealthCheckService();
    console.log('[Gateway] Health check service initialized successfully');

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
║  ✓ Dependency health monitoring                           ║
║  ✓ JWT authentication with project_id extraction          ║
║  ✓ Project status validation                              ║
║  ✓ Service enablement checks                              ║
║  ✓ Rate limiting enforcement                              ║
║  ✓ Centralized error handling                             ║
╠══════════════════════════════════════════════════════════════╣
║  Public Endpoints:                                         ║
║  GET  /health          - Enhanced health check with deps   ║
║  GET  /health/snapshot - Snapshot service status          ║
║  GET  /                - Gateway information               ║
╠══════════════════════════════════════════════════════════════╣
║  JWT-Protected Endpoints (require Bearer token):          ║
║  GET  /api/jwt/protected - JWT + project validation       ║
║  POST /api/jwt/data      - JWT-protected data endpoint    ║
║  GET  /api/jwt/status    - Check JWT status (optional)    ║
╠══════════════════════════════════════════════════════════════╣
║  Header-Protected Endpoints (require x-project-id):       ║
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
