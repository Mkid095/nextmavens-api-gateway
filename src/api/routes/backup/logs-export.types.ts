/**
 * Logs Export API Types
 *
 * Type definitions for the logs export API endpoints.
 *
 * US-008: Export Logs
 */

/**
 * Log export format options
 */
export type LogExportFormat = 'json' | 'text';

/**
 * Logs export request payload
 */
export interface LogsExportRequest {
  /**
   * The ID of the project to export logs for
   */
  project_id: string;

  /**
   * Optional format for the export
   * @default 'json'
   */
  format?: LogExportFormat;

  /**
   * Optional date range filter
   * If not provided, exports all logs
   */
  date_range?: {
    /**
     * Start date (ISO 8601 format)
     */
    from: string;

    /**
     * End date (ISO 8601 format)
     */
    to: string;
  };

  /**
   * Optional filter by action type
   * If not provided, includes all actions
   */
  action_filter?: string[];

  /**
   * Optional filter by actor type
   * @default ['user', 'system', 'api_key']
   */
  actor_type_filter?: ('user' | 'system' | 'api_key')[];

  /**
   * Optional maximum number of log entries
   * @default 10000
   */
  max_entries?: number;

  /**
   * Optional notification email
   * If provided, sends notification when export is complete
   */
  notify_email?: string;

  /**
   * Whether to send the exported logs to Telegram storage
   * @default true
   */
  send_to_telegram?: boolean;

  /**
   * Optional Telegram storage path
   * If not provided, uses default path: /logs/{project_id}/{timestamp}.{format}
   */
  storage_path?: string;

  /**
   * Optional compression flag
   * @default true for exports over 10MB
   */
  compress?: boolean;
}

/**
 * Logs export status
 */
export type LogsExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Logs export response data
 */
export interface LogsExportResponse {
  /**
   * The ID of the job created for this export
   */
  job_id: string;

  /**
   * The status of the export job
   */
  status: LogsExportStatus;

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

  /**
   * Number of log entries to be exported (if known)
   */
  estimated_entry_count?: number;
}

/**
 * Logs export API response wrapper
 */
export interface LogsExportApiResponse {
  /**
   * The response data
   */
  data: LogsExportResponse;
}

/**
 * Logs export metadata (returned by job handler)
 */
export interface LogsExportMetadata extends Record<string, unknown> {
  /**
   * The ID of the project that was exported
   */
  projectId: string;

  /**
   * The format of the export file
   */
  format: LogExportFormat;

  /**
   * Whether the export was compressed
   */
  compressed: boolean;

  /**
   * Size of the export file in bytes
   */
  sizeBytes: number;

  /**
   * Storage location where export was uploaded (if sent to Telegram)
   */
  storagePath?: string;

  /**
   * Telegram file ID (if uploaded to Telegram)
   */
  fileId?: string;

  /**
   * Timestamp when export was created
   */
  createdAt: Date;

  /**
   * Duration of the export process in milliseconds
   */
  durationMs: number;

  /**
   * Number of log entries exported
   */
  entryCount: number;

  /**
   * Date range of exported logs
   */
  dateRange?: {
    from: string;
    to: string;
  };

  /**
   * Whether the export was sent to Telegram
   */
  sentToTelegram: boolean;

  /**
   * Backup history record ID (if recording was successful)
   */
  backupHistoryId?: string;
}

/**
 * Error response type
 */
export interface LogsExportErrorResponse {
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
