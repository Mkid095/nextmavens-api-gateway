/**
 * Restore History Data Layer Service
 *
 * Provides CRUD operations for the restore_history table in the control_plane schema.
 * All functions use parameterized queries for SQL injection prevention.
 *
 * US-006: Implement Restore from Backup - Step 7: Data Layer
 */

import { v4 as uuidv4 } from 'uuid';
import { query } from '@nextmavens/audit-logs-database';
import {
  RestoreHistory,
  RestoreStatus,
  CreateRestoreHistoryInput,
  RestoreHistoryQuery,
  RestoreHistoryResponse,
  RestoreStats,
} from './restore-history.types.js';

/**
 * Validation constants
 */
const VALIDATION = {
  /** Maximum file_id length */
  MAX_FILE_ID_LENGTH: 500,
  /** Minimum file_id length */
  MIN_FILE_ID_LENGTH: 1,
  /** Maximum error_message length */
  MAX_ERROR_MESSAGE_LENGTH: 5000,
  /** Maximum backup size in bytes (10GB) */
  MAX_BACKUP_SIZE: 10 * 1024 * 1024 * 1024,
  /** Minimum backup size (0 bytes allowed for empty backups) */
  MIN_BACKUP_SIZE: 0,
  /** Maximum duration in milliseconds (24 hours) */
  MAX_DURATION_MS: 24 * 60 * 60 * 1000,
  /** Minimum duration (0 milliseconds allowed) */
  MIN_DURATION_MS: 0,
  /** Maximum tables restored */
  MAX_TABLES_RESTORED: 1000000,
  /** Minimum tables restored (0 allowed) */
  MIN_TABLES_RESTORED: 0,
  /** Maximum limit for pagination */
  MAX_LIMIT: 1000,
  /** Default limit for pagination */
  DEFAULT_LIMIT: 50,
  /** Maximum offset for pagination */
  MAX_OFFSET: 100000,
} as const;

/**
 * Custom error class for restore history operations
 */
export class RestoreHistoryError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'RestoreHistoryError';
  }
}

/**
 * Validate project_id format
 */
function validateProjectId(projectId: string): void {
  if (typeof projectId !== 'string') {
    throw new RestoreHistoryError('Project ID must be a string', 'INVALID_PROJECT_ID');
  }
  if (projectId.trim().length === 0) {
    throw new RestoreHistoryError('Project ID cannot be empty', 'INVALID_PROJECT_ID');
  }
}

/**
 * Validate backup_id format (UUID)
 */
function validateBackupId(backupId: string): void {
  if (typeof backupId !== 'string') {
    throw new RestoreHistoryError('Backup ID must be a string', 'INVALID_BACKUP_ID');
  }
  if (backupId.trim().length === 0) {
    throw new RestoreHistoryError('Backup ID cannot be empty', 'INVALID_BACKUP_ID');
  }
  // UUID format validation
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(backupId)) {
    throw new RestoreHistoryError('Backup ID must be a valid UUID', 'INVALID_BACKUP_ID');
  }
}

/**
 * Validate file_id
 */
function validateFileId(fileId: string): void {
  if (typeof fileId !== 'string') {
    throw new RestoreHistoryError('File ID must be a string', 'INVALID_FILE_ID');
  }
  if (fileId.trim().length === 0) {
    throw new RestoreHistoryError('File ID cannot be empty', 'INVALID_FILE_ID');
  }
  if (fileId.length > VALIDATION.MAX_FILE_ID_LENGTH) {
    throw new RestoreHistoryError(
      `File ID cannot exceed ${VALIDATION.MAX_FILE_ID_LENGTH} characters`,
      'INVALID_FILE_ID'
    );
  }
}

/**
 * Validate restore status
 */
function validateRestoreStatus(status: RestoreStatus): void {
  if (typeof status !== 'string') {
    throw new RestoreHistoryError('Restore status must be a string', 'INVALID_STATUS');
  }
  const validStatuses = ['pending', 'in_progress', 'completed', 'failed'];
  if (!validStatuses.includes(status)) {
    throw new RestoreHistoryError(
      'Restore status must be one of: pending, in_progress, completed, failed',
      'INVALID_STATUS'
    );
  }
}

