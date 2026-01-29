/**
 * Restore History Types
 *
 * Type definitions for the restore_history table in the control_plane schema.
 * These types ensure type-safe restore tracking throughout the application.
 *
 * US-006: Implement Restore from Backup - Step 7: Data Layer
 */

/**
 * Restore status enumeration
 * Defines the possible states of a restore operation
 */
export enum RestoreStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

/**
 * Complete restore history structure
 * Represents a row in the restore_history table
 */
export interface RestoreHistory {
  id: string;
  project_id: string;
  backup_id: string | null;
  file_id: string;
  status: RestoreStatus;
  error_message: string | null;
  tables_restored: number;
  duration_ms: number | null;
  backup_size: number | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

/**
 * Input interface for creating a new restore history record
 * All fields except id and timestamps are required
 */
export interface CreateRestoreHistoryInput {
  project_id: string;
  backup_id?: string;
  file_id: string;
  status?: RestoreStatus;
  error_message?: string;
  tables_restored?: number;
  duration_ms?: number;
  backup_size?: number;
  started_at?: Date;
  completed_at?: Date;
}

/**
 * Query parameters for filtering restore history
 * Used in API endpoints and search functions
 */
export interface RestoreHistoryQuery {
  project_id?: string;
  backup_id?: string;
  status?: RestoreStatus;
  created_before?: Date;
  created_after?: Date;
  min_duration_ms?: number;
  max_duration_ms?: number;
  limit?: number;
  offset?: number;
}

/**
 * Paginated restore history response
 */
export interface RestoreHistoryResponse {
  data: RestoreHistory[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/**
 * Restore statistics for a project
 */
export interface RestoreStats {
  total_restores: number;
  successful_restores: number;
  failed_restores: number;
  pending_restores: number;
  avg_duration_ms: number;
  last_restore_at?: Date;
  last_successful_restore_at?: Date;
}

/**
 * Restore history summary
 * Used for display in UI
 */
export interface RestoreHistorySummary {
  id: string;
  project_id: string;
  backup_id: string | null;
  status: RestoreStatus;
  created_at: Date;
  completed_at: Date | null;
  duration_ms: number | null;
  success: boolean;
}
