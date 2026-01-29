/**
 * Backups Data Layer Service
 *
 * Provides CRUD operations for the backups table in the control_plane schema.
 * All functions use parameterized queries for SQL injection prevention.
 *
 * US-003: Create Backup History Table - Step 7: Data Layer
 */

import { v4 as uuidv4 } from 'uuid';
import { query } from '@nextmavens/audit-logs-database';
import type {
  Backup,
  BackupType,
  CreateBackupInput,
  BackupQuery,
  BackupResponse,
  BackupStats,
} from '@nextmavens/audit-logs-database';

/**
 * Validation constants
 */
const VALIDATION = {
  /** Maximum file_id length */
  MAX_FILE_ID_LENGTH: 500,
  /** Minimum file_id length */
  MIN_FILE_ID_LENGTH: 1,
  /** Maximum backup size in bytes (10GB) */
  MAX_BACKUP_SIZE: 10 * 1024 * 1024 * 1024,
  /** Minimum backup size (0 bytes allowed for empty backups) */
  MIN_BACKUP_SIZE: 0,
  /** Default expiration period in milliseconds (30 days) */
  DEFAULT_EXPIRATION_MS: 30 * 24 * 60 * 60 * 1000,
  /** Maximum limit for pagination */
  MAX_LIMIT: 1000,
  /** Default limit for pagination */
  DEFAULT_LIMIT: 50,
  /** Maximum offset for pagination */
  MAX_OFFSET: 100000,
} as const;

/**
 * Custom error class for backup operations
 */
export class BackupError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * Validate project_id format
 */
function validateProjectId(projectId: string): void {
  if (typeof projectId !== 'string') {
    throw new BackupError('Project ID must be a string', 'INVALID_PROJECT_ID');
  }
  if (projectId.trim().length === 0) {
    throw new BackupError('Project ID cannot be empty', 'INVALID_PROJECT_ID');
  }
}

/**
 * Validate backup type
 */
function validateBackupType(type: BackupType): void {
  if (typeof type !== 'string') {
    throw new BackupError('Backup type must be a string', 'INVALID_BACKUP_TYPE');
  }
  const validTypes = ['database', 'storage', 'logs'];
  if (!validTypes.includes(type)) {
    throw new BackupError('Backup type must be one of: database, storage, logs', 'INVALID_BACKUP_TYPE');
  }
}

/**
 * Validate file_id
 */
function validateFileId(fileId: string): void {
  if (typeof fileId !== 'string') {
    throw new BackupError('File ID must be a string', 'INVALID_FILE_ID');
  }
  if (fileId.trim().length === 0) {
    throw new BackupError('File ID cannot be empty', 'INVALID_FILE_ID');
  }
  if (fileId.length > VALIDATION.MAX_FILE_ID_LENGTH) {
    throw new BackupError(
      `File ID cannot exceed ${VALIDATION.MAX_FILE_ID_LENGTH} characters`,
      'INVALID_FILE_ID'
    );
  }
}

/**
 * Validate backup size
 */
function validateBackupSize(size: number): void {
  if (typeof size !== 'number') {
    throw new BackupError('Backup size must be a number', 'INVALID_SIZE');
  }
  if (!Number.isInteger(size)) {
    throw new BackupError('Backup size must be an integer', 'INVALID_SIZE');
  }
  if (size < VALIDATION.MIN_BACKUP_SIZE) {
    throw new BackupError(
      `Backup size must be at least ${VALIDATION.MIN_BACKUP_SIZE} bytes`,
      'INVALID_SIZE'
    );
  }
  if (size > VALIDATION.MAX_BACKUP_SIZE) {
    throw new BackupError(
      `Backup size cannot exceed ${VALIDATION.MAX_BACKUP_SIZE} bytes (10GB)`,
      'INVALID_SIZE'
    );
  }
}

/**
 * Validate pagination parameters
 */