/**
 * Validate error message
 */
function validateErrorMessage(message: string): void {
  if (typeof message !== 'string') {
    throw new RestoreHistoryError('Error message must be a string', 'INVALID_ERROR_MESSAGE');
  }
  if (message.length > VALIDATION.MAX_ERROR_MESSAGE_LENGTH) {
    throw new RestoreHistoryError(
      `Error message cannot exceed ${VALIDATION.MAX_ERROR_MESSAGE_LENGTH} characters`,
      'INVALID_ERROR_MESSAGE'
    );
  }
}

/**
 * Validate tables restored count
 */
function validateTablesRestored(count: number): void {
  if (typeof count !== 'number') {
    throw new RestoreHistoryError('Tables restored must be a number', 'INVALID_TABLES_RESTORED');
  }
  if (!Number.isInteger(count)) {
    throw new RestoreHistoryError('Tables restored must be an integer', 'INVALID_TABLES_RESTORED');
  }
  if (count < VALIDATION.MIN_TABLES_RESTORED) {
    throw new RestoreHistoryError(
      `Tables restored must be at least ${VALIDATION.MIN_TABLES_RESTORED}`,
      'INVALID_TABLES_RESTORED'
    );
  }
  if (count > VALIDATION.MAX_TABLES_RESTORED) {
    throw new RestoreHistoryError(
      `Tables restored cannot exceed ${VALIDATION.MAX_TABLES_RESTORED}`,
      'INVALID_TABLES_RESTORED'
    );
  }
}

/**
 * Validate duration
 */
function validateDuration(duration: number): void {
  if (typeof duration !== 'number') {
    throw new RestoreHistoryError('Duration must be a number', 'INVALID_DURATION');
  }
  if (!Number.isInteger(duration)) {
    throw new RestoreHistoryError('Duration must be an integer', 'INVALID_DURATION');
  }
  if (duration < VALIDATION.MIN_DURATION_MS) {
    throw new RestoreHistoryError(
      `Duration must be at least ${VALIDATION.MIN_DURATION_MS} milliseconds`,
      'INVALID_DURATION'
    );
  }
  if (duration > VALIDATION.MAX_DURATION_MS) {
    throw new RestoreHistoryError(
      `Duration cannot exceed ${VALIDATION.MAX_DURATION_MS} milliseconds`,
      'INVALID_DURATION'
    );
  }
}

/**
 * Validate backup size
 */
function validateBackupSize(size: number): void {
  if (typeof size !== 'number') {
    throw new RestoreHistoryError('Backup size must be a number', 'INVALID_SIZE');
  }
  if (!Number.isInteger(size)) {
    throw new RestoreHistoryError('Backup size must be an integer', 'INVALID_SIZE');
  }
  if (size < VALIDATION.MIN_BACKUP_SIZE) {
    throw new RestoreHistoryError(
      `Backup size must be at least ${VALIDATION.MIN_BACKUP_SIZE} bytes`,
      'INVALID_SIZE'
    );
  }
  if (size > VALIDATION.MAX_BACKUP_SIZE) {
    throw new RestoreHistoryError(
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
      throw new RestoreHistoryError('Limit must be an integer', 'INVALID_PAGINATION');
    }
    if (limit < 1) {
      throw new RestoreHistoryError('Limit must be at least 1', 'INVALID_PAGINATION');
    }
    if (limit > VALIDATION.MAX_LIMIT) {
      throw new RestoreHistoryError(`Limit cannot exceed ${VALIDATION.MAX_LIMIT}`, 'INVALID_PAGINATION');
    }
  }

  if (offset !== undefined) {
    if (!Number.isInteger(offset)) {
      throw new RestoreHistoryError('Offset must be an integer', 'INVALID_PAGINATION');
    }
    if (offset < 0) {
      throw new RestoreHistoryError('Offset must be non-negative', 'INVALID_PAGINATION');
    }
    if (offset > VALIDATION.MAX_OFFSET) {
      throw new RestoreHistoryError(`Offset cannot exceed ${VALIDATION.MAX_OFFSET}`, 'INVALID_PAGINATION');
    }
  }
}

/**
 * Validate date range
 */
