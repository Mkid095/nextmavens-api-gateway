# Auto-Suspend Job Handler - Monitoring Integration Guide

## Overview

The Auto-Suspend Job Handler provides integration points for external monitoring systems to automatically trigger project suspension when abuse patterns are detected. This guide covers how to integrate various monitoring systems with the auto-suspend functionality.

## Table of Contents

- [Integration Methods](#integration-methods)
- [Supported Monitoring Systems](#supported-monitoring-systems)
- [API Endpoints](#api-endpoints)
- [Programmatic Integration](#programmatic-integration)
- [Monitoring System Examples](#monitoring-system-examples)
- [Payload Format](#payload-format)
- [Security Considerations](#security-considerations)
- [Testing](#testing)

## Integration Methods

There are three ways to integrate monitoring systems:

1. **Webhook API**: POST to `/api/monitoring/webhook/auto-suspend`
2. **Direct Function Calls**: Use `triggerAutoSuspendFromMetrics()` in your code
3. **Metric Analysis**: Use `triggerAutoSuspendFromAnalysis()` for real-time analysis

## Supported Monitoring Systems

- **Prometheus** (Alertmanager webhooks)
- **Grafana** (Alert webhooks)
- **Datadog** (Webhook integrations)
- **Custom solutions** (HTTP-based monitoring systems)

## API Endpoints

### POST /api/monitoring/webhook/auto-suspend

Webhook endpoint for triggering auto-suspend jobs.

**Request Headers:**
```
Content-Type: application/json
X-API-Key: your-api-key
```

**Request Body:**
```json
{
  "project_id": "proj-123",
  "pattern_type": "excessive_usage",
  "metrics": {
    "requests_per_minute": 5000,
    "baseline_requests_per_minute": 500
  },
  "source": "prometheus",
  "enforce_action": true,
  "context": "Optional context about the alert"
}
```

**Response:**
```json
{
  "success": true,
  "job_id": "uuid-v4",
  "processed_at": "2026-01-29T14:30:00.000Z"
}
```

### GET /api/monitoring/webhook/health

Health check endpoint to verify webhook availability.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-29T14:30:00.000Z",
  "endpoints": {
    "auto_suspend": "/api/monitoring/webhook/auto-suspend"
  }
}
```

### GET /api/monitoring/docs

API documentation for monitoring integration.

## Programmatic Integration

### Direct Trigger from Metrics

Use this when you have pre-collected metrics from your monitoring system:

```typescript
import { triggerAutoSuspendFromMetrics, AbusePatternType } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';

const result = await triggerAutoSuspendFromMetrics({
  projectId: 'proj-123',
  patternType: AbusePatternType.EXCESSIVE_USAGE,
  metrics: {
    requests_per_minute: 5000,
    baseline_requests_per_minute: 500,
  },
  source: 'prometheus',
  enforceAction: true,
});

if (result.success) {
  console.log(`Enqueued auto-suspend job: ${result.job_id}`);
}
```

### Trigger with Real-Time Analysis

Use this to let the monitoring integration collect and analyze metrics:

```typescript
import { triggerAutoSuspendFromAnalysis, AbusePatternType } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';

const result = await triggerAutoSuspendFromAnalysis({
  projectId: 'proj-123',
  patternType: AbusePatternType.EXCESSIVE_USAGE,
  source: 'scheduled',
  enforceAction: true,
});

if (result.success) {
  console.log(`Auto-suspend triggered: ${result.job_id}`);
  console.log(`Metrics collected:`, result.metrics_collected);
} else {
  console.log(`No abuse detected: ${result.reason}`);
}
```

### Batch Check Multiple Projects

```typescript
import { batchCheckProjectsForAbuse, AbusePatternType } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';

const results = await batchCheckProjectsForAbuse({
  projectIds: ['proj-123', 'proj-456', 'proj-789'],
  patternType: AbusePatternType.EXCESSIVE_USAGE,
  source: 'scheduled',
  enforceAction: true,
});

const suspended = results.filter(r => r.success);
console.log(`Suspended ${suspended.length} projects`);
```

## Monitoring System Examples

### Prometheus Integration

#### Alertmanager Configuration

Configure Alertmanager to send webhooks when alerts fire:

```yaml
# alertmanager.yml
receivers:
  - name: 'auto-suspend-webhook'
    webhook_configs:
      - url: 'https://your-api-gateway.com/api/monitoring/webhook/auto-suspend'
        http_config:
          headers:
            'X-API-Key': 'your-api-key'
            'Content-Type': 'application/json'
        send_resolved: false

route:
  receiver: 'auto-suspend-webhook'
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
```

#### Prometheus Alert Rules

Define alert rules for abuse detection:

```yaml
# alerts.yml
groups:
  - name: abuse_detection
    interval: 1m
    rules:
      - alert: ExcessiveUsageDetected
        expr: |
          rate(requests_total{project_id=~"proj-.*"}[5m])
          > 1000
        for: 2m
        labels:
          severity: critical
          pattern_type: excessive_usage
        annotations:
          summary: "Excessive usage detected for {{ $labels.project_id }}"
          project_id: "{{ $labels.project_id }}"
          requests_per_minute: "{{ $value }}"

      - alert: HighErrorRateDetected
        expr: |
          rate(error_requests_total{project_id=~"proj-.*"}[5m])
          / rate(requests_total{project_id=~"proj-.*"}[5m])
          > 0.5
        for: 5m
        labels:
          severity: critical
          pattern_type: error_spike
        annotations:
          summary: "High error rate detected for {{ $labels.project_id }}"
          project_id: "{{ $labels.project_id }}"
          error_rate: "{{ $value }}"
```

#### Webhook Template for Prometheus

Create a custom webhook template to format alerts correctly:

```yaml
# alertmanager.yml
templates:
  - '/etc/alertmanager/templates/auto-suspend.tmpl'

# auto-suspend.tmpl
{{ define "auto-suspend-payload" }}
{
  "project_id": "{{ .CommonLabels.project_id }}",
  "pattern_type": "{{ .CommonLabels.pattern_type }}",
  "metrics": {
    {{ if eq .CommonLabels.pattern_type "excessive_usage" }}
    "requests_per_minute": {{ .CommonAnnotations.requests_per_minute }},
    "baseline_requests_per_minute": 500
    {{ else if eq .CommonLabels.pattern_type "error_spike" }}
    "error_rate": {{ .CommonAnnotations.error_rate }},
    "total_requests": 1000,
    "error_count": 500
    {{ end }}
  },
  "source": "prometheus",
  "enforce_action": true
}
{{ end }}
```

### Grafana Integration

#### Configure Webhook Alert Notification

1. Go to **Configuration** → **Alerting** → **Notification channels**
2. Add new notification channel:
   - **Type**: Webhook
   - **Name**: Auto-Suspend Webhook
   - **URL**: `https://your-api-gateway.com/api/monitoring/webhook/auto-suspend`
   - **Http Method**: POST
   - **Custom Headers**:
     ```
     X-API-Key: your-api-key
     Content-Type: application/json
     ```

#### Grafana Alert Query Example

```json
{
  "conditions": [
    {
      "evaluator": {
        "params": [10],
        "type": "gt"
      },
      "operator": {
        "type": "and"
      },
      "query": {
        "params": ["A", "5m", "now"]
      },
      "reducer": {
        "params": [],
        "type": "avg"
      },
      "type": "query"
    }
  ],
  "execErrState": "alerting",
  "noDataState": "no_data",
  "title": "Auto-Suspend: Excessive Usage"
}
```

#### Custom Payload Template

In Grafana, you can set a custom payload for webhooks:

```json
{
  "project_id": "${project_id}",
  "pattern_type": "excessive_usage",
  "metrics": {
    "requests_per_minute": "${value}",
    "baseline_requests_per_minute": "${baseline}"
  },
  "source": "grafana",
  "enforce_action": true
}
```

### Datadog Integration

#### Webhook Configuration

1. Go to **Monitors** → **Manage Distributions**
2. Create a new monitor or edit existing one
3. In the **Notify your team** section, add a Webhook integration

#### Webhook Definition

```yaml
# Webhook URL
https://your-api-gateway.com/api/monitoring/webhook/auto-suspend

# Custom Headers
X-API-Key: your-api-key
Content-Type: application/json

# Payload Template
{
  "project_id": "{{project_id.name}}",
  "pattern_type": "excessive_usage",
  "metrics": {
    "requests_per_minute": {{metric.value}},
    "baseline_requests_per_minute": {{metric.baseline}}
  },
  "source": "datadog",
  "enforce_action": true
}
```

#### Datadog Monitor Query

```
avg(last_5m):sum:requests.total{project_id:*} by {project_id} > 1000
```

### Custom Monitoring System

For custom monitoring systems, use the following cURL command:

```bash
curl -X POST https://your-api-gateway.com/api/monitoring/webhook/auto-suspend \
  -H 'X-API-Key: your-api-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id": "proj-123",
    "pattern_type": "excessive_usage",
    "metrics": {
      "requests_per_minute": 5000,
      "baseline_requests_per_minute": 500
    },
    "source": "custom-monitoring",
    "enforce_action": true,
    "context": "Detected by custom monitoring system"
  }'
```

## Payload Format

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `project_id` | string | Project ID to evaluate (must start with `proj-`) |
| `pattern_type` | string | Abuse pattern: `excessive_usage`, `error_spike`, or `suspicious_pattern` |
| `metrics` | object | Metrics that triggered the detection |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Monitoring system identifier (e.g., `prometheus`, `grafana`) |
| `enforce_action` | boolean | Whether to actually suspend (default: `true`) |
| `context` | string | Additional context about the alert |
| `alert_timestamp` | string | ISO timestamp of when the alert was triggered |

### Metrics by Pattern Type

#### Excessive Usage

```json
{
  "metrics": {
    "requests_per_minute": 5000,
    "baseline_requests_per_minute": 500
  }
}
```

**Thresholds:**
- Current requests per minute ≥ 1,000
- Usage multiplier ≥ 10x (current / baseline)

#### Error Spike

```json
{
  "metrics": {
    "error_rate": 0.65,
    "error_count": 650,
    "total_requests": 1000
  }
}
```

**Thresholds:**
- Total requests ≥ 100
- Error rate ≥ 0.5 (50%)

#### Suspicious Pattern

```json
{
  "metrics": {
    "pattern_details": {
      "rapid_sequential_requests": true,
      "same_ip_multiple_accounts": true,
      "anomaly_score": 0.95
    }
  }
}
```

No automatic thresholds - requires manual review.

## Security Considerations

### Authentication

**IMPORTANT**: In production, protect webhook endpoints with:

1. **API Key Authentication**: Require `X-API-Key` header
2. **IP Whitelist**: Only allow requests from known monitoring servers
3. **HTTPS**: Always use encrypted connections
4. **Rate Limiting**: Prevent abuse of the webhook endpoint

### API Key Example

```typescript
// Add authentication middleware
import { Router } from 'express';

const router = Router();

function validateApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.MONITORING_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.post('/webhook/auto-suspend', validateApiKey, autoSuspendWebhook);
```

### IP Whitelist Example

```typescript
import rateLimit from 'express-rate-limit';
import { Request } from 'express';

const ALLOWED_IPS = new Set([
  '10.0.0.1',  // Prometheus server
  '10.0.0.2',  // Grafana server
  '10.0.0.3',  // Datadog webhook forwarder
]);

function ipWhitelist(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.connection.remoteAddress;
  if (!ALLOWED_IPS.has(ip)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.post('/webhook/auto-suspend', ipWhitelist, autoSuspendWebhook);
```

### Rate Limiting

```typescript
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
});

router.use('/webhook', limiter);
```

## Testing

### Manual Testing with cURL

```bash
# Test excessive usage detection
curl -X POST http://localhost:3000/api/monitoring/webhook/auto-suspend \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id": "proj-test-123",
    "pattern_type": "excessive_usage",
    "metrics": {
      "requests_per_minute": 5000,
      "baseline_requests_per_minute": 500
    },
    "source": "manual-test",
    "enforce_action": false
  }'

# Test error spike detection
curl -X POST http://localhost:3000/api/monitoring/webhook/auto-suspend \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id": "proj-test-123",
    "pattern_type": "error_spike",
    "metrics": {
      "error_rate": 0.65,
      "error_count": 650,
      "total_requests": 1000
    },
    "source": "manual-test",
    "enforce_action": false
  }'
```

### Programmatic Testing

```typescript
import { triggerAutoSuspendFromMetrics, AbusePatternType } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';

// Test with dry-run mode
const result = await triggerAutoSuspendFromMetrics({
  projectId: 'proj-test-123',
  patternType: AbusePatternType.EXCESSIVE_USAGE,
  metrics: {
    requests_per_minute: 5000,
    baseline_requests_per_minute: 500,
  },
  enforceAction: false, // Dry-run mode
});

console.log('Test result:', result);
```

### Integration Tests

Run the provided test suite:

```bash
cd /home/ken/api-gateway
pnpm test src/lib/jobs/handlers/monitoring/__tests__/monitoring-trigger.test.ts
pnpm test src/api/routes/monitoring/__tests__/monitoring.controller.test.ts
```

## Common Patterns

### Scheduled Health Checks

Run periodic abuse detection checks:

```typescript
// In a scheduled job or cron task
import { batchCheckProjectsForAbuse, AbusePatternType } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';

async function runScheduledAbuseCheck() {
  // Get all active projects
  const activeProjects = await getActiveProjects();

  // Check for excessive usage
  const results = await batchCheckProjectsForAbuse({
    projectIds: activeProjects.map(p => p.id),
    patternType: AbusePatternType.EXCESSIVE_USAGE,
    source: 'scheduled',
    enforceAction: true,
  });

  // Log results
  const suspendedCount = results.filter(r => r.success).length;
  console.log(`Scheduled check: Suspended ${suspendedCount} projects`);
}

// Run every hour
setInterval(runScheduledAbuseCheck, 60 * 60 * 1000);
```

### Alert Aggregation

Aggregate multiple alerts before triggering:

```typescript
import { triggerAutoSuspendFromMetrics, AbusePatternType } from '@/lib/jobs/handlers/monitoring/monitoring-trigger';

const alertBuffer = new Map<string, number>();

function onAlertReceived(projectId: string, severity: number) {
  const currentScore = alertBuffer.get(projectId) || 0;
  const newScore = currentScore + severity;

  alertBuffer.set(projectId, newScore);

  // Trigger auto-suspend if score exceeds threshold
  if (newScore >= 100) {
    triggerAutoSuspendFromMetrics({
      projectId,
      patternType: AbusePatternType.SUSPICIOUS_PATTERN,
      metrics: {
        pattern_details: {
          aggregated_alert_score: newScore,
          alert_count: Math.floor(newScore / 10),
        },
      },
      source: 'aggregated-alerts',
    });

    alertBuffer.delete(projectId);
  }
}
```

## Troubleshooting

### Common Issues

1. **"Invalid project_id format"**
   - Ensure project ID starts with `proj-`
   - Check for typos in the project ID

2. **"Metrics do not meet threshold"**
   - Verify metrics exceed the required thresholds
   - Check that baseline metrics are accurate

3. **"Project not found"**
   - Ensure the project exists in the database
   - Check that the project is not already suspended

4. **Webhook returns 400/500**
   - Verify payload format is correct
   - Check API logs for detailed error messages
   - Ensure all required fields are present

### Debug Mode

Enable debug logging:

```typescript
// Set environment variable
process.env.DEBUG = 'monitoring-trigger:*';

// Logs will show:
// - Incoming webhook payloads
// - Metric collection results
// - Threshold verification
// - Job enqueue results
```

## Related Files

- **Handler**: `/home/ken/api-gateway/src/lib/jobs/handlers/auto-suspend.handler.ts`
- **Trigger**: `/home/ken/api-gateway/src/lib/jobs/handlers/monitoring/monitoring-trigger.ts`
- **Controller**: `/home/ken/api-gateway/src/api/routes/monitoring/monitoring.controller.ts`
- **Routes**: `/home/ken/api-gateway/src/api/routes/monitoring/monitoring.routes.ts`

## Support

For issues or questions about monitoring integration:

1. Check the API documentation: `GET /api/monitoring/docs`
2. Review handler implementation: `auto-suspend.handler.ts`
3. Run integration tests to verify setup
4. Check logs for detailed error messages
