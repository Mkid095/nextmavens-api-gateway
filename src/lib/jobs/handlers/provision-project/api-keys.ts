/**
 * API Key Generation
 *
 * Handles generation of secure API keys for tenant projects.
 *
 * US-004: Implement Provision Project Job - Step 7: Implementation
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';

/**
 * Generate API keys
 *
 * Generates secure API keys for the tenant with cryptographic hashing.
 *
 * @param projectId - The project ID for key identification
 * @param count - Number of keys to generate
 * @param prefix - Optional key prefix for identification
 * @returns Promise resolving to array of generated API keys
 * @throws Error if key generation fails
 */
export async function generateApiKeys(
  projectId: string,
  count: number,
  prefix?: string
): Promise<Array<{ key_id: string; key_prefix: string; created_at: Date; key_hash: string }>> {
  console.log(`[ProvisionProject] Generating ${count} API keys for project: ${projectId}`);

  const keys: Array<{
    key_id: string;
    key_prefix: string;
    created_at: Date;
    key_hash: string;
  }> = [];

  try {
    for (let i = 0; i < count; i++) {
      // Generate a unique key ID
      const keyId = uuidv4();
      const keyPrefix = prefix || projectId;

      // Generate a secure random API key
      // Format: {prefix}_{timestamp}_{random}
      const timestamp = Date.now();
      const randomBytesHex = randomBytes(16).toString('hex');
      const apiKey = `${keyPrefix}_${timestamp}_${randomBytesHex}`;

      // Hash the API key for storage (we never store the actual key)
      const keyHash = createHash('sha256').update(apiKey).digest('hex');

      keys.push({
        key_id: keyId,
        key_prefix: keyPrefix,
        created_at: new Date(),
        key_hash: keyHash,
      });

      console.log(`[ProvisionProject] Generated API key: ${keyId}`);
    }

    console.log(`[ProvisionProject] Successfully generated ${count} API keys`);

    return keys;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ProvisionProject] Failed to generate API keys:`, errorMessage);
    throw new Error(`Failed to generate API keys: ${errorMessage}`);
  }
}