function validateDateRange(date: Date, fieldName: string): void {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new RestoreHistoryError(`${fieldName} must be a valid Date object`, 'INVALID_DATE');
  }
}

/**
 * Create a new restore history record
 *
 * @param input - Restore history creation input data
 * @returns The created restore history record
 *
 * @example
 * ```typescript
 * const restoreHistory = await createRestoreHistory({
 *   project_id: 'proj-123',
 *   backup_id: 'backup-456',
 *   file_id: 'telegram-file-789',
 *   status: RestoreStatus.PENDING,
 * });
 * ```
 */
export async function createRestoreHistory(input: CreateRestoreHistoryInput): Promise<RestoreHistory> {
  // Validate inputs
  validateProjectId(input.project_id);
  validateFileId(input.file_id);

  if (input.backup_id) {
    validateBackupId(input.backup_id);
  }

  if (input.status) {
    validateRestoreStatus(input.status);
  }

  if (input.error_message) {
    validateErrorMessage(input.error_message);
  }

  if (input.tables_restored !== undefined) {
    validateTablesRestored(input.tables_restored);
  }

  if (input.duration_ms !== undefined) {
    validateDuration(input.duration_ms);
  }

  if (input.backup_size !== undefined) {
    validateBackupSize(input.backup_size);
  }

  if (input.started_at) {
    validateDateRange(input.started_at, 'started_at');
  }

  if (input.completed_at) {
    validateDateRange(input.completed_at, 'completed_at');
  }

  // Generate a unique restore history ID
  const id = uuidv4();

  // Set default status to pending if not provided
  const status = input.status || RestoreStatus.PENDING;

  // Insert restore history record
  const queryText = `
    INSERT INTO control_plane.restore_history (
      id,
      project_id,
      backup_id,
      file_id,
      status,
      error_message,
      tables_restored,
      duration_ms,
      backup_size,
      started_at,
      completed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING
      id,
      project_id,
      backup_id,
      file_id,
      status,
      error_message,
      tables_restored,
      duration_ms,
      backup_size,
      created_at,
      started_at,
      completed_at
  `;

  const values = [
    id,
    input.project_id,
    input.backup_id || null,
    input.file_id,
    status,
    input.error_message || null,
    input.tables_restored || 0,
    input.duration_ms || null,
    input.backup_size || null,
    input.started_at || null,
    input.completed_at || null,
  ];

  try {
    const result = await query(queryText, values);
    const row = result.rows[0];

    if (!row) {
      throw new RestoreHistoryError('Failed to create restore history record', 'CREATE_FAILED');
    }

    return {
      id: row.id,
      project_id: row.project_id,
      backup_id: row.backup_id,
      file_id: row.file_id,
      status: row.status as RestoreStatus,
      error_message: row.error_message,
      tables_restored: row.tables_restored,
      duration_ms: row.duration_ms,
      backup_size: row.backup_size,
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
    };
  } catch (error) {
    console.error('Failed to create restore history:', error);
    if (error instanceof RestoreHistoryError) {
      throw error;
    }
    throw new RestoreHistoryError('Failed to create restore history record', 'DATABASE_ERROR');
  }
}

/**
 * Record a restore operation (creates or updates restore history)
 *
 * @param projectId - The project ID
 * @param backupId - Optional backup ID
 * @param fileId - The file ID
 * @param status - The restore status
 * @param errorMessage - Optional error message
 * @returns The created or updated restore history record
 *
 * @example
 * ```typescript
 * const restoreHistory = await recordRestoreOperation(
 *   'proj-123',
 *   'backup-456',
 *   'telegram-file-789',
 *   RestoreStatus.IN_PROGRESS
 * );
 * ```
 */
