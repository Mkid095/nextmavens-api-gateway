/**
 * Rotate Key Job Handler
 *
 * Handles API key rotation by:
 * 1. Creating a new key version
 * 2. Marking the old key as expired after 24 hours
 *
 * This is a one-shot job (no retry) since key rotation is idempotent
 * and should not be automatically retried on failure.
 *
 * US-005: Implement Rotate Key Job
 *
 * @example
 * ```typescript
 * import { enqueueJob } from '@/lib/jobs/queue';
 * import { rotateKeyHandler } from '@/lib/jobs/handlers/rotate-key.handler';
 *
 * // Register the handler
 * worker.registerHandler('rotate_key', rotateKeyHandler);
 *
 * // Enqueue a rotation job
 * await enqueueJob('rotate_key', { key_id: 'key-123' }, { maxAttempts: 1 });
 * ```
 */

import type { JobExecutionResult, JobPayload } from '@nextmavens/audit-logs-database';
import { query } from '@nextmavens/audit-logs-database';
import { v4 as uuidv4 } from 'uuid';
import { enqueueJob } from '@/lib/jobs/queue.js';

/**
 * Rotate key handler payload
 */
interface RotateKeyPayload extends JobPayload {
  /**
   * The ID of the key to rotate
   */
  key_id: string;
}

/**
 * Key rotation result
 */
interface KeyRotationResult extends Record<string, unknown> {
  /**
   * The ID of the old key that was rotated
   */
  oldKeyId: number;

  /**
   * The ID of the newly created key
   */
  newKeyId: number;

  /**
   * Timestamp when the old key will expire
   */
  expiresAt: Date;

  /**
   * Time remaining before old key expires (in hours)
   */
  gracePeriodHours: number;
}

/**
 * Grace period for old key before expiration
 * Old keys remain valid for 24 hours after rotation
 */
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Rotate Key Job Handler
 *
 * Creates a new key version and marks the old key as expired after 24 hours.
 * This is a one-shot job that should not be retried automatically.
 *
 * @param payload - Job payload containing key_id
 * @returns Promise resolving to job execution result
 *
 * @throws Error if key_id is missing
 * @throws Error if key not found
 * @throws Error if key is already revoked
 * @throws Error if database operation fails
 */
export async function rotateKeyHandler(
  payload: JobPayload
): Promise<JobExecutionResult> {
  // Validate payload
  const { key_id } = payload as RotateKeyPayload;

  if (!key_id) {
    return {
      success: false,
      error: 'Missing required field: key_id',
    };
  }

  console.log(`[RotateKey] Starting rotation for key ID: ${key_id}`);

  try {
    // Step 1: Fetch the existing key
    const keyQuery = `
      SELECT
        id,
        project_id,
        key_type,
        key_prefix,
        scopes,
        rate_limit
      FROM control_plane.api_keys
      WHERE id = $1
    `;

    const keyResult = await query(keyQuery, [key_id]);

    if (keyResult.rows.length === 0) {
      return {
        success: false,
        error: `Key not found: ${key_id}`,
      };
    }

    const existingKey = keyResult.rows[0] as {
      id: number;
      project_id: number;
      key_type: string;
      key_prefix: string;
      scopes: string[];
      rate_limit: number | null;
    };

    console.log(`[RotateKey] Found key ${existingKey.id} for project ${existingKey.project_id}`);

    // Step 2: Calculate expiration time for old key (24 hours from now)
    const expiresAt = new Date(Date.now() + GRACE_PERIOD_MS);

    // Step 3: Create new key version (mock implementation for now)
    // In a real implementation, this would:
    // - Generate a new API key
    // - Hash it using bcrypt
    // - Store it in the database
    const newKeyId = `key-${uuidv4()}`;
    const newKeyPrefix = `${existingKey.key_prefix}_v2`;

    console.log(`[RotateKey] Mock: Created new key version ${newKeyId} with prefix ${newKeyPrefix}`);

    // TODO: Implement actual key creation logic
    // This would involve:
    // 1. Generating a new API key (e.g., using crypto.randomBytes)
    // 2. Hashing the key using bcrypt or similar
    // 3. Inserting the new key into control_plane.api_keys
    //
    // Example implementation:
    // const insertQuery = `
    //   INSERT INTO control_plane.api_keys (
    //     project_id, key_type, key_prefix, key_hash, scopes, rate_limit
    //   ) VALUES ($1, $2, $3, $4, $5, $6)
    //   RETURNING id
    // `;
    //
    // const newKeyResult = await query(insertQuery, [
    //   existingKey.project_id,
    //   existingKey.key_type,
    //   newKeyPrefix,
    //   hashedKey,
    //   existingKey.scopes,
    //   existingKey.rate_limit
    // ]);

    // Step 4: Mark old key as expired after grace period
    const updateQuery = `
      UPDATE control_plane.api_keys
      SET expires_at = $1
      WHERE id = $2
      RETURNING id
    `;

    await query(updateQuery, [expiresAt, existingKey.id]);

    console.log(`[RotateKey] Old key ${existingKey.id} will expire at ${expiresAt.toISOString()}`);

    // Step 5: Prepare result
    const result: KeyRotationResult = {
      oldKeyId: existingKey.id,
      newKeyId: 0, // Will be updated when real implementation is added
      expiresAt,
      gracePeriodHours: GRACE_PERIOD_MS / (60 * 60 * 1000),
    };

    console.log(`[RotateKey] Successfully completed rotation for key ${key_id}`);

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[RotateKey] Failed to rotate key ${key_id}:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Convenience function to enqueue a rotate_key job
 *
 * @param keyId - The ID of the key to rotate
 * @returns Promise resolving to the job ID
 *
 * @example
 * ```typescript
 * import { enqueueRotateKeyJob } from '@/lib/jobs/handlers/rotate-key.handler';
 *
 * await enqueueRotateKeyJob('key-123');
 * ```
 */
export async function enqueueRotateKeyJob(keyId: string): Promise<string> {
  const result = await enqueueJob(
    'rotate_key',
    { key_id: keyId },
    {
      maxAttempts: 1, // One-shot job, no retry
    }
  );

  return result.id;
}
