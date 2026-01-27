# NextMavens API Gateway

Central supervisor layer for the NextMavens platform. All requests flow through the gateway for authentication, rate limiting, logging, and routing.

## Architecture

```
Client Request
     │
     ▼
┌─────────────────────────────────────────┐
│         API Gateway (Port 8080)          │
├─────────────────────────────────────────┤
│  ✅ API Key Validation                  │
│  ✅ Project → Tenant Resolution         │
│  ✅ Rate Limiting (Redis)               │
│  ✅ Request Logging                     │
│  ✅ CORS Enforcement                    │
│  ✅ Scope Checking                      │
└─────────┬───────────────────────────────┘
          │
          ▼
    ┌─────┴─────┬─────────┬──────────┐
    │           │         │          │
    ▼           ▼         ▼          ▼
  Auth       REST    GraphQL   Realtime  Storage
 (4000)     (3001)   (4004)    (4003)    (4005)
```

## Features

### Security
- **API Key Validation** - All requests must include valid API key
- **Key Type Checking** - Secret keys cannot be used on client side
- **Scope Enforcement** - Keys only have access to permitted operations
- **Rate Limiting** - Configurable per-project rate limits

### Observability
- **Request Logging** - All requests logged with metadata
- **Usage Tracking** - Per-project usage statistics
- **Service Health** - Health check for all backend services

### Routing
- **Smart Proxy** - Routes to appropriate service based on path
- **Header Injection** - Injects tenant/project context to services
- **Error Handling** - Graceful error responses

## Endpoints

| Path | Service | Auth Required |
|------|---------|---------------|
| `/api/auth/signup` | Auth | ❌ Public |
| `/api/auth/login` | Auth | ❌ Public |
| `/api/auth/*` | Auth | ✅ Required |
| `/api/*` | PostgREST | ✅ Required |
| `/graphql` | GraphQL | ✅ Required |
| `/realtime` | Realtime | ✅ Required |
| `/api/storage/*` | Storage | ✅ Required |
| `/api/developer/register` | Developer | ❌ Public |
| `/api/developer/login` | Developer | ❌ Public |

## API Key Format

```
nm_live_pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  (Public Key - Client side)
nm_live_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  (Secret Key - Server side)
```

## Usage

### Making Requests

**With Public Key (Client Side):**
```javascript
fetch('https://api.nextmavens.cloud/api/users', {
  headers: {
    'X-API-Key': 'nm_live_pk_xxxxxxxxxxxx'
  }
})
```

**With Secret Key (Server Side):**
```javascript
const response = await axios.get('https://api.nextmavens.cloud/graphql', {
  headers: {
    'X-API-Key': 'nm_live_sk_xxxxxxxxxxxx'
  }
});
```

### Headers Injected by Gateway

The gateway automatically injects these headers to backend services:

- `X-Tenant-ID` - Tenant UUID for the project
- `X-Project-ID` - Project ID
- `X-Developer-ID` - Developer ID

### Rate Limiting

Default: 100 requests per minute per API key

Custom rate limits can be set per project.

Response when rate limited:
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Limit: 100 per minute",
  "retryAfter": 45
}
```

### Scopes

API keys can have the following scopes:

- `read` - GET requests
- `write` - POST, PUT, PATCH requests
- `delete` - DELETE requests
- `*` - All permissions

## Monitoring

### Health Check
```bash
curl https://gateway.nextmavens.cloud/health
```

### Service Status
```bash
curl https://gateway.nextmavens.cloud/status/services
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GATEWAY_PORT` | Gateway port | `8080` |
| `DATABASE_URL` | PostgreSQL connection | - |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `JWT_SECRET` | JWT secret | - |

## Database Schema

### api_keys
- `id` - Primary key
- `project_id` - Reference to project
- `key_type` - 'public' or 'secret'
- `key_prefix` - 'nm_live_pk_' or 'nm_live_sk_'
- `key_hash` - SHA256 hash of full key
- `scopes` - Array of allowed scopes
- `rate_limit` - Custom rate limit
- `last_used` - Last usage timestamp
- `expires_at` - Optional expiration
- `revoked_at` - Revocation timestamp

### gateway_logs
- `id` - Primary key
- `request_id` - UUID for request tracking
- `project_id` - Reference to project
- `developer_id` - Reference to developer
- `method` - HTTP method
- `path` - Request path
- `status_code` - Response status
- `duration_ms` - Request duration
- `success` - Success flag
- `error_message` - Error if failed
- `ip_address` - Client IP
- `user_agent` - Client user agent
- `created_at` - Timestamp

## Deployment

1. Push code to GitHub
2. Deploy via Dokploy
3. Set environment variables
4. Update DNS to point `gateway.nextmavens.cloud` to server

## Security Notes

1. **Never expose secret keys** in client-side code
2. **Use public keys** in browsers/mobile apps
3. **Rotate keys regularly** - Generate new keys and revoke old ones
4. **Monitor usage logs** - Watch for suspicious activity
5. **Set appropriate scopes** - Don't give delete access unless needed
