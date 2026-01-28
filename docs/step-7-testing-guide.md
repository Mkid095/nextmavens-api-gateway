# Quick Testing Guide - Step 7 Integration

## Test the Protected Routes

### Start the Gateway
```bash
cd /home/ken/api-gateway
pnpm run dev
```

## Test Cases

### 1. Health Check (No Authentication Required)
```bash
curl http://localhost:8080/health
```

Expected: Gateway status and snapshot info

### 2. Gateway Info (Public)
```bash
curl http://localhost:8080/
```

Expected: Gateway information and feature list

### 3. Protected Route - Active Project (Success)
```bash
curl -H "x-project-id: proj-active-001" http://localhost:8080/api/protected
```

Expected: Success response with project validation

### 4. Protected Route - No Project ID (Error)
```bash
curl http://localhost:8080/api/protected
```

Expected:
```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Project ID required...",
    "retryable": false
  }
}
```

### 5. Protected Route - Suspended Project (Error)
```bash
# Assuming snapshot has a suspended project
curl -H "x-project-id: proj-suspended-002" http://localhost:8080/api/protected
```

Expected:
```json
{
  "error": {
    "code": "PROJECT_SUSPENDED",
    "message": "Project '...' is suspended...",
    "retryable": false
  }
}
```

### 6. POST Data Endpoint (Active Project)
```bash
curl -X POST \
  -H "x-project-id: proj-active-001" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}' \
  http://localhost:8080/api/data
```

Expected: Success response with data confirmation

### 7. Status Check Endpoint (Optional Validation)
```bash
# With project ID
curl -H "x-project-id: proj-active-001" http://localhost:8080/api/status

# Without project ID
curl http://localhost:8080/api/status
```

Expected: Project status information (doesn't reject if project not found)

### 8. Strict Validation Endpoint
```bash
curl -H "x-project-id: proj-active-001" http://localhost:8080/api/strict
```

Expected: Access granted confirmation

## Error Code Reference

| Error Code | Status | Description |
|------------|--------|-------------|
| BAD_REQUEST | 400 | Missing project ID |
| PROJECT_NOT_FOUND | 404 | Project doesn't exist |
| PROJECT_SUSPENDED | 403 | Project is suspended |
| PROJECT_ARCHIVED | 403 | Project is archived |
| PROJECT_DELETED | 403 | Project is deleted |
| SNAPSHOT_UNAVAILABLE | 503 | Snapshot service not initialized |
| INTERNAL_ERROR | 500 | Unexpected system error |

## Validation Flow

1. **Request arrives** → 2. **Extract project ID** → 3. **Get snapshot** → 4. **Lookup project** → 5. **Validate status** → 6. **Allow/Reject**

## Quick Validation Test

Test all three rejection scenarios:

```bash
# Suspended
curl -H "x-project-id: suspended-project" http://localhost:8080/api/protected

# Archived
curl -H "x-project-id: archived-project" http://localhost:8080/api/protected

# Deleted
curl -H "x-project-id: deleted-project" http://localhost:8080/api/protected
```

Each should return the appropriate error code.

## Success Test

```bash
# Active project (should succeed)
curl -H "x-project-id: active-project" http://localhost:8080/api/protected
```

Should return: `200 OK` with project validation success message.
