/**
 * Security Monitoring API Routes
 * Provides endpoints for security monitoring, alerts, and audit trails
 * 
 * Phase 57-05: Security Monitoring and Audit Trail
 * RESTful API for security dashboard and alert management
 */

'use strict';

const express = require('express');
const router = express.Router();

const {
  monitorTokenUsage,
  monitorAuthentication,
  monitorCredentialRotation,
  getSecurityDashboard,
  getClientSecurityReport,
  resolveAlert,
  generateSecurityAlert,
  cleanupSecurityData,
  SECURITY_CONFIG,
  securityMetrics
} = require('../services/securityMonitoringService');

const { writeExchangeEvent } = require('../services/exchangeAuditStore');

/**
 * Middleware for admin-only endpoints
 */
function requireAdminAccess(req, res, next) {
  // Check if user has admin privileges
  const isAdmin = req.auth?.scopes?.includes('admin:read');
  
  if (!isAdmin) {
    return res.status(403).json({
      error: 'admin_required',
      message: 'Admin access required for this operation'
    });
  }
  
  next();
}

/**
 * GET /api/security/dashboard
 * Get comprehensive security dashboard data
 */
router.get('/dashboard', requireAdminAccess, async (req, res) => {
  try {
    const dashboard = getSecurityDashboard();
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'security_dashboard_viewed',
      dashboard_summary: {
        active_alerts: dashboard.overview.active_alerts,
        anomalies_detected: dashboard.overview.anomalies_detected,
        high_risk_clients: dashboard.overview.high_risk_clients
      },
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.json(dashboard);

  } catch (error) {
    console.error('Error getting security dashboard:', error?.stack || String(error));
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'security_dashboard_error',
      error: error.message,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.status(500).json({
      error: 'dashboard_error',
      message: 'Failed to retrieve security dashboard'
    });
  }
});

/**
 * GET /api/security/alerts
 * Get security alerts with filtering options
 */
router.get('/alerts', requireAdminAccess, async (req, res) => {
  try {
    const { 
      severity, 
      status = 'active', 
      client_id, 
      limit = 100, 
      offset = 0 
    } = req.query;

    const dashboard = getSecurityDashboard();
    // getSecurityDashboard() returns alerts as { active, recent_count, by_severity };
    // the list lives under `.active`.
    let alerts = dashboard.alerts.active;

    // Filter by severity
    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }

    // Filter by status
    if (status !== 'all') {
      alerts = alerts.filter(alert => alert.status === status);
    }

    // Filter by client ID (carried in event_data or details, not top-level)
    if (client_id) {
      alerts = alerts.filter(alert =>
        alert.event_data?.client_id === client_id ||
        alert.details?.client_id === client_id
      );
    }

    // Sort by timestamp (newest first)
    alerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply pagination
    const paginatedAlerts = alerts.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'security_alerts_viewed',
      filters: { severity, status, client_id },
      results_count: paginatedAlerts.length,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.json({
      alerts: paginatedAlerts,
      total: alerts.length,
      limit: parseInt(limit),
      offset: parseInt(offset),
      filters: { severity, status, client_id }
    });

  } catch (error) {
    console.error('Error getting security alerts:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'alerts_error',
      message: 'Failed to retrieve security alerts'
    });
  }
});

/**
 * POST /api/security/alerts/:alertId/resolve
 * Resolve a security alert
 */
router.post('/alerts/:alertId/resolve', requireAdminAccess, async (req, res) => {
  try {
    const { alertId } = req.params;
    const { resolution_note, action_taken } = req.body;

    if (!resolution_note) {
      return res.status(400).json({
        error: 'invalid_resolution',
        message: 'Resolution note is required'
      });
    }

    const result = resolveAlert(alertId, {
      resolved_by: req.auth.user,
      resolved_at: new Date().toISOString(),
      resolution_note,
      action_taken
    });

    if (!result) {
      return res.status(404).json({
        error: 'alert_not_found',
        message: 'Security alert not found'
      });
    }

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'security_alert_resolved',
      alert_id: alertId,
      resolved_by: req.auth.user,
      resolution_note,
      action_taken,
      sourceIP: req.ip
    });

    res.json({
      message: 'Security alert resolved successfully',
      alert: result
    });

  } catch (error) {
    console.error('Error resolving security alert:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'resolution_error',
      message: 'Failed to resolve security alert'
    });
  }
});

