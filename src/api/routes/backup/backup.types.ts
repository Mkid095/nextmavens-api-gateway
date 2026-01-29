/**
 * Backup API Types
 *
 * Type definitions for the backup API endpoints.
 *
 * US-001: Create Manual Export API
 */

/**
 * Manual export request payload
 */
export interface ManualExportRequest {
  /**
   * The ID of the project to export
   */
  project_id: string;

  /**
   * Optional backup format
   * @default 'sql'
   */
  format?: 'sql' | 'tar';

  /**
   * Optional compression flag
   * @default true
   */
  compress?: boolean;

  /**
   * Optional notification email
   * If provided, sends notification when backup is complete
   */
  notify_email?: string;

  /**
   * Optional storage path
   * If not provided, uses default path
   */
  storage_path?: string;
}

/**
 * Backup export status
 */
export type BackupExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Manual export response data
 */
export interface ManualExportResponse {
  /**
   * The ID of the job created for this export
   */
  job_id: string;

  /**
   * The status of the export job
   */
  status: BackupExportStatus;

  /**
   * The ID of the project being exported
   */
  project_id: string;

  /**
   * Timestamp when the job was created
   */
  created_at: string;

  /**
   * Estimated completion time (if available)
   */
  estimated_completion?: string;
}

/**
 * Manual export API response wrapper
 */
export interface ManualExportApiResponse {
  /**
   * The response data
   */
  data: ManualExportResponse;
}

/**
 * Error response type
 */
export interface BackupErrorResponse {
  /**
   * Error message
   */
  error: string;

  /**
   * Error code
   */
  code?: string;

  /**
   * Additional details
   */
  details?: Record<string, unknown>;
}

/**
 * Restore request payload
 */
export interface RestoreRequest {
  /**
   * The ID of the backup to restore (optional if file_id is provided)
   */
  backup_id?: string;

  /**
   * The Telegram file ID to restore directly (optional if backup_id is provided)
   */
  file_id?: string;

  /**
   * The ID of the project (required for verification)
   */
  project_id: string;

  /**
   * Whether to force restore without confirmation
   * @default false
   */
  force?: boolean;

  /**
   * Whether to use async processing (for large backups)
   * @default false (auto-detected based on size)
   */
  async?: boolean;
}

/**
 * Restore operation status
 */
export type RestoreStatus = 'completed' | 'queued' | 'failed';

/**
 * Restore response data
 */
export interface RestoreResponse {
  /**
   * Whether the restore was successful
   */
  success: boolean;

  /**
   * The status of the restore operation
   */
  status: RestoreStatus;

  /**
   * Job ID if restore was queued (for large backups)
   */
  job_id?: string;

  /**
   * Error message if failed
   */
  error?: string;

  /**
   * Number of tables restored (if successful)
   */
  tables_restored?: number;

  /**
   * Size of backup in bytes
   */
  backup_size?: number;

  /**
   * Duration of restore in milliseconds
   */
  duration_ms?: number;

  /**
   * Warning about data overwrite
   */
  warning: string;

  /**
   * Timestamp when restore was initiated
   */
  created_at: string;
}

/**
 * Restore API response wrapper
 */
export interface RestoreApiResponse {
  /**
   * The response data
   */
  data: RestoreResponse;
}