function validatePagination(limit?: number, offset?: number): void {
  if (limit !== undefined) {
    if (!Number.isInteger(limit)) {
      throw new BackupError('Limit must be an integer', 'INVALID_PAGINATION');
    }
    if (limit < 1) {
      throw new BackupError('Limit must be at least 1', 'INVALID_PAGINATION');
    }
    if (limit > VALIDATION.MAX_LIMIT) {
      throw new BackupError(`Limit cannot exceed ${VALIDATION.MAX_LIMIT}`, 'INVALID_PAGINATION');
    }
  }

  if (offset !== undefined) {
    if (!Number.isInteger(offset)) {
      throw new BackupError('Offset must be an integer', 'INVALID_PAGINATION');
    }
    if (offset < 0) {
      throw new BackupError('Offset must be non-negative', 'INVALID_PAGINATION');
    }
    if (offset > VALIDATION.MAX_OFFSET) {
      throw new BackupError(`Offset cannot exceed ${VALIDATION.MAX_OFFSET}`, 'INVALID_PAGINATION');
    }
  }
}

/**
 * Validate date range
 */
function validateDateRange(date: Date, fieldName: string): void {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new BackupError(`${fieldName} must be a valid Date object`, 'INVALID_DATE');
  }
}

/**
 * Create a new backup record
 *
 * @param input - Backup creation input data
 * @returns The created backup record
 *
 * @example
 * ```typescript
 * const backup = await createBackup({
 *   project_id: 'proj-123',
 *   type: BackupType.DATABASE,
 *   file_id: 'telegram-file-123',
 *   size: 1024000,
 * });
 * ```
 */
export async function createBackup(input: CreateBackupInput): Promise<Backup> {
  // Validate inputs
  validateProjectId(input.project_id);
  validateBackupType(input.type);
  validateFileId(input.file_id);
  validateBackupSize(input.size);

  if (input.expires_at) {
    validateDateRange(input.expires_at, 'expires_at');
  }

  // Generate a unique backup ID
  const id = uuidv4();

  // Calculate expiration date (30 days from now if not provided)
  const expiresAt = input.expires_at
    ? input.expires_at
    : new Date(Date.now() + VALIDATION.DEFAULT_EXPIRATION_MS);

  // Insert backup record
  const queryText = `
    INSERT INTO control_plane.backups (
      id,
      project_id,
      type,
      file_id,
      size,
      expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      id,
      project_id,
      type,
      file_id,
      size,
      created_at,
      expires_at
  `;

  const values = [
    id,
    input.project_id,
    input.type,
    input.file_id,
    input.size,
    expiresAt,
  ];

  try {
    const result = await query(queryText, values);
    const row = result.rows[0];

    if (!row) {
      throw new BackupError('Failed to create backup record', 'CREATE_FAILED');
    }

    return {
      id: row.id,
      project_id: row.project_id,
      type: row.type as BackupType,
      file_id: row.file_id,
      size: row.size,
      created_at: row.created_at,
      expires_at: row.expires_at,
    };
  } catch (error) {
    console.error('Failed to create backup:', error);
    if (error instanceof BackupError) {
      throw error;
    }
    throw new BackupError('Failed to create backup record', 'DATABASE_ERROR');
  }
}

/**
 * Query backups by project with optional filtering
 *
 * @param projectId - The project ID to query backups for
 * @param options - Optional query parameters for filtering and pagination
 * @returns Paginated backup results
 *
 * @example
 * ```typescript
 * // Get all backups for a project
 * const result = await queryByProject('proj-123');
 *
 * // Get database backups with pagination
 * const filtered = await queryByProject('proj-123', {
 *   type: BackupType.DATABASE,
 *   limit: 20,
 *   offset: 0,
 * });
 * ```
 */