/**
 * GET /api/security/clients/:clientId/report
 * Get security report for a specific client
 */
router.get('/clients/:clientId/report', requireAdminAccess, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { period = '7d' } = req.query;

    const report = getClientSecurityReport(clientId, period);

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'client_security_report_viewed',
      client_id: clientId,
      period,
      risk_score: report.risk_score,
      risk_level: report.risk_level,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.json(report);

  } catch (error) {
    console.error('Error getting client security report:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'report_error',
      message: 'Failed to retrieve client security report'
    });
  }
});

/**
 * POST /api/security/monitor/token-usage
 * Monitor token usage (called by other services)
 */
router.post('/monitor/token-usage', async (req, res) => {
  try {
    const { clientId, tokenData, requestInfo } = req.body;

    if (!clientId || !tokenData) {
      return res.status(400).json({
        error: 'invalid_input',
        message: 'Client ID and token data are required'
      });
    }

    // Service derives clientId from tokenData.client_id — fold the explicit
    // clientId in so it is always present.
    const result = monitorTokenUsage(
      { client_id: clientId, ...tokenData },
      {},
      requestInfo || {}
    );

    res.json({
      monitored: true,
      anomalies_detected: result.anomalies.length,
      alerts_generated: result.alertsGenerated,
      security_score: result.securityScore
    });

  } catch (error) {
    console.error('Error monitoring token usage:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'monitoring_error',
      message: 'Failed to monitor token usage'
    });
  }
});

/**
 * POST /api/security/monitor/authentication
 * Monitor authentication events
 */
router.post('/monitor/authentication', async (req, res) => {
  try {
    const { authResult, requestInfo } = req.body;

    if (!authResult) {
      return res.status(400).json({
        error: 'invalid_input',
        message: 'Authentication result is required'
      });
    }

    const result = monitorAuthentication(authResult, requestInfo || {});

    res.json({
      monitored: true,
      anomalies_detected: result.anomalies.length,
      alerts_generated: result.alertsGenerated,
      security_score: result.securityScore
    });

  } catch (error) {
    console.error('Error monitoring authentication:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'monitoring_error',
      message: 'Failed to monitor authentication'
    });
  }
});

/**
 * POST /api/security/monitor/credential-rotation
 * Monitor credential rotation events
 */
router.post('/monitor/credential-rotation', async (req, res) => {
  try {
    const { clientId, rotationEvent } = req.body;

    if (!clientId || !rotationEvent) {
      return res.status(400).json({
        error: 'invalid_input',
        message: 'Client ID and rotation event are required'
      });
    }

    const result = monitorCredentialRotation(clientId, rotationEvent);

    res.json({
      monitored: true,
      rotation_score: result.rotationScore,
      recommendations: result.recommendations,
      alerts_generated: result.alertsGenerated
    });

  } catch (error) {
    console.error('Error monitoring credential rotation:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'monitoring_error',
      message: 'Failed to monitor credential rotation'
    });
  }
});

/**
 * POST /api/security/alerts/generate
 * Generate a manual security alert
 */
router.post('/alerts/generate', requireAdminAccess, async (req, res) => {
  try {
    const { 
      title, 
      description, 
      severity, 
      client_id, 
      evidence 
    } = req.body;

    if (!title || !description || !severity) {
      return res.status(400).json({
        error: 'invalid_input',
        message: 'Title, description, and severity are required'
      });
    }

    if (!['info', 'warning', 'critical', 'emergency'].includes(severity)) {
      return res.status(400).json({
        error: 'invalid_severity',
        message: 'Severity must be one of: info, warning, critical, emergency'
      });
    }

    // Signature is generateSecurityAlert(alertType, severity, eventData, details).
    const alert = generateSecurityAlert(
      'manual_alert',
      severity,
      { title, description, client_id, evidence },
      {
        client_id,
        generated_by: req.auth.user,
        generated_at: new Date().toISOString()
      }
    );

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'manual_security_alert_generated',
      alert_id: alert.alert_id,
      severity,
      client_id,
      generated_by: req.auth.user,
      sourceIP: req.ip
    });

    res.status(201).json({
      message: 'Security alert generated successfully',
      alert
    });

  } catch (error) {
    console.error('Error generating security alert:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'generation_error',
      message: 'Failed to generate security alert'
    });
  }
});

