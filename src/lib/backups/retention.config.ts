/**
 * Backup Retention Configuration
 *
 * Centralized configuration for backup retention policy.
 * Settings can be overridden via environment variables.
 *
 * US-010: Backup Retention Policy - Step 1: Foundation
 *
 * Environment Variables:
 * - BACKUP_RETENTION_DAYS: Default retention period in days (default: 30)
 * - BACKUP_NOTIFICATION_DAYS: Days before expiration to notify (default: 7)
 * - BACKUP_CLEANUP_ENABLED: Enable/disable cleanup (default: true)
 * - BACKUP_CLEANUP_INTERVAL_HOURS: Cleanup interval in hours (default: 24)
 * - BACKUP_CLEANUP_BATCH_SIZE: Number of backups to process per batch (default: 100)
 * - BACKUP_MAX_CLEANUP_RETRIES: Maximum cleanup retry attempts (default: 3)
 */

import type { RetentionConfig } from './retention.types.js';
import { DEFAULT_RETENTION_CONFIG } from './retention.types.js';

/**
 * Parse boolean environment variable
 */
function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.toLowerCase().trim();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  console.warn(`Invalid boolean value for environment variable: ${value}. Using default: ${defaultValue}`);
  return defaultValue;
}

/**
 * Parse integer environment variable with validation
 */
function parseIntEnv(
  value: string | undefined,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);

  if (isNaN(parsed)) {
    console.warn(`Invalid integer value for environment variable: ${value}. Using default: ${defaultValue}`);
    return defaultValue;
  }

  if (min !== undefined && parsed < min) {
    console.warn(`Environment variable value ${parsed} is below minimum ${min}. Using minimum.`);
    return min;
  }

  if (max !== undefined && parsed > max) {
    console.warn(`Environment variable value ${parsed} is above maximum ${max}. Using maximum.`);
    return max;
  }

  return parsed;
}

/**
 * Get retention configuration from environment variables
 *
 * Loads configuration from environment variables with fallback to defaults.
 * Validates all values and applies min/max constraints.
 *
 * @returns Retention configuration
 */
export function getRetentionConfigFromEnv(): RetentionConfig {
  return {
    defaultRetentionDays: parseIntEnv(
      process.env.BACKUP_RETENTION_DAYS,
      DEFAULT_RETENTION_CONFIG.defaultRetentionDays,
      1,
      365
    ),

    notificationDays: parseIntEnv(
      process.env.BACKUP_NOTIFICATION_DAYS,
      DEFAULT_RETENTION_CONFIG.notificationDays,
      1,
      30
    ),

    cleanupEnabled: parseBooleanEnv(
      process.env.BACKUP_CLEANUP_ENABLED,
      DEFAULT_RETENTION_CONFIG.cleanupEnabled
    ),

    cleanupIntervalHours: parseIntEnv(
      process.env.BACKUP_CLEANUP_INTERVAL_HOURS,
      DEFAULT_RETENTION_CONFIG.cleanupIntervalHours,
      1,
      168
    ),

    maxCleanupRetries: parseIntEnv(
      process.env.BACKUP_MAX_CLEANUP_RETRIES,
      DEFAULT_RETENTION_CONFIG.maxCleanupRetries,
      1,
      10
    ),

    cleanupBatchSize: parseIntEnv(
      process.env.BACKUP_CLEANUP_BATCH_SIZE,
      DEFAULT_RETENTION_CONFIG.cleanupBatchSize,
      1,
    1000
    ),

    notificationChannels: DEFAULT_RETENTION_CONFIG.notificationChannels,

    hardDelete: DEFAULT_RETENTION_CONFIG.hardDelete,
  };
}

/**
 * Validate that notification period is less than retention period
 */
export function validateRetentionConfig(config: RetentionConfig): void {
  if (config.notificationDays >= config.defaultRetentionDays) {
    throw new Error(
      `Notification period (${config.notificationDays} days) must be less than retention period (${config.defaultRetentionDays} days)`
    );
  }
}

/**
 * Get the current retention configuration
 *
 * This is the main export that should be used throughout the application.
 * It loads configuration from environment variables with fallback to defaults.
 *
 * @returns Validated retention configuration
 */
export function getConfig(): RetentionConfig {
  const config = getRetentionConfigFromEnv();
  validateRetentionConfig(config);
  return config;
}

/**
 * Export default configuration for easy import
 */
export const config = getConfig();

/**
 * Export individual configuration values for convenience
 */
export const RETENTION_DAYS = config.defaultRetentionDays;
export const NOTIFICATION_DAYS = config.notificationDays;
export const CLEANUP_ENABLED = config.cleanupEnabled;
export const CLEANUP_INTERVAL_HOURS = config.cleanupIntervalHours;
export const CLEANUP_BATCH_SIZE = config.cleanupBatchSize;
export const MAX_CLEANUP_RETRIES = config.maxCleanupRetries;
