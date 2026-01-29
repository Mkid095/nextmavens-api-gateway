/**
 * Backup Security Validator
 *
 * Provides security validation for backup operations.
 * Ensures all inputs are validated and sanitized before processing.
 */

/**
 * Security validation constants
 */
const SECURITY_LIMITS = {
  /** Maximum file size in bytes (50MB for Telegram bots) */
  MAX_FILE_SIZE: 50 * 1024 * 1024,

  /** Minimum file size (0 bytes allowed for empty backups) */
  MIN_FILE_SIZE: 0,

  /** Maximum project ID length */
  MAX_PROJECT_ID_LENGTH: 100,

  /** Maximum file ID length */
  MAX_FILE_ID_LENGTH: 500,

  /** Maximum backup ID length (UUID format) */
  MAX_BACKUP_ID_LENGTH: 36,
} as const;

/**
 * Custom error class for security validation errors
 */
export class BackupSecurityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'BackupSecurityError';
  }
}

/**
 * Validate project ID format and content
 * @param projectId - Project ID to validate
 * @throws BackupSecurityError if validation fails
 */
export function validateProjectId(projectId: string): void {
  if (!projectId || typeof projectId !== 'string') {
    throw new BackupSecurityError(
      'Project ID is required and must be a string',
      'INVALID_PROJECT_ID',
      400
    );
  }

  if (projectId.trim().length === 0) {
    throw new BackupSecurityError(
      'Project ID cannot be empty',
      'INVALID_PROJECT_ID',
      400
    );
  }

  if (projectId.length > SECURITY_LIMITS.MAX_PROJECT_ID_LENGTH) {
    throw new BackupSecurityError(
      `Project ID exceeds maximum length of ${SECURITY_LIMITS.MAX_PROJECT_ID_LENGTH} characters`,
      'INVALID_PROJECT_ID',
      400
    );
  }

  // Check for path traversal patterns
  if (projectId.includes('..') || projectId.includes('/') || projectId.includes('\\')) {
    throw new BackupSecurityError(
      'Project ID contains invalid characters',
      'INVALID_PROJECT_ID',
      400
    );
  }

  // Alphanumeric, hyphens, underscores only
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(projectId)) {
    throw new BackupSecurityError(
      'Project ID contains invalid characters. Only alphanumeric, hyphens, and underscores are allowed',
      'INVALID_PROJECT_ID',
      400
    );
  }
}

/**
 * Validate backup ID (UUID format)
 * @param backupId - Backup ID to validate
 * @throws BackupSecurityError if validation fails
 */
export function validateBackupId(backupId: string): void {
  if (!backupId || typeof backupId !== 'string') {
    throw new BackupSecurityError(
      'Backup ID is required and must be a string',
      'INVALID_BACKUP_ID',
      400
    );
  }

  if (backupId.trim().length === 0) {
    throw new BackupSecurityError(
      'Backup ID cannot be empty',
      'INVALID_BACKUP_ID',
      400
    );
  }

  if (backupId.length > SECURITY_LIMITS.MAX_BACKUP_ID_LENGTH) {
    throw new BackupSecurityError(
      'Backup ID exceeds maximum length',
      'INVALID_BACKUP_ID',
      400
    );
  }

  // UUID format validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(backupId)) {
    throw new BackupSecurityError(
      'Backup ID must be a valid UUID',
      'INVALID_BACKUP_ID',
      400
    );
  }
}

/**
 * Validate file ID
 * @param fileId - File ID to validate
 * @throws BackupSecurityError if validation fails
 */
export function validateFileId(fileId: string): void {
  if (!fileId || typeof fileId !== 'string') {
    throw new BackupSecurityError(
      'File ID is required and must be a string',
      'INVALID_FILE_ID',
      400
    );
  }

  if (fileId.trim().length === 0) {
    throw new BackupSecurityError(
      'File ID cannot be empty',
      'INVALID_FILE_ID',
      400
    );
  }

  if (fileId.length > SECURITY_LIMITS.MAX_FILE_ID_LENGTH) {
    throw new BackupSecurityError(
      `File ID exceeds maximum length of ${SECURITY_LIMITS.MAX_FILE_ID_LENGTH} characters`,
      'INVALID_FILE_ID',
      400
    );
  }
}

