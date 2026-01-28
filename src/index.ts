import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createSnapshotService, getSnapshotService } from './snapshot/snapshot.service.js';
import { checkSnapshotHealth } from './snapshot/snapshot.middleware.js';

const app = express();
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '8080', 10);

// Middleware
app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: true,
  credentials: true
}));

// Request logging middleware
app.use((_req, res, next) => {
  const startTime = Date.now();
  const requestId = _req.headers['x-request-id'] || `req-${Date.now()}-${Math.random()}`;

  _req.headers['x-request-id'] = requestId as string;

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

// Example protected endpoint using snapshot validation
// This demonstrates how to use the snapshot middleware
app.get('/api/protected', async (_req, res) => {
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
  res.status(500).json({
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
╠══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                ║
║  GET  /health          - Gateway health check              ║
║  GET  /health/snapshot - Snapshot service status          ║
║  GET  /                - Gateway information               ║
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