export async function queryByProject(
  projectId: string,
  options: Omit<BackupQuery, 'project_id'> = {}
): Promise<BackupResponse> {
  // Validate project ID
  validateProjectId(projectId);

  // Validate pagination
  const limit = options.limit ?? VALIDATION.DEFAULT_LIMIT;
  const offset = options.offset ?? 0;
  validatePagination(limit, offset);

  // Build query conditions
  const conditions: string[] = ['project_id = $1'];
  const values: unknown[] = [projectId];
  let paramIndex = 2;

  // Add optional filters
  if (options.type) {
    validateBackupType(options.type);
    conditions.push(`type = $${paramIndex++}`);
    values.push(options.type);
  }

  if (options.created_before) {
    validateDateRange(options.created_before, 'created_before');
    conditions.push(`created_at < $${paramIndex++}`);
    values.push(options.created_before);
  }

  if (options.created_after) {
    validateDateRange(options.created_after, 'created_after');
    conditions.push(`created_at > $${paramIndex++}`);
    values.push(options.created_after);
  }

  if (options.expires_before) {
    validateDateRange(options.expires_before, 'expires_before');
    conditions.push(`expires_at < $${paramIndex++}`);
    values.push(options.expires_before);
  }

  if (options.expires_after) {
    validateDateRange(options.expires_after, 'expires_after');
    conditions.push(`expires_at > $${paramIndex++}`);
    values.push(options.expires_after);
  }

  if (options.min_size !== undefined) {
    validateBackupSize(options.min_size);
    conditions.push(`size >= $${paramIndex++}`);
    values.push(options.min_size);
  }

  if (options.max_size !== undefined) {
    validateBackupSize(options.max_size);
    conditions.push(`size <= $${paramIndex++}`);
    values.push(options.max_size);
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM control_plane.backups
    WHERE ${whereClause}
  `;

  // Get paginated results
  const dataQuery = `
    SELECT
      id,
      project_id,
      type,
      file_id,
      size,
      created_at,
      expires_at
    FROM control_plane.backups
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;

  values.push(limit, offset);

  try {
    // Execute queries in parallel
    const [countResult, dataResult] = await Promise.all([
      query(countQuery, values.slice(0, paramIndex - 2)),
      query(dataQuery, values),
    ]);

    const countRow = countResult.rows[0];
    const total = countRow ? parseInt(countRow.total || '0', 10) : 0;
    const hasMore = offset + limit < total;

    return {
      data: dataResult.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        project_id: row.project_id as string,
        type: row.type as BackupType,
        file_id: row.file_id as string,
        size: row.size as number,
        created_at: row.created_at as Date,
        expires_at: row.expires_at as Date,
      })),
      total,
      limit,
      offset,
      has_more: hasMore,
    };
  } catch (error) {
    console.error('Failed to query backups:', error);
    throw new BackupError('Failed to retrieve backup records', 'DATABASE_ERROR');
  }
}

/**
 * Get a single backup by ID
 *
 * @param id - The backup ID
 * @returns The backup record or null if not found
 *
 * @example
 * ```typescript
 * const backup = await getBackupById('backup-123');
 * if (backup) {
 *   console.log('Backup size:', backup.size);
 * }
 * ```
 */
export async function getBackupById(id: string): Promise<Backup | null> {
  if (typeof id !== 'string') {
    throw new BackupError('Backup ID must be a string', 'INVALID_BACKUP_ID');
  }
  if (id.trim().length === 0) {
    throw new BackupError('Backup ID cannot be empty', 'INVALID_BACKUP_ID');
  }

  const queryText = `
    SELECT
      id,
      project_id,
      type,
      file_id,
      size,
      created_at,
      expires_at
    FROM control_plane.backups
    WHERE id = $1
  `;

  try {
    const result = await query(queryText, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      project_id: row.project_id,
      type: row.type as BackupType,
      file_id: row.file_id,
      size: row.size,
      created_at: row.created_at,
      expires_at: row.expires_at,
    };
  } catch (error) {
    console.error('Failed to get backup by ID:', error);
    throw new BackupError('Failed to retrieve backup record', 'DATABASE_ERROR');
  }
}

/**
 * Update backup file_id and size
 *
 * @param id - The backup ID
 * @param updates - Fields to update (file_id and/or size)
 * @returns The updated backup record or null if not found
 *
 * @example
 * ```typescript
 * const updated = await updateBackup('backup-123', {
 *   file_id: 'new-file-id',
 *   size: 2048000,
 * });
 * ```
 */