/**
 * GET /api/security/anomalies
 * Get detected anomalies with analysis
 */
router.get('/anomalies', requireAdminAccess, async (req, res) => {
  try {
    const { period = '24h', client_id, type } = req.query;

    // Anomalies are surfaced as active alerts. detectAnomalies() is a *mutating*
    // detector keyed by clientId, not a read query — never call it from a GET.
    let anomalies = getSecurityDashboard().alerts.active;
    if (client_id) {
      anomalies = anomalies.filter(a =>
        a.event_data?.client_id === client_id ||
        a.details?.client_id === client_id
      );
    }
    if (type) {
      anomalies = anomalies.filter(a => a.type === type);
    }

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'security_anomalies_viewed',
      period,
      client_id,
      type,
      anomalies_count: anomalies.length,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.json({
      anomalies,
      summary: {
        total_anomalies: anomalies.length,
        critical_anomalies: anomalies.filter(a => a.severity === 'critical').length,
        warning_anomalies: anomalies.filter(a => a.severity === 'warning').length,
        info_anomalies: anomalies.filter(a => a.severity === 'info').length
      },
      filters: { period, client_id, type }
    });

  } catch (error) {
    console.error('Error getting security anomalies:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'anomalies_error',
      message: 'Failed to retrieve security anomalies'
    });
  }
});

/**
 * POST /api/security/cleanup
 * Clean up old security data
 */
router.post('/cleanup', requireAdminAccess, async (req, res) => {
  try {
    const { older_than = '7d' } = req.body;

    const cleanedCount = cleanupSecurityData(older_than);

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'security_data_cleanup',
      older_than,
      cleaned_count: cleanedCount,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.json({
      message: 'Security data cleanup completed',
      cleaned_records: cleanedCount,
      older_than
    });

  } catch (error) {
    console.error('Error cleaning up security data:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'cleanup_error',
      message: 'Failed to clean up security data'
    });
  }
});

/**
 * GET /api/security/metrics
 * Get security metrics and statistics
 */
router.get('/metrics', requireAdminAccess, async (req, res) => {
  try {
    const { period = '24h' } = req.query;

    const metrics = {
      ...securityMetrics,
      period,
      generated_at: new Date().toISOString(),
      anomaly_thresholds: SECURITY_CONFIG.anomaly_thresholds,
      alert_levels: SECURITY_CONFIG.alert_levels
    };

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'security_metrics_viewed',
      period,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.json(metrics);

  } catch (error) {
    console.error('Error getting security metrics:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'metrics_error',
      message: 'Failed to retrieve security metrics'
    });
  }
});

/**
 * GET /api/security/config
 * Get security monitoring configuration
 */
router.get('/config', requireAdminAccess, async (req, res) => {
  try {
    const config = {
      anomaly_thresholds: SECURITY_CONFIG.anomaly_thresholds,
      alert_levels: SECURITY_CONFIG.alert_levels,
      windows: SECURITY_CONFIG.windows,
      features: {
        token_usage_monitoring: true,
        authentication_monitoring: true,
        credential_rotation_monitoring: true,
        anomaly_detection: true,
        real_time_alerts: true
      }
    };

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'security_config_viewed',
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.json(config);

  } catch (error) {
    console.error('Error getting security config:', error?.stack || String(error));
    
    res.status(500).json({
      error: 'config_error',
      message: 'Failed to retrieve security configuration'
    });
  }
});

module.exports = router;
