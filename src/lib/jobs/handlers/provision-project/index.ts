/**
 * Provision Project Module
 *
 * Exports all provisioning-related functionality for project creation.
 *
 * US-004: Implement Provision Project Job - Step 10: Security & Error Handling
 */

export {
  createTenantDatabase,
  createTenantSchema,
} from './database.js';

export {
  registerAuthService,
  registerRealtimeService,
  registerStorageService,
} from './services.js';

export {
  generateApiKeys,
} from './api-keys.js';

export type {
  ProvisionProjectPayload,
  ProvisionProjectMetadata,
} from './types.js';

export {
  validateProvisionProjectPayload,
  ProvisioningError,
} from './types.js';

export {
  getServiceConfig,
  getDatabaseConfig,
  validateConfig,
  ConfigError,
} from './config.js';
