/**
 * Health status levels
 * - healthy: All systems operational
 * - degraded: Some systems experiencing issues but service is available
 * - unhealthy: Critical failures, service unavailable
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Individual dependency health check result
 */
export interface DependencyHealth {
  name: string;
  status: HealthStatus;
  latency?: number;
  error?: string;
}

/**
 * Overall health response
 */
export interface HealthResponse {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: string;
  dependencies: {
    database?: DependencyHealth;
    control_plane_api?: DependencyHealth;
  };
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  timeoutMs: number;
  cacheTtlMs: number;
}
