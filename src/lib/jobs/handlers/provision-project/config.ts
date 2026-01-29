/**
 * Provision Project Configuration
 *
 * Environment variable validation and configuration for provisioning operations.
 *
 * US-004: Implement Provision Project Job - Step 10: Security & Error Handling
 */

/**
 * Configuration validation error
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validated configuration for service endpoints
 */
export interface ServiceConfig {
  authServiceUrl: string;
  realtimeServiceUrl: string;
  storageServiceUrl: string;
  authServiceToken?: string;
  realtimeServiceToken?: string;
  storageServiceToken?: string;
}

/**
 * Validate URL format
 */
function validateUrl(url: string, fieldName: string): void {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ConfigError(`${fieldName} must use http or https protocol`, fieldName);
    }
  } catch {
    throw new ConfigError(`${fieldName} must be a valid URL`, fieldName);
  }
}

/**
 * Get and validate service configuration
 *
 * @returns Validated service configuration
 * @throws ConfigError if configuration is invalid
 */
export function getServiceConfig(): ServiceConfig {
  const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
  const realtimeServiceUrl = process.env.REALTIME_SERVICE_URL || 'http://localhost:3002';
  const storageServiceUrl = process.env.STORAGE_SERVICE_URL || 'http://localhost:3003';

  // Validate URL formats
  validateUrl(authServiceUrl, 'AUTH_SERVICE_URL');
  validateUrl(realtimeServiceUrl, 'REALTIME_SERVICE_URL');
  validateUrl(storageServiceUrl, 'STORAGE_SERVICE_URL');

  // Get optional service authentication tokens
  // These tokens should be set via environment variables for service-to-service authentication
  const authServiceToken = process.env.AUTH_SERVICE_TOKEN;
  const realtimeServiceToken = process.env.REALTIME_SERVICE_TOKEN;
  const storageServiceToken = process.env.STORAGE_SERVICE_TOKEN;

  return {
    authServiceUrl,
    realtimeServiceUrl,
    storageServiceUrl,
    authServiceToken,
    realtimeServiceToken,
    storageServiceToken,
  };
}

/**
 * Validate database configuration
 *
 * @returns Database configuration
 * @throws ConfigError if configuration is invalid
 */
export function getDatabaseConfig(): {
  host: string;
  port: number;
} {
  const host = process.env.AUDIT_LOGS_DB_HOST || 'localhost';
  const portStr = process.env.AUDIT_LOGS_DB_PORT || '5432';

  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new ConfigError('AUDIT_LOGS_DB_PORT must be a valid port number (1-65535)', 'AUDIT_LOGS_DB_PORT');
  }

  return { host, port };
}

/**
 * Validate all required configuration on module load
 * This will throw during initialization if configuration is invalid
 */
export function validateConfig(): void {
  try {
    getServiceConfig();
    getDatabaseConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`[ConfigError] ${error.field}: ${error.message}`);
      throw error;
    }
    throw error;
  }
}
