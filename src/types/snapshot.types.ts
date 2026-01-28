/**
 * Project status enumeration
 */
export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  ARCHIVED = 'ARCHIVED',
  DELETED = 'DELETED'
}

/**
 * Service configuration from snapshot
 */
export interface ServiceConfig {
  serviceName: string;
  enabled: boolean;
  endpoint: string;
  requiresAuth: boolean;
}

/**
 * Project configuration from snapshot
 */
export interface ProjectConfig {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  tenantId: string;
  allowedOrigins: string[];
  rateLimit: number;
  enabledServices: string[];
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  burstAllowance: number;
}

/**
 * Complete snapshot data structure
 */
export interface SnapshotData {
  version: number;
  timestamp: string;
  projects: Record<string, ProjectConfig>;
  services: Record<string, ServiceConfig>;
  rateLimits: Record<string, RateLimitConfig>;
}

/**
 * Snapshot API response
 */
export interface SnapshotResponse {
  success: boolean;
  data: SnapshotData | null;
  error: string | null;
}

/**
 * Snapshot cache entry
 */
export interface SnapshotCacheEntry {
  data: SnapshotData;
  fetchedAt: number;
  expiresAt: number;
  version: number;
}
