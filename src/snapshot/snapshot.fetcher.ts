import axios, { AxiosError } from 'axios';
import type {
  SnapshotData,
  SnapshotResponse
} from '@/types/snapshot.types.js';

/**
 * Snapshot fetcher error types
 */
export class SnapshotFetchError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'SnapshotFetchError';
  }
}

/**
 * Snapshot fetcher configuration
 */
interface FetcherConfig {
  snapshotApiUrl: string;
  requestTimeoutMs: number;
}

/**
 * Snapshot fetcher
 * Handles fetching and validating snapshot data from control plane API
 */
export class SnapshotFetcher {
  private lastFetchAttempt = 0;
  private fetchFailures = 0;

  constructor(private readonly config: FetcherConfig) {}

  /**
   * Fetch snapshot from control plane API
   */
  async fetchSnapshot(): Promise<SnapshotData> {
    try {
      this.lastFetchAttempt = Date.now();

      const response = await axios.get<SnapshotResponse>(
        this.config.snapshotApiUrl,
        {
          timeout: this.config.requestTimeoutMs,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'nextmavens-gateway/1.0.0'
          }
        }
      );

      if (!response.data.success) {
        throw new SnapshotFetchError(
          `Snapshot API returned error: ${response.data.error}`
        );
      }

      if (!response.data.data) {
        throw new SnapshotFetchError('Snapshot API returned no data');
      }

      // Validate snapshot data structure
      this.validateSnapshotData(response.data.data);

      // Reset failure counter on success
      this.fetchFailures = 0;

      return response.data.data;
    } catch (error) {
      this.fetchFailures++;

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        throw new SnapshotFetchError(
          `Failed to fetch snapshot: ${axiosError.message}`,
          axiosError
        );
      }

      throw error;
    }
  }

  /**
   * Validate snapshot data structure
   * SECURITY: Prevents cache poisoning through malformed data
   */
  private validateSnapshotData(data: SnapshotData): void {
    if (!data) {
      throw new SnapshotFetchError('Snapshot data is null or undefined');
    }

    // SECURITY: Validate version is a positive number
    if (typeof data.version !== 'number' || data.version < 0 || !Number.isFinite(data.version)) {
      throw new SnapshotFetchError('Invalid snapshot version');
    }

    // SECURITY: Validate timestamp exists and is a string
    if (!data.timestamp || typeof data.timestamp !== 'string') {
      throw new SnapshotFetchError('Invalid snapshot timestamp');
    }

    // SECURITY: Validate projects object
    if (!data.projects || typeof data.projects !== 'object' || Array.isArray(data.projects)) {
      throw new SnapshotFetchError('Invalid projects data in snapshot');
    }

    // SECURITY: Validate services object
    if (!data.services || typeof data.services !== 'object' || Array.isArray(data.services)) {
      throw new SnapshotFetchError('Invalid services data in snapshot');
    }

    // SECURITY: Validate rate limits object
    if (!data.rateLimits || typeof data.rateLimits !== 'object' || Array.isArray(data.rateLimits)) {
      throw new SnapshotFetchError('Invalid rate limits data in snapshot');
    }

    // SECURITY: Validate no prototype pollution in objects
    this.validateObjectSafety(data.projects);
    this.validateObjectSafety(data.services);
    this.validateObjectSafety(data.rateLimits);
  }

  /**
   * Validate object for prototype pollution attacks
   * SECURITY: Prevents __proto__ and constructor pollution
   */
  private validateObjectSafety(obj: Record<string, unknown>): void {
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

    for (const key of Object.keys(obj)) {
      if (dangerousKeys.includes(key)) {
        throw new SnapshotFetchError('Dangerous key detected in snapshot data');
      }
    }
  }

  /**
   * Get fetch statistics
   */
  getFetchStats(): {
    fetchFailures: number;
    lastFetchAttempt: number;
  } {
    return {
      fetchFailures: this.fetchFailures,
      lastFetchAttempt: this.lastFetchAttempt
    };
  }
}