export async function updateBackup(
  id: string,
  updates: Partial<Pick<Backup, 'file_id' | 'size'>>
): Promise<Backup | null> {
  if (typeof id !== 'string') {
    throw new BackupError('Backup ID must be a string', 'INVALID_BACKUP_ID');
  }
  if (id.trim().length === 0) {
    throw new BackupError('Backup ID cannot be empty', 'INVALID_BACKUP_ID');
  }

  // Validate updates
  const updatesList: string[] = [];
  const values: unknown[] = [id];
  let paramIndex = 2;

  if (updates.file_id !== undefined) {
    validateFileId(updates.file_id);
    updatesList.push(`file_id = $${paramIndex++}`);
    values.push(updates.file_id);
  }

  if (updates.size !== undefined) {
    validateBackupSize(updates.size);
    updatesList.push(`size = $${paramIndex++}`);
    values.push(updates.size);
  }

  if (updatesList.length === 0) {
    throw new BackupError('No fields to update', 'NO_UPDATES');
  }

  const queryText = `
    UPDATE control_plane.backups
    SET ${updatesList.join(', ')}
    WHERE id = $1
    RETURNING
      id,
      project_id,
      type,
      file_id,
      size,
      created_at,
      expires_at
  `;

  try {
    const result = await query(queryText, values);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      project_id: row.project_id,
      type: row.type as BackupType,
      file_id: row.file_id,
      size: row.size,
      created_at: row.created_at,
      expires_at: row.expires_at,
    };
  } catch (error) {
    console.error('Failed to update backup:', error);
    throw new BackupError('Failed to update backup record', 'DATABASE_ERROR');
  }
}

/**
 * Delete a backup by ID
 *
 * @param id - The backup ID
 * @returns True if deleted, false if not found
 *
 * @example
 * ```typescript
 * const deleted = await deleteBackup('backup-123');
 * if (deleted) {
 *   console.log('Backup deleted successfully');
 * }
 * ```
 */
export async function deleteBackup(id: string): Promise<boolean> {
  if (typeof id !== 'string') {
    throw new BackupError('Backup ID must be a string', 'INVALID_BACKUP_ID');
  }
  if (id.trim().length === 0) {
    throw new BackupError('Backup ID cannot be empty', 'INVALID_BACKUP_ID');
  }

  const queryText = `
    DELETE FROM control_plane.backups
    WHERE id = $1
    RETURNING id
  `;

  try {
    const result = await query(queryText, [id]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Failed to delete backup:', error);
    throw new BackupError('Failed to delete backup record', 'DATABASE_ERROR');
  }
}

/**
 * Query backups by type and date range
 *
 * @param projectId - The project ID
 * @param type - The backup type
 * @param startDate - Start of date range
 * @param endDate - End of date range
 * @param options - Optional pagination parameters
 * @returns Paginated backup results
 *
 * @example
 * ```typescript
 * const result = await queryByTypeAndDateRange(
 *   'proj-123',
 *   BackupType.DATABASE,
 *   new Date('2026-01-01'),
 *   new Date('2026-01-31'),
 *   { limit: 20 }
 * );
 * ```
 */
export async function queryByTypeAndDateRange(
  projectId: string,
  type: BackupType,
  startDate: Date,
  endDate: Date,
  options: { limit?: number; offset?: number } = {}
): Promise<BackupResponse> {
  validateProjectId(projectId);
  validateBackupType(type);
  validateDateRange(startDate, 'startDate');
  validateDateRange(endDate, 'endDate');

  if (startDate >= endDate) {
    throw new BackupError('Start date must be before end date', 'INVALID_DATE_RANGE');
  }

  const limit = options.limit ?? VALIDATION.DEFAULT_LIMIT;
  const offset = options.offset ?? 0;
  validatePagination(limit, offset);

  const queryText = `
    SELECT
      id,
      project_id,
      type,
      file_id,
      size,
      created_at,
      expires_at
    FROM control_plane.backups
    WHERE project_id = $1
      AND type = $2
      AND created_at >= $3
      AND created_at <= $4
    ORDER BY created_at DESC
    LIMIT $5 OFFSET $6
  `;

  const countQuery = `
    SELECT COUNT(*) as total
    FROM control_plane.backups
    WHERE project_id = $1
      AND type = $2
      AND created_at >= $3
      AND created_at <= $4
  `;

  const values = [projectId, type, startDate, endDate, limit, offset];

  try {
    const [countResult, dataResult] = await Promise.all([
      query(countQuery, [projectId, type, startDate, endDate]),
      query(queryText, values),
    ]);

    const countRow = countResult.rows[0];
    const total = countRow ? parseInt(countRow.total || '0', 10) : 0;
    const hasMore = offset + limit < total;

    return {
      data: dataResult.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        project_id: row.project_id as string,
        type: row.type as BackupType,
        file_id: row.file_id as string,
        size: row.size as number,
        created_at: row.created_at as Date,
        expires_at: row.expires_at as Date,
      })),
      total,
      limit,
      offset,
      has_more: hasMore,
    };
  } catch (error) {
    console.error('Failed to query backups by type and date range:', error);
    throw new BackupError('Failed to retrieve backup records', 'DATABASE_ERROR');
  }
}

