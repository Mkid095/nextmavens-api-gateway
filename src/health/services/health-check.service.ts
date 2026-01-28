import { getSnapshotService } from '@/snapshot/snapshot.service.js';
import type {
  HealthStatus,
  HealthResponse,
  DependencyHealth,
  HealthCheckConfig
} from '../types/health.types.js';

/**
 * Default health check configuration
 */
const DEFAULT_CONFIG: HealthCheckConfig = {
  timeoutMs: 5000,
  cacheTtlMs: 10000
};

/**
 * Health check service monitors the health of the gateway and its dependencies
 *
 * Checks:
 * - Control plane API: Snapshot service availability
 * - Database: Redis connection (not currently used, always healthy)
 *
 * The service uses caching to avoid overwhelming dependencies with health checks
 */
export class HealthCheckService {
  private config: HealthCheckConfig;
  private cachedHealth: HealthResponse | null = null;
  private cacheExpiry: number = 0;

  constructor(config?: Partial<HealthCheckConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the current health status
   * Returns cached result if available and not expired
   */
  async getHealth(): Promise<HealthResponse> {
    const now = Date.now();

    if (this.cachedHealth && now < this.cacheExpiry) {
      return this.cachedHealth;
    }

    const healthResponse = await this.performHealthChecks();

    this.cachedHealth = healthResponse;
    this.cacheExpiry = now + this.config.cacheTtlMs;

    return healthResponse;
  }

  /**
   * Perform health checks on all dependencies
   */
  private async performHealthChecks(): Promise<HealthResponse> {
    const dependencies: {
      database?: DependencyHealth;
      control_plane_api?: DependencyHealth;
    } = {};

    // Check control plane API (snapshot service)
    const controlPlaneHealth = await this.checkControlPlaneApi();
    dependencies.control_plane_api = controlPlaneHealth;

    // Check database (Redis - not currently used in rate limiting)
    // The rate limit validator uses in-memory storage, not Redis
    // So we mark it as healthy since it's not a dependency
    dependencies.database = {
      name: 'database',
      status: 'healthy',
      latency: 0
    };

    // Calculate overall health status
    const overallStatus = this.calculateOverallStatus(dependencies);

    return {
      status: overallStatus,
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      dependencies
    };
  }

  /**
   * Check control plane API health via snapshot service
   */
  private async checkControlPlaneApi(): Promise<DependencyHealth> {
    const startTime = Date.now();

    try {
      // Wrap with timeout to prevent hanging health checks
      const healthResult = await Promise.race([
        this.performControlPlaneCheck(),
        new Promise<DependencyHealth>((resolve) =>
          setTimeout(() => {
            resolve({
              name: 'control_plane_api',
              status: 'unhealthy',
              latency: this.config.timeoutMs,
              error: 'Connection timeout' // Generic error message
            });
          }, this.config.timeoutMs)
        )
      ]);

      return healthResult;
    } catch (error) {
      const latency = Date.now() - startTime;
      // Log detailed error for monitoring
      console.error('[HealthCheck] Control plane check failed:', error instanceof Error ? error.message : 'Unknown error');
      // Return generic error to prevent information leakage
      return {
        name: 'control_plane_api',
        status: 'unhealthy',
        latency,
        error: 'Service unavailable' // Generic error message
      };
    }
  }

  /**
   * Perform the actual control plane health check
   */
  private async performControlPlaneCheck(): Promise<DependencyHealth> {
    const startTime = Date.now();

    try {
      const snapshotService = getSnapshotService();

      if (!snapshotService) {
        return {
          name: 'control_plane_api',
          status: 'unhealthy',
          error: 'Service unavailable' // Generic error message
        };
      }

      // Try to get cache stats to verify service is working
      const cacheStats = snapshotService.getCacheStats();

      // If no cached data and expired, service might be degraded
      if (!cacheStats.hasCachedData || cacheStats.isExpired) {
        const latency = Date.now() - startTime;
        // Use generic error messages to prevent information leakage
        return {
          name: 'control_plane_api',
          status: 'degraded',
          latency,
          error: 'Data stale' // Generic message, doesn't reveal internal details
        };
      }

      const latency = Date.now() - startTime;
      return {
        name: 'control_plane_api',
        status: 'healthy',
        latency
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      // Log detailed error for monitoring
      console.error('[HealthCheck] Control plane check error:', error instanceof Error ? error.message : 'Unknown error');
      // Return generic error to prevent information leakage
      return {
        name: 'control_plane_api',
        status: 'unhealthy',
        latency,
        error: 'Check failed' // Generic error message
      };
    }
  }

  /**
   * Calculate overall health status from dependency checks
   * Returns unhealthy if any dependency is unhealthy
   * Returns degraded if any dependency is degraded but none are unhealthy
   * Returns healthy if all dependencies are healthy
   */
  private calculateOverallStatus(
    dependencies: {
      database?: DependencyHealth;
      control_plane_api?: DependencyHealth;
    }
  ): HealthStatus {
    const allDependencies = Object.values(dependencies);

    // Check for unhealthy dependencies
    const hasUnhealthy = allDependencies.some(dep => dep.status === 'unhealthy');
    if (hasUnhealthy) {
      return 'unhealthy';
    }

    // Check for degraded dependencies
    const hasDegraded = allDependencies.some(dep => dep.status === 'degraded');
    if (hasDegraded) {
      return 'degraded';
    }

    // All dependencies are healthy
    return 'healthy';
  }

  /**
   * Clear cached health status
   * Useful for testing or forcing a fresh health check
   */
  clearCache(): void {
    this.cachedHealth = null;
    this.cacheExpiry = 0;
  }

  /**
   * Get cache configuration
   */
  getConfig(): HealthCheckConfig {
    return { ...this.config };
  }
}

/**
 * Singleton instance
 */
let healthCheckServiceInstance: HealthCheckService | null = null;

/**
 * Create health check service instance
 */
export function createHealthCheckService(
  config?: Partial<HealthCheckConfig>
): HealthCheckService {
  if (healthCheckServiceInstance) {
    return healthCheckServiceInstance;
  }

  healthCheckServiceInstance = new HealthCheckService(config);
  return healthCheckServiceInstance;
}

/**
 * Get health check service instance
 */
export function getHealthCheckService(): HealthCheckService | null {
  return healthCheckServiceInstance;
}