/**
 * Validate file size
 * @param fileSize - File size in bytes
 * @throws BackupSecurityError if validation fails
 */
export function validateFileSize(fileSize: number): void {
  if (typeof fileSize !== 'number') {
    throw new BackupSecurityError(
      'File size must be a number',
      'INVALID_FILE_SIZE',
      400
    );
  }

  if (!Number.isInteger(fileSize)) {
    throw new BackupSecurityError(
      'File size must be an integer',
      'INVALID_FILE_SIZE',
      400
    );
  }

  if (fileSize < SECURITY_LIMITS.MIN_FILE_SIZE) {
    throw new BackupSecurityError(
      `File size must be at least ${SECURITY_LIMITS.MIN_FILE_SIZE} bytes`,
      'INVALID_FILE_SIZE',
      400
    );
  }

  if (fileSize > SECURITY_LIMITS.MAX_FILE_SIZE) {
    throw new BackupSecurityError(
      `File size exceeds maximum allowed size of ${SECURITY_LIMITS.MAX_FILE_SIZE} bytes (50MB)`,
      'INVALID_FILE_SIZE',
      400
    );
  }
}

/**
 * Validate backup type
 * @param type - Backup type to validate
 * @throws BackupSecurityError if validation fails
 */
export function validateBackupType(type: string): void {
  if (!type || typeof type !== 'string') {
    throw new BackupSecurityError(
      'Backup type is required and must be a string',
      'INVALID_BACKUP_TYPE',
      400
    );
  }

  const validTypes = ['database', 'storage', 'logs'];
  if (!validTypes.includes(type)) {
    throw new BackupSecurityError(
      'Backup type must be one of: database, storage, logs',
      'INVALID_BACKUP_TYPE',
      400
    );
  }
}

/**
 * Validate email format for notifications
 * @param email - Email to validate
 * @throws BackupSecurityError if validation fails
 */
export function validateEmail(email: string): void {
  if (!email || typeof email !== 'string') {
    throw new BackupSecurityError(
      'Email must be a string',
      'INVALID_EMAIL',
      400
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new BackupSecurityError(
      'Invalid email format',
      'INVALID_EMAIL',
      400
    );
  }
}

/**
 * Sanitize error messages to prevent information leakage
 * @param error - Error to sanitize
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(error: Error): string {
  const message = error.message.toLowerCase();

  // Patterns that indicate sensitive information
  const sensitivePatterns = [
    /token/i,
    /password/i,
    /secret/i,
    /api[_-]?key/i,
    /authorization/i,
    /bot/i,
    /chat[_-]?id/i,
    /channel[_-]?id/i,
  ];

  // If error contains sensitive information, return generic message
  if (sensitivePatterns.some((pattern) => pattern.test(message))) {
    return 'An error occurred while processing your request';
  }

  return error.message;
}

/**
 * Validate that force flag is set for destructive operations
 * @param force - Force flag value
 * @throws BackupSecurityError if validation fails
 */
export function validateForceFlag(force: boolean): void {
  if (!force) {
    throw new BackupSecurityError(
      'This operation requires confirmation. Set force=true to proceed.',
      'CONFIRMATION_REQUIRED',
      400
    );
  }
}

/**
 * Security validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  code?: string;
}

/**
 * Validate all backup request parameters
 * @param params - Parameters to validate
 * @returns Validation result
 */
export function validateBackupRequest(
  params: {
    project_id?: string;
    backup_id?: string;
    file_id?: string;
    type?: string;
    file_size?: number;
    email?: string;
    force?: boolean;
  }
): ValidationResult {
  try {
    if (params.project_id) {
      validateProjectId(params.project_id);
    }

    if (params.backup_id) {
      validateBackupId(params.backup_id);
    }

    if (params.file_id) {
      validateFileId(params.file_id);
    }

    if (params.type) {
      validateBackupType(params.type);
    }

    if (params.file_size !== undefined) {
      validateFileSize(params.file_size);
    }

    if (params.email) {
      validateEmail(params.email);
    }

    if (params.force !== undefined && !params.force) {
      validateForceFlag(params.force);
    }

    return { valid: true };
  } catch (error) {
    if (error instanceof BackupSecurityError) {
      return {
        valid: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      valid: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
    };
  }
}
