# Monitoring Integration Security Documentation

## Overview

The auto-suspend monitoring integration allows external monitoring systems (Prometheus, Grafana, Datadog) to trigger automatic project suspension when abuse patterns are detected. This document outlines the security measures implemented and deployment requirements.

## Critical Security Requirements

### 1. Authentication (REQUIRED)

**CRITICAL**: The monitoring webhook endpoint requires authentication via a shared secret API key.

**Environment Variable:**
```bash
MONITORING_API_KEY=your-super-secret-key-here
```

**How it works:**
- Clients must include the API key in the `X-Monitoring-API-Key` header
- The key is compared using constant-time comparison to prevent timing attacks
- Requests without a valid key are rejected with 401 Unauthorized

**Example Request:**
```bash
curl -X POST https://your-api.com/api/monitoring/webhook/auto-suspend \
  -H 'X-Monitoring-API-Key: your-super-secret-key-here' \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id": "proj-123",
    "pattern_type": "excessive_usage",
    "metrics": {
      "requests_per_minute": 5000,
      "baseline_requests_per_minute": 500
    },
    "source": "prometheus"
  }'
```

### 2. Rate Limiting (IMPLEMENTED)

To prevent abuse of the webhook endpoint, rate limiting is applied:

- **Limit**: 10 requests per minute per client
- **Window**: 60 seconds
- **Identification**: By monitoring source + IP address

**Rate Limit Headers:**
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Time when the rate limit resets
- `Retry-After`: Seconds to wait before retrying (on 429 responses)

### 3. IP Whitelisting (RECOMMENDED FOR PRODUCTION)

For additional security, restrict webhook access to known monitoring server IPs.

**Implementation:**
```typescript
import { ipWhitelist } from '@/api/middleware/monitoring-auth.middleware.js';

const allowedIps = [
  '10.0.0.1',        // Prometheus server IP
  '192.168.1.0/24',  // Monitoring subnet
];

router.post('/webhook/auto-suspend',
  ipWhitelist(allowedIps),
  requireMonitoringApiKey,
  monitoringWebhookRateLimit,
  autoSuspendWebhook
);
```

### 4. Input Validation (IMPLEMENTED)

All inputs are validated before processing:

- **project_id**: Must match format `proj-[a-zA-Z0-9_-]+`
- **pattern_type**: Must be one of: `excessive_usage`, `error_spike`, `suspicious_pattern`
- **metrics**: Must be an object with valid numeric values

### 5. SQL Injection Prevention (IMPLEMENTED)

All database queries use parameterized statements with `$1, $2, etc.` placeholders. No string concatenation in SQL queries.

### 6. Error Handling (IMPLEMENTED)

- Generic error messages that don't reveal system details
- No exposure of whether a project exists or not
- All errors logged for debugging but not exposed to clients

### 7. Audit Trail (IMPLEMENTED)

All abuse detection events are logged to the `control_plane.audit_logs` table:

```sql
INSERT INTO control_plane.audit_logs (
  actor_id,
  actor_type,
  action,
  target_type,
  target_id,
  metadata
) VALUES (
  'system',
  'system',
  'abuse.detected',
  'project',
  'proj-123',
  '{"pattern_type": "excessive_usage", "action_taken": "project_suspended", ...}'
);
```

## Abuse Detection Thresholds

The following thresholds are used to detect abuse:

### Excessive Usage
- **Minimum requests**: 1,000 requests per minute
- **Multiplier**: Current rate must be >= 10x baseline rate
- **Baseline**: Calculated from past 7 days of activity

### Error Spike
- **Minimum requests**: 100 total requests in measurement window
- **Error rate**: Must be >= 50% error rate
- **Window**: Last 1 hour of activity

### Suspicious Pattern
- Requires manual review
- Must include `pattern_details` with evidence
- Supports custom detection logic

## Security Checklist

Before deploying to production:

- [ ] Set `MONITORING_API_KEY` environment variable
- [ ] Enable HTTPS only (TLS 1.2+)
- [ ] Configure IP whitelist for monitoring servers
- [ ] Review rate limiting limits
- [ ] Set up monitoring for the webhook endpoint itself
- [ ] Configure alerting for failed authentication attempts
- [ ] Test webhook with invalid keys to ensure rejection
- [ ] Review audit log retention policy
- [ ] Document incident response procedure for false positives

## Incident Response

If a project is incorrectly suspended:

1. **Identify the cause**: Check audit logs for the suspension reason
2. **Verify metrics**: Review the metrics that triggered the suspension
3. **Unsuspend if false positive**: Use admin API to unsuspend
4. **Adjust thresholds**: If pattern is legitimate, adjust detection thresholds
5. **Monitor**: Keep project under close watch after reactivation

## Monitoring System Configuration

### Prometheus Alertmanager

```yaml
receivers:
  - name: 'auto-suspend-webhook'
    webhook_configs:
      - url: 'https://your-api.com/api/monitoring/webhook/auto-suspend'
        http_config:
          headers:
            'X-Monitoring-API-Key': 'your-super-secret-key-here'
            'Content-Type': 'application/json'
        send_resolved: false
```

### Grafana Alerts

Configure webhook notification with:
- URL: `https://your-api.com/api/monitoring/webhook/auto-suspend`
- Header: `X-Monitoring-API-Key: your-super-secret-key-here`
- Method: POST

### Datadog Monitors

Webhook URL: `https://your-api.com/api/monitoring/webhook/auto-suspend`
Custom Header: `X-Monitoring-API-Key: your-super-secret-key-here`

## Testing

### Test Authentication

```bash
# Should succeed
curl -X POST https://your-api.com/api/monitoring/webhook/auto-suspend \
  -H 'X-Monitoring-API-Key: your-super-secret-key-here' \
  -H 'Content-Type: application/json' \
  -d '{"project_id": "proj-123", "pattern_type": "excessive_usage", "metrics": {"requests_per_minute": 5000, "baseline_requests_per_minute": 500}}'

# Should fail (401)
curl -X POST https://your-api.com/api/monitoring/webhook/auto-suspend \
  -H 'X-Monitoring-API-Key: wrong-key' \
  -H 'Content-Type: application/json' \
  -d '{"project_id": "proj-123", "pattern_type": "excessive_usage", "metrics": {"requests_per_minute": 5000, "baseline_requests_per_minute": 500}}'
```

### Test Rate Limiting

```bash
# Send 11 requests rapidly - the 11th should return 429
for i in {1..11}; do
  curl -X POST https://your-api.com/api/monitoring/webhook/auto-suspend \
    -H 'X-Monitoring-API-Key: your-super-secret-key-here' \
    -H 'Content-Type: application/json' \
    -d '{"project_id": "proj-123", "pattern_type": "excessive_usage", "metrics": {"requests_per_minute": 5000, "baseline_requests_per_minute": 500}}'
  echo "Request $i: $(curl -s -o /dev/null -w '%{http_code}')"
done
```

## Monitoring and Alerting

Monitor these metrics for the monitoring integration itself:

- Webhook request rate
- Authentication failure rate
- Rate limit violations
- Request processing time
- Error rates in job processing

Set up alerts for:
- > 10 authentication failures per minute
- > 100 rate limit violations per hour
- Job processing failure rate > 5%

## References

- OWASP API Security Top 10: https://owasp.org/www-project-api-security/
- Rate Limiting Best Practices: https://cloud.google.com/architecture/rate-limiting-strategies-techniques
- Webhook Security: https://www.twilio.com/docs/webhooks/webhooks-security
