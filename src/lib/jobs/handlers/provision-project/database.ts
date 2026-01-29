/**
 * Tenant Database Creation
 *
 * Handles creation of tenant databases and schemas for project provisioning.
 *
 * US-004: Implement Provision Project Job - Step 10: Security & Error Handling
 */

import { query } from '@nextmavens/audit-logs-database';
import { getDatabaseConfig } from './config.js';

/**
 * Validate and sanitize project ID for use as database name
 *
 * @param projectId - The project ID to validate
 * @returns Sanitized database name
 * @throws Error if project ID contains invalid characters
 */
function validateDatabaseName(projectId: string): string {
  // Validate project ID format (UUID or alphanumeric with hyphens/underscores)
  const validPattern = /^[a-zA-Z0-9-_]+$/;
  if (!validPattern.test(projectId)) {
    throw new Error('Invalid project ID format');
  }

  // Sanitize to prevent SQL injection
  const databaseName = `tenant_${projectId}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  // Additional safety: enforce length limits
  if (databaseName.length > 63) {
    throw new Error('Project ID too long for database name');
  }

  return databaseName;
}

/**
 * Create tenant database
 *
 * Creates a new PostgreSQL database for the tenant with proper encoding and locale.
 * Uses parameterized query via format() to prevent SQL injection.
 *
 * @param projectId - The project ID to use as database name
 * @returns Promise resolving to database connection details
 * @throws Error if database creation fails
 */
export async function createTenantDatabase(
  projectId: string
): Promise<{ host: string; port: number; database_name: string }> {
  const databaseName = validateDatabaseName(projectId);

  console.log(`[ProvisionProject] Creating tenant database: ${databaseName}`);

  try {
    // Create the database using PostgreSQL's format() to prevent SQL injection
    // We use format() which properly escapes identifiers
    // Then execute the resulting SQL with EXECUTE
    const queryText = `
      DO $$
      BEGIN
        EXECUTE format(
          'CREATE DATABASE %I WITH OWNER = postgres ENCODING %L LC_COLLATE = %L LC_CTYPE = %L TEMPLATE = template0 CONNECTION LIMIT = 50',
          $1, 'UTF8', 'en_US.UTF-8', 'en_US.UTF-8'
        );
      END
      $$;
    `;

    await query(queryText, [databaseName]);

    console.log(`[ProvisionProject] Successfully created database: ${databaseName}`);

    // Get validated database configuration
    const dbConfig = getDatabaseConfig();

    return {
      host: dbConfig.host,
      port: dbConfig.port,
      database_name: databaseName,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ProvisionProject] Failed to create database: ${errorMessage}`);
    throw new Error('Failed to create tenant database');
  }
}

/**
 * Create tenant schema
 *
 * Creates a schema within the tenant database with proper permissions.
 * Uses parameterized query via format() to prevent SQL injection.
 *
 * @param projectId - The project ID to use as schema name
 * @param databaseName - The name of the tenant database
 * @returns Promise resolving to schema details
 * @throws Error if schema creation fails
 */
export async function createTenantSchema(
  projectId: string,
  databaseName: string
): Promise<{ schema_name: string }> {
  // Validate and sanitize schema name
  const schemaName = validateDatabaseName(projectId);

  console.log(`[ProvisionProject] Creating tenant schema: ${schemaName} in database ${databaseName}`);

  try {
    // Connect to the tenant database and create schema
    // Note: We need to connect to the specific database, not the default one
    // For now, we'll create the schema in the current database context
    // In production, you'd want to use a connection pool per tenant database

    // Use format() to properly escape schema name (prevents SQL injection)
    const queryText = `
      DO $$
      BEGIN
        EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION postgres', $1);
        EXECUTE format('GRANT ALL PRIVILEGES ON SCHEMA %I TO postgres', $1);
      END
      $$;
    `;

    await query(queryText, [schemaName]);

    console.log(`[ProvisionProject] Successfully created schema: ${schemaName}`);

    return {
      schema_name: schemaName,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ProvisionProject] Failed to create schema: ${errorMessage}`);
    throw new Error('Failed to create tenant schema');
  }
}
