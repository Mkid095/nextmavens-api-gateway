/**
 * Monitoring Routes Module
 *
 * Exports monitoring webhook routes for integration with external
 * monitoring systems (Prometheus, Grafana, Datadog, etc.)
 */

export { default } from './monitoring.routes.js';
export {
  autoSuspendWebhook,
  monitoringWebhookHealth,
  monitoringWebhookDocs,
} from './monitoring.controller.js';