export async function recordRestoreOperation(
  projectId: string,
  backupId: string | undefined,
  fileId: string,
  status: RestoreStatus,
  errorMessage?: string
): Promise<RestoreHistory> {
  // If status is pending, create a new record
  if (status === RestoreStatus.PENDING) {
    return await createRestoreHistory({
      project_id: projectId,
      backup_id: backupId,
      file_id: fileId,
      status: RestoreStatus.PENDING,
    });
  }

  // For other statuses, we need to find the pending record and update it
  // Find the most recent pending restore for this project and file
  const findQuery = `
    SELECT id
    FROM control_plane.restore_history
    WHERE project_id = $1
      AND file_id = $2
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  try {
    const findResult = await query(findQuery, [projectId, fileId]);

    if (findResult.rows.length === 0) {
      // No pending record found, create a new one
      return await createRestoreHistory({
        project_id: projectId,
        backup_id: backupId,
        file_id: fileId,
        status,
        error_message: errorMessage,
      });
    }

    // Update the existing pending record
    const restoreHistoryId = findResult.rows[0].id;
    const updated = await updateRestoreStatus(restoreHistoryId, status, errorMessage);
    if (!updated) {
      throw new RestoreHistoryError('Failed to update restore status', 'UPDATE_FAILED');
    }
    // Type assertion: We've verified updated is not null above
    return updated as RestoreHistory;
  } catch (error) {
    console.error('Failed to record restore operation:', error);
    if (error instanceof RestoreHistoryError) {
      throw error;
    }
    throw new RestoreHistoryError('Failed to record restore operation', 'DATABASE_ERROR');
  }
}

/**
 * Update restore status
 *
 * @param restoreHistoryId - The restore history ID
 * @param status - The new status
 * @param errorMessage - Optional error message
 * @param tablesRestored - Optional tables restored count
 * @param durationMs - Optional duration in milliseconds
 * @param backupSize - Optional backup size
 * @returns The updated restore history record or null if not found
 *
 * @example
 * ```typescript
 * const updated = await updateRestoreStatus(
 *   'restore-history-123',
 *   RestoreStatus.COMPLETED,
 *   undefined,
 *   42,
 *   5000
 * );
 * ```
 */
export async function updateRestoreStatus(
  restoreHistoryId: string,
  status: RestoreStatus,
  errorMessage?: string,
  tablesRestored?: number,
  durationMs?: number,
  backupSize?: number
): Promise<RestoreHistory | null> {
  if (typeof restoreHistoryId !== 'string') {
    throw new RestoreHistoryError('Restore history ID must be a string', 'INVALID_RESTORE_HISTORY_ID');
  }
  if (restoreHistoryId.trim().length === 0) {
    throw new RestoreHistoryError('Restore history ID cannot be empty', 'INVALID_RESTORE_HISTORY_ID');
  }

  // Validate status
  validateRestoreStatus(status);

  // Validate optional fields
  if (errorMessage) {
    validateErrorMessage(errorMessage);
  }

  if (tablesRestored !== undefined) {
    validateTablesRestored(tablesRestored);
  }

  if (durationMs !== undefined) {
    validateDuration(durationMs);
  }

  if (backupSize !== undefined) {
    validateBackupSize(backupSize);
  }

  // Build update query
  const updatesList: string[] = [];
  const values: unknown[] = [restoreHistoryId];
  let paramIndex = 2;

  updatesList.push(`status = $${paramIndex++}`);
  values.push(status);

  if (errorMessage !== undefined) {
    updatesList.push(`error_message = $${paramIndex++}`);
    values.push(errorMessage);
  }

  if (tablesRestored !== undefined) {
    updatesList.push(`tables_restored = $${paramIndex++}`);
    values.push(tablesRestored);
  }

  if (durationMs !== undefined) {
    updatesList.push(`duration_ms = $${paramIndex++}`);
    values.push(durationMs);
  }

  if (backupSize !== undefined) {
    updatesList.push(`backup_size = $${paramIndex++}`);
    values.push(backupSize);
  }

  // Set timestamps based on status
  if (status === RestoreStatus.IN_PROGRESS) {
    updatesList.push(`started_at = $${paramIndex++}`);
    values.push(new Date());
  }

  if (status === RestoreStatus.COMPLETED || status === RestoreStatus.FAILED) {
    updatesList.push(`completed_at = $${paramIndex++}`);
    values.push(new Date());

    // If started_at is not set, set it to created_at (for fast completes)
    updatesList.push(`started_at = COALESCE(started_at, created_at)`);
  }

  const queryText = `
    UPDATE control_plane.restore_history
    SET ${updatesList.join(', ')}
    WHERE id = $1
    RETURNING
      id,
      project_id,
      backup_id,
      file_id,
      status,
      error_message,
      tables_restored,
      duration_ms,
      backup_size,
      created_at,
      started_at,
      completed_at
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
      backup_id: row.backup_id,
      file_id: row.file_id,
      status: row.status as RestoreStatus,
      error_message: row.error_message,
      tables_restored: row.tables_restored,
      duration_ms: row.duration_ms,
      backup_size: row.backup_size,
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
    };
  } catch (error) {
    console.error('Failed to update restore status:', error);
    throw new RestoreHistoryError('Failed to update restore status', 'DATABASE_ERROR');
  }
}

