import axios, { AxiosError } from 'axios';
import { SnapshotResponse } from '@/types/snapshot.types.js';

/**
 * Snapshot client configuration
 */
interface SnapshotClientConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  retryDelay: number;
}

/**
 * Custom error for snapshot client failures
 */
export class SnapshotClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'SnapshotClientError';
  }
}

/**
 * Snapshot client handles HTTP communication with the control plane API
 * This provides a centralized data access layer for snapshot operations
 */
export class SnapshotClient {
  constructor(private readonly config: SnapshotClientConfig) {}

  /**
   * Fetch the current snapshot from the control plane
   * Implements retry logic for transient failures
   */
  async fetchSnapshot(): Promise<SnapshotResponse> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retries; attempt++) {
      try {
        console.log(`[SnapshotClient] Fetching snapshot (attempt ${attempt}/${this.config.retries})...`);

        const response = await axios.get<SnapshotResponse>(
          `${this.config.baseUrl}/snapshot`,
          {
            timeout: this.config.timeout,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'nextmavens-gateway/1.0.0'
            }
          }
        );

        if (response.status !== 200) {
          throw new SnapshotClientError(
            `Unexpected status code: ${response.status}`,
            response.status,
            response.status >= 500
          );
        }

        if (!response.data) {
          throw new SnapshotClientError('Empty response body');
        }

        console.log(`[SnapshotClient] Snapshot fetched successfully`);
        return response.data;
      } catch (error) {
        lastError = error as Error;

        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          const statusCode = axiosError.response?.status;
          const isRetryable = !statusCode || statusCode >= 500 || statusCode === 429;

          // Don't retry client errors (4xx except 429)
          if (!isRetryable) {
            throw new SnapshotClientError(
              `Client error: ${axiosError.message}`,
              statusCode,
              false
            );
          }

          // Retry on server errors or network issues
          if (attempt < this.config.retries) {
            const delay = this.config.retryDelay * attempt;
            console.log(
              `[SnapshotClient] Request failed (will retry in ${delay}ms): ${axiosError.message}`
            );
            await this.sleep(delay);
            continue;
          }
        }

        // Last attempt or non-retryable error
        if (attempt === this.config.retries) {
          throw new SnapshotClientError(
            `Failed to fetch snapshot after ${attempt} attempts: ${lastError.message}`,
            undefined,
            true
          );
        }
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new SnapshotClientError(
      'Failed to fetch snapshot',
      undefined,
      true
    );
  }

  /**
   * Check if the snapshot API is available
   * Returns true if the API responds, false otherwise
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.config.baseUrl}/health`, {
        timeout: Math.min(this.config.timeout, 2000),
        validateStatus: (status) => status < 500
      });
      return response.status < 500;
    } catch {
      return false;
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get client configuration
   */
  getConfig(): Omit<SnapshotClientConfig, 'retries' | 'retryDelay'> {
    return {
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout
    };
  }
}

/**
 * Create a singleton snapshot client instance
 */
let snapshotClientInstance: SnapshotClient | null = null;

export function createSnapshotClient(
  config?: Partial<SnapshotClientConfig>
): SnapshotClient {
  if (snapshotClientInstance) {
    return snapshotClientInstance;
  }

  const defaultConfig: SnapshotClientConfig = {
    baseUrl: process.env.SNAPSHOT_API_URL || 'http://localhost:4000/api',
    timeout: parseInt(process.env.SNAPSHOT_REQUEST_TIMEOUT || '5000', 10),
    retries: parseInt(process.env.SNAPSHOT_FETCH_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.SNAPSHOT_RETRY_DELAY || '1000', 10)
  };

  const finalConfig = { ...defaultConfig, ...config };
  snapshotClientInstance = new SnapshotClient(finalConfig);

  console.log('[SnapshotClient] Initialized with config:', {
    baseUrl: finalConfig.baseUrl,
    timeout: finalConfig.timeout,
    retries: finalConfig.retries,
    retryDelay: finalConfig.retryDelay
  });

  return snapshotClientInstance;
}

export function getSnapshotClient(): SnapshotClient | null {
  return snapshotClientInstance;
}
