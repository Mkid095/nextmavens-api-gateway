/**
 * Snapshot Middleware Module
 * Centralized exports for all snapshot-related middleware
 *
 * This module has been split into smaller, focused modules:
 * - project.middleware.ts: Project validation logic
 * - service.middleware.ts: Service enablement checks
 * - health.middleware.ts: Health check endpoints
 * - validation.helpers.ts: Shared validation utilities
 */

// Project validation middleware
export {
  validateProjectFromRequest,
  validateProjectStatus
} from './project.middleware.js';

// Service validation middleware
export {
  validateServiceEnabled,
  validateProjectAndService
} from './service.middleware.js';

// Health check middleware
export {
  checkSnapshotHealth
} from './health.middleware.js';

// Validation helpers
export {
  GatewayErrorCode,
  sendErrorResponse,
  validateProjectStatusAndRespond
} from './validation.helpers.js';