/**
 * Get restore history for a project
 *
 * @param projectId - The project ID
 * @param options - Optional query parameters for filtering and pagination
 * @returns Paginated restore history results
 *
 * @example
 * ```typescript
 * // Get all restore history for a project
 * const result = await getRestoreHistory('proj-123');
 *
 * // Get completed restores with pagination
 * const filtered = await getRestoreHistory('proj-123', {
 *   status: RestoreStatus.COMPLETED,
 *   limit: 20,
 *   offset: 0,
 * });
 * ```
 */
export async function getRestoreHistory(
  projectId: string,
  options: Omit<RestoreHistoryQuery, 'project_id'> = {}
): Promise<RestoreHistoryResponse> {
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
  if (options.backup_id) {
    validateBackupId(options.backup_id);
    conditions.push(`backup_id = $${paramIndex++}`);
    values.push(options.backup_id);
  }

  if (options.status) {
    validateRestoreStatus(options.status);
    conditions.push(`status = $${paramIndex++}`);
    values.push(options.status);
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

  if (options.min_duration_ms !== undefined) {
    validateDuration(options.min_duration_ms);
    conditions.push(`duration_ms >= $${paramIndex++}`);
    values.push(options.min_duration_ms);
  }

  if (options.max_duration_ms !== undefined) {
    validateDuration(options.max_duration_ms);
    conditions.push(`duration_ms <= $${paramIndex++}`);
    values.push(options.max_duration_ms);
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM control_plane.restore_history
    WHERE ${whereClause}
  `;

  // Get paginated results
  const dataQuery = `
    SELECT
      id,
      project_id,
      backup_id,
      file_id,
      status,
      error_message,
      tables_restored,
      duration_ms,
      backup_size,
      created_at,
      started_at,
      completed_at
    FROM control_plane.restore_history
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
        backup_id: row.backup_id as string | null,
        file_id: row.file_id as string,
        status: row.status as RestoreStatus,
        error_message: row.error_message as string | null,
        tables_restored: row.tables_restored as number,
        duration_ms: row.duration_ms as number | null,
        backup_size: row.backup_size as number | null,
        created_at: row.created_at as Date,
        started_at: row.started_at as Date | null,
        completed_at: row.completed_at as Date | null,
      })),
      total,
      limit,
      offset,
      has_more: hasMore,
    };
  } catch (error) {
    console.error('Failed to get restore history:', error);
    throw new RestoreHistoryError('Failed to retrieve restore history records', 'DATABASE_ERROR');
  }
}

/**
 * Get a single restore history record by ID
 *
 * @param id - The restore history ID
 * @returns The restore history record or null if not found
 *
 * @example
 * ```typescript
 * const restoreHistory = await getRestoreHistoryById('restore-history-123');
 * if (restoreHistory) {
 *   console.log('Restore status:', restoreHistory.status);
 * }
 * ```
 */