/**
 * Get backup statistics for a project
 *
 * @param projectId - The project ID
 * @returns Backup statistics
 *
 * @example
 * ```typescript
 * const stats = await getBackupStats('proj-123');
 * console.log('Total backups:', stats.total_backups);
 * console.log('Total size:', stats.total_size);
 * ```
 */
export async function getBackupStats(projectId: string): Promise<BackupStats> {
  validateProjectId(projectId);

  const queryText = `
    SELECT
      COUNT(*) as total_backups,
      SUM(size) as total_size,
      COUNT(*) FILTER (WHERE type = 'database') as database_count,
      COUNT(*) FILTER (WHERE type = 'storage') as storage_count,
      COUNT(*) FILTER (WHERE type = 'logs') as logs_count,
      MIN(created_at) as oldest_backup,
      MAX(created_at) as newest_backup,
      COUNT(*) FILTER (WHERE expires_at <= NOW() + INTERVAL '7 days' AND expires_at > NOW()) as expiring_soon
    FROM control_plane.backups
    WHERE project_id = $1
  `;

  try {
    const result = await query(queryText, [projectId]);
    const row = result.rows[0];

    if (!row) {
      return {
        total_backups: 0,
        total_size: 0,
        by_type: {
          database: 0,
          storage: 0,
          logs: 0,
        },
        expiring_soon: 0,
      };
    }

    return {
      total_backups: parseInt(row.total_backups || '0', 10),
      total_size: parseInt(row.total_size || '0', 10),
      by_type: {
        database: parseInt(row.database_count || '0', 10),
        storage: parseInt(row.storage_count || '0', 10),
        logs: parseInt(row.logs_count || '0', 10),
      },
      oldest_backup: row.oldest_backup ? new Date(row.oldest_backup) : undefined,
      newest_backup: row.newest_backup ? new Date(row.newest_backup) : undefined,
      expiring_soon: parseInt(row.expiring_soon || '0', 10),
    };
  } catch (error) {
    console.error('Failed to get backup stats:', error);
    throw new BackupError('Failed to retrieve backup statistics', 'DATABASE_ERROR');
  }
}

/**
 * Delete expired backups for a project
 *
 * @param projectId - The project ID
 * @returns Count of deleted backups
 *
 * @example
 * ```typescript
 * const count = await deleteExpiredBackups('proj-123');
 * console.log(`Deleted ${count} expired backups`);
 * ```
 */
export async function deleteExpiredBackups(projectId: string): Promise<number> {
  validateProjectId(projectId);

  const queryText = `
    DELETE FROM control_plane.backups
    WHERE project_id = $1
      AND expires_at < NOW()
    RETURNING id
  `;

  try {
    const result = await query(queryText, [projectId]);
    return result.rows.length;
  } catch (error) {
    console.error('Failed to delete expired backups:', error);
    throw new BackupError('Failed to delete expired backups', 'DATABASE_ERROR');
  }
}