export async function getRestoreHistoryById(id: string): Promise<RestoreHistory | null> {
  if (typeof id !== 'string') {
    throw new RestoreHistoryError('Restore history ID must be a string', 'INVALID_RESTORE_HISTORY_ID');
  }
  if (id.trim().length === 0) {
    throw new RestoreHistoryError('Restore history ID cannot be empty', 'INVALID_RESTORE_HISTORY_ID');
  }

  const queryText = `
    SELECT
      id,
      project_id,
      backup_id,
      file_id,
      status,
      error_message,
      tables_restored,
      duration_ms,
      backup_size,
      created_at,
      started_at,
      completed_at
    FROM control_plane.restore_history
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
      backup_id: row.backup_id,
      file_id: row.file_id,
      status: row.status as RestoreStatus,
      error_message: row.error_message,
      tables_restored: row.tables_restored,
      duration_ms: row.duration_ms,
      backup_size: row.backup_size,
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
    };
  } catch (error) {
    console.error('Failed to get restore history by ID:', error);
    throw new RestoreHistoryError('Failed to retrieve restore history record', 'DATABASE_ERROR');
  }
}

/**
 * Get restore statistics for a project
 *
 * @param projectId - The project ID
 * @returns Restore statistics
 *
 * @example
 * ```typescript
 * const stats = await getRestoreStats('proj-123');
 * console.log('Total restores:', stats.total_restores);
 * console.log('Successful restores:', stats.successful_restores);
 * ```
 */
export async function getRestoreStats(projectId: string): Promise<RestoreStats> {
  validateProjectId(projectId);

  const queryText = `
    SELECT
      COUNT(*) as total_restores,
      COUNT(*) FILTER (WHERE status = 'completed') as successful_restores,
      COUNT(*) FILTER (WHERE status = 'failed') as failed_restores,
      COUNT(*) FILTER (WHERE status = 'pending') as pending_restores,
      AVG(duration_ms) FILTER (WHERE status = 'completed' AND duration_ms IS NOT NULL) as avg_duration_ms,
      MAX(created_at) as last_restore_at,
      MAX(created_at) FILTER (WHERE status = 'completed') as last_successful_restore_at
    FROM control_plane.restore_history
    WHERE project_id = $1
  `;

  try {
    const result = await query(queryText, [projectId]);
    const row = result.rows[0];

    if (!row) {
      return {
        total_restores: 0,
        successful_restores: 0,
        failed_restores: 0,
        pending_restores: 0,
        avg_duration_ms: 0,
      };
    }

    return {
      total_restores: parseInt(row.total_restores || '0', 10),
      successful_restores: parseInt(row.successful_restores || '0', 10),
      failed_restores: parseInt(row.failed_restores || '0', 10),
      pending_restores: parseInt(row.pending_restores || '0', 10),
      avg_duration_ms: Math.round(row.avg_duration_ms || 0),
      last_restore_at: row.last_restore_at ? new Date(row.last_restore_at) : undefined,
      last_successful_restore_at: row.last_successful_restore_at
        ? new Date(row.last_successful_restore_at)
        : undefined,
    };
  } catch (error) {
    console.error('Failed to get restore stats:', error);
    throw new RestoreHistoryError('Failed to retrieve restore statistics', 'DATABASE_ERROR');
  }
}

/**
 * Delete restore history records for a project
 *
 * @param projectId - The project ID
 * @param options - Optional filters for deletion
 * @returns Count of deleted records
 *
 * @example
 * ```typescript
 * // Delete all restore history for a project
 * const count = await deleteRestoreHistory('proj-123');
 *
 * // Delete only failed restores older than 30 days
 * const count = await deleteRestoreHistory('proj-123', {
 *   status: RestoreStatus.FAILED,
 *   created_before: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
 * });
 * ```
 */
export async function deleteRestoreHistory(
  projectId: string,
  options: Pick<RestoreHistoryQuery, 'status' | 'created_before'> = {} as Pick<
    RestoreHistoryQuery,
    'status' | 'created_before'
  >
): Promise<number> {
  validateProjectId(projectId);

  // Build delete conditions
  const conditions: string[] = ['project_id = $1'];
  const values: unknown[] = [projectId];
  let paramIndex = 2;

  if (options.status) {
    validateRestoreStatus(options.status);
    conditions.push(`status = $${paramIndex++}`);
    values.push(options.status);
  }

  if (options.created_before) {
    validateDateRange(options.created_before, 'created_before');
    conditions.push(`created_at < $${paramIndex++}`);
    values.push(options.created_before);
  }

  const whereClause = conditions.join(' AND ');

  const queryText = `
    DELETE FROM control_plane.restore_history
    WHERE ${whereClause}
    RETURNING id
  `;

  try {
    const result = await query(queryText, values);
    return result.rows.length;
  } catch (error) {
    console.error('Failed to delete restore history:', error);
    throw new RestoreHistoryError('Failed to delete restore history records', 'DATABASE_ERROR');
  }
}
