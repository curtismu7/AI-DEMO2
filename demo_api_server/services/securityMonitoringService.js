/**
 * Security Monitoring and Audit Trail Service
 * Comprehensive security monitoring for OAuth client credentials with anomaly detection
 * 
 * Phase 57-05: Security Monitoring and Audit Trail
 * Security-focused implementation with real-time monitoring and alerting
 */

'use strict';

const crypto = require('crypto');
const { writeExchangeEvent } = require('./exchangeAuditStore');
const securityStore = require('./lmdb/securityMonitoringStore.lmdb');

// Ring-buffer caps applied at snapshot time so the persisted blob can't grow
// unbounded (newest-kept). In-memory cleanup (cleanupSecurityData) is the
// primary bound; these are the persistence backstop.
const MAX_PERSISTED_EVENTS = 2000;
const MAX_PERSISTED_ALERTS = 1000;
const MAX_PERSISTED_BEHAVIOR = 1000;
const SNAPSHOT_INTERVAL_MS = 60 * 1000;

// Set true by any state mutation; the snapshot timer only writes when dirty.
let _dirty = false;
function _markDirty() { _dirty = true; }

/**
 * Security monitoring configuration
 */
const SECURITY_CONFIG = {
  // Anomaly detection thresholds
  anomaly_thresholds: {
    high_risk_token_usage: 50, // High-risk tokens per hour
    unusual_ip_patterns: 10,   // Different IPs for same client
    failed_auth_attempts: 5,   // Failed attempts before alert
    rapid_token_requests: 100,  // Token requests per minute
    scope_escalation_attempts: 3, // Scope escalation attempts
    client_credential_rotation: 30 // Days between rotations
  },

  // Alert levels
  alert_levels: {
    'info': { priority: 'low', escalation: false },
    'warning': { priority: 'medium', escalation: false },
    'critical': { priority: 'high', escalation: true },
    'emergency': { priority: 'critical', escalation: true, immediate: true }
  },

  // Monitoring windows
  windows: {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000
  }
};

/**
 * Security event tracking
 */
const securityEvents = new Map();
const activeAlerts = new Map();
const securityMetrics = {
  total_events: 0,
  alerts_generated: 0,
  anomalies_detected: 0,
  threats_blocked: 0,
  investigations_triggered: 0
};

/**
 * Client behavior tracking
 */
const clientBehavior = new Map();

/**
 * IP reputation tracking
 */
const ipReputation = new Map();

/**
 * Security audit event logging
 */
function logSecurityEvent(eventType, eventData, details = {}) {
  const auditEvent = {
    type: 'security-monitoring-event',
    level: 'info',
    timestamp: new Date().toISOString(),
    eventType,
    ...eventData,
    ...details,
    security: {
      sourceIP: details.sourceIP || 'unknown',
      userAgent: details.userAgent || 'unknown',
      requestId: details.requestId || crypto.randomUUID(),
      sessionId: details.sessionId || 'unknown',
      userId: details.userId || 'unknown'
    }
  };

  writeExchangeEvent(auditEvent).catch(err => {
    console.error('[SecurityMonitoring] Failed to log security event:', err.message);
  });

  securityMetrics.total_events++;
}

/**
 * Generate security alerts
 */
function generateSecurityAlert(alertType, severity, eventData, details = {}) {
  const alertId = crypto.randomUUID();
  const alert = {
    alert_id: alertId,
    type: alertType,
    severity,
    timestamp: new Date().toISOString(),
    event_data: eventData,
    details,
    status: 'active',
    escalation_required: SECURITY_CONFIG.alert_levels[severity]?.escalation || false,
    immediate_action: SECURITY_CONFIG.alert_levels[severity]?.immediate || false,
    investigation_required: ['critical', 'emergency'].includes(severity)
  };

  activeAlerts.set(alertId, alert);
  securityMetrics.alerts_generated++;
  _markDirty();

  logSecurityEvent('security_alert_generated', {
    alert_id: alertId,
    alert_type: alertType,
    severity,
    escalation_required: alert.escalation_required
  }, details);

  return alert;
}

/**
 * Track client behavior patterns
 */
function trackClientBehavior(clientId, event, metadata = {}) {
  if (!clientBehavior.has(clientId)) {
    clientBehavior.set(clientId, {
      client_id: clientId,
      first_seen: Date.now(),
      last_seen: Date.now(),
      events: [],
      ip_addresses: new Set(),
      user_agents: new Set(),
      scopes_used: new Set(),
      token_requests: 0,
      failed_attempts: 0,
      risk_score: 0
    });
  }

  const behavior = clientBehavior.get(clientId);
  behavior.last_seen = Date.now();
  behavior.events.push({
    timestamp: Date.now(),
    event,
    metadata
  });

  // Keep only recent events (last 24 hours)
  const cutoff = Date.now() - SECURITY_CONFIG.windows.day;
  behavior.events = behavior.events.filter(e => e.timestamp > cutoff);

  // Update tracking data
  if (metadata.sourceIP) {
    behavior.ip_addresses.add(metadata.sourceIP);
  }
  if (metadata.userAgent) {
    behavior.user_agents.add(metadata.userAgent);
  }
  if (metadata.scopes) {
    metadata.scopes.forEach(scope => { behavior.scopes_used.add(scope); });
  }

  // Update counters
  if (event === 'token_request') {
    behavior.token_requests++;
  } else if (event === 'failed_auth') {
    behavior.failed_attempts++;
  }

  // Calculate risk score
  behavior.risk_score = calculateClientRiskScore(behavior);
  _markDirty();
}

/**
 * Calculate client risk score
 */
function calculateClientRiskScore(behavior) {
  let score = 0;

  // IP diversity score
  const ipCount = behavior.ip_addresses.size;
  if (ipCount > 5) score += 10;
  else if (ipCount > 3) score += 5;

  // Failed attempts score
  if (behavior.failed_attempts > 10) score += 20;
  else if (behavior.failed_attempts > 5) score += 10;
  else if (behavior.failed_attempts > 2) score += 5;

  // Token request frequency
  const recentRequests = behavior.events.filter(e => 
    e.event === 'token_request' && 
    (Date.now() - e.timestamp) < SECURITY_CONFIG.windows.hour
  ).length;
  
  if (recentRequests > 100) score += 15;
  else if (recentRequests > 50) score += 10;
  else if (recentRequests > 20) score += 5;

  // Scope diversity
  const scopeCount = behavior.scopes_used.size;
  if (scopeCount > 5) score += 10;
  else if (scopeCount > 3) score += 5;

  // Account age
  const accountAge = Date.now() - behavior.first_seen;
  if (accountAge < SECURITY_CONFIG.windows.day) score += 15;
  else if (accountAge < SECURITY_CONFIG.windows.week) score += 10;

  return Math.min(score, 100); // Cap at 100
}

/**
 * Detect anomalous patterns
 */
function detectAnomalies(clientId, event, metadata = {}) {
  const anomalies = [];
  const behavior = clientBehavior.get(clientId);

  if (!behavior) return anomalies;

  // Check for unusual IP patterns
  const recentIPs = behavior.events
    .filter(e => (Date.now() - e.timestamp) < SECURITY_CONFIG.windows.hour)
    .map(e => e.metadata.sourceIP)
    .filter(Boolean);

  const uniqueIPs = new Set(recentIPs);
  if (uniqueIPs.size > SECURITY_CONFIG.anomaly_thresholds.unusual_ip_patterns) {
    anomalies.push({
      type: 'unusual_ip_pattern',
      severity: 'warning',
      description: `Client accessed from ${uniqueIPs.size} different IPs in last hour`,
      data: {
        ip_count: uniqueIPs.size,
        ips: Array.from(uniqueIPs)
      }
    });
  }

  // Check for rapid token requests
  const recentTokenRequests = behavior.events
    .filter(e => e.event === 'token_request' && (Date.now() - e.timestamp) < SECURITY_CONFIG.windows.minute)
    .length;

  if (recentTokenRequests > SECURITY_CONFIG.anomaly_thresholds.rapid_token_requests) {
    anomalies.push({
      type: 'rapid_token_requests',
      severity: 'critical',
      description: `Client requested ${recentTokenRequests} tokens in last minute`,
      data: {
        request_count: recentTokenRequests,
        threshold: SECURITY_CONFIG.anomaly_thresholds.rapid_token_requests
      }
    });
  }

  // Check for failed authentication attempts
  const recentFailures = behavior.events
    .filter(e => e.event === 'failed_auth' && (Date.now() - e.timestamp) < SECURITY_CONFIG.windows.hour)
    .length;

  if (recentFailures > SECURITY_CONFIG.anomaly_thresholds.failed_auth_attempts) {
    anomalies.push({
      type: 'failed_auth_attempts',
      severity: 'warning',
      description: `Client had ${recentFailures} failed authentication attempts in last hour`,
      data: {
        failure_count: recentFailures,
        threshold: SECURITY_CONFIG.anomaly_thresholds.failed_auth_attempts
      }
    });
  }

  // Check for scope escalation attempts
  const scopeHistory = behavior.events
    .filter(e => e.event === 'token_request' && (Date.now() - e.timestamp) < SECURITY_CONFIG.windows.day)
    .flatMap(e => e.metadata.scopes || []);

  const uniqueScopes = new Set(scopeHistory);
  const highRiskScopes = Array.from(uniqueScopes).filter(scope => 
    scope.includes('admin') || scope.includes('delete') || scope.includes('write')
  );

  if (highRiskScopes.length > SECURITY_CONFIG.anomaly_thresholds.scope_escalation_attempts) {
    anomalies.push({
      type: 'scope_escalation_attempt',
      severity: 'critical',
      description: `Client requested ${highRiskScopes.length} high-risk scopes`,
      data: {
        high_risk_scopes: highRiskScopes,
        total_scopes: uniqueScopes.size
      }
    });
  }

  // Process detected anomalies
  anomalies.forEach(anomaly => {
    securityMetrics.anomalies_detected++;
    
    const alert = generateSecurityAlert(
      anomaly.type,
      anomaly.severity,
      anomaly.data,
      {
        client_id: clientId,
        description: anomaly.description,
        ...metadata
      }
    );

    logSecurityEvent('anomaly_detected', {
      anomaly_type: anomaly.type,
      client_id: clientId,
      severity: anomaly.severity,
      alert_id: alert.alert_id
    }, metadata);
  });

  return anomalies;
}

/**
 * Monitor token usage patterns
 */
function monitorTokenUsage(tokenData, usageData, metadata = {}) {
  const tokenId = tokenData.jti;
  const clientId = tokenData.client_id;
  const scopes = tokenData.scope ? tokenData.scope.split(' ') : [];
  const alerts = [];

  // Track high-risk token usage
  const highRiskScopes = scopes.filter(scope =>
    scope.includes('admin') || scope.includes('delete') || scope.includes('write')
  );

  if (highRiskScopes.length > 0) {
    const usageKey = `high_risk_token:${tokenId}`;
    const usage = securityEvents.get(usageKey) || { count: 0, first_seen: Date.now() };
    usage.count++;
    usage.last_seen = Date.now();
    securityEvents.set(usageKey, usage);
    _markDirty();

    if (usage.count > SECURITY_CONFIG.anomaly_thresholds.high_risk_token_usage) {
      alerts.push(generateSecurityAlert(
        'high_risk_token_usage',
        'warning',
        {
          token_id: tokenId,
          client_id: clientId,
          usage_count: usage.count,
          high_risk_scopes: highRiskScopes
        },
        metadata
      ));
    }
  }

  // Track client behavior. The event name MUST be 'token_request' — the risk
  // scoring, rapid-request and scope-escalation detectors all filter on that
  // exact string, so any other name silently disables them.
  trackClientBehavior(clientId, 'token_request', {
    ...metadata,
    scopes,
    token_id: tokenId
  });

  // Detect anomalies (each detected anomaly also generates one alert)
  const anomalies = detectAnomalies(clientId, 'token_request', metadata);

  const behavior = clientBehavior.get(clientId);
  return {
    anomalies,
    alertsGenerated: alerts.length + anomalies.length,
    securityScore: behavior ? behavior.risk_score : 0
  };
}

/**
 * Monitor authentication events
 */
function monitorAuthentication(authResult, metadata = {}) {
  const clientId = authResult.client_id || 'unknown';
  const success = authResult.success || false;
  const alerts = [];

  if (success) {
    trackClientBehavior(clientId, 'successful_auth', metadata);
    // A successful auth clears the failure streak so a future burst re-arms the
    // threshold alert (otherwise failed_attempts only ever grows).
    const behavior = clientBehavior.get(clientId);
    if (behavior && behavior.failed_attempts > 0) {
      behavior.failed_attempts = 0;
      _markDirty();
    }
  } else {
    trackClientBehavior(clientId, 'failed_auth', metadata);

    const behavior = clientBehavior.get(clientId);
    // Fire exactly once, when the streak crosses the threshold — '>=' would
    // re-fire on every subsequent failure forever.
    if (behavior && behavior.failed_attempts === SECURITY_CONFIG.anomaly_thresholds.failed_auth_attempts) {
      alerts.push(generateSecurityAlert(
        'multiple_failed_auth',
        'warning',
        {
          client_id: clientId,
          failure_count: behavior.failed_attempts,
          last_failure: Date.now()
        },
        metadata
      ));
    }
  }

  const behavior = clientBehavior.get(clientId);
  return {
    anomalies: [],
    alertsGenerated: alerts.length,
    securityScore: behavior ? behavior.risk_score : 0
  };
}

/**
 * Monitor client credential rotation
 */
function monitorCredentialRotation(clientId, rotationData, metadata = {}) {
  const behavior = clientBehavior.get(clientId);
  const recommendedDays = SECURITY_CONFIG.anomaly_thresholds.client_credential_rotation;
  const alerts = [];
  let daysSinceRotation = 0;

  if (behavior) {
    const lastRotation = behavior.last_credential_rotation;
    // Only assess overdue-ness when we have a prior rotation timestamp — the
    // first rotation we ever see for a client must not be flagged overdue.
    if (lastRotation) {
      daysSinceRotation = (Date.now() - lastRotation) / (24 * 60 * 60 * 1000);

      if (daysSinceRotation > recommendedDays) {
        alerts.push(generateSecurityAlert(
          'credential_rotation_overdue',
          'warning',
          {
            client_id: clientId,
            days_since_rotation: Math.floor(daysSinceRotation),
            recommended_rotation: recommendedDays
          },
          metadata
        ));
      }
    }

    behavior.last_credential_rotation = Date.now();
    _markDirty();
  }

  const recommendations = [];
  if (daysSinceRotation > recommendedDays) {
    recommendations.push({
      priority: 'medium',
      action: 'Rotate client credentials',
      description: `Last rotation was ${Math.floor(daysSinceRotation)} days ago (recommended every ${recommendedDays})`
    });
  }

  return {
    rotationScore: Math.max(0, 100 - Math.floor(daysSinceRotation)),
    recommendations,
    alertsGenerated: alerts.length
  };
}

/**
 * Get security dashboard data
 */
function getSecurityDashboard() {
  const now = Date.now();
  const last24Hours = now - SECURITY_CONFIG.windows.day;
  const lastHour = now - SECURITY_CONFIG.windows.hour;

  // Calculate recent metrics
  const recentEvents = Array.from(securityEvents.values())
    .filter(event => event.last_seen > last24Hours)
    .length;

  const activeAlertsCount = Array.from(activeAlerts.values())
    .filter(alert => alert.status === 'active')
    .length;

  const highRiskClients = Array.from(clientBehavior.values())
    .filter(behavior => behavior.risk_score > 50)
    .length;

  const recentAnomalies = Array.from(activeAlerts.values())
    .filter(alert => alert.timestamp > lastHour)
    .length;

  return {
    overview: {
      total_security_events: securityMetrics.total_events,
      active_alerts: activeAlertsCount,
      anomalies_detected: securityMetrics.anomalies_detected,
      threats_blocked: securityMetrics.threats_blocked,
      high_risk_clients: highRiskClients,
      recent_activity: recentEvents
    },
    alerts: {
      active: Array.from(activeAlerts.values())
        .filter(alert => alert.status === 'active')
        .sort((a, b) => {
          const severityOrder = { emergency: 4, critical: 3, warning: 2, info: 1 };
          return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
        }),
      recent_count: recentAnomalies,
      by_severity: {
        emergency: Array.from(activeAlerts.values()).filter(a => a.severity === 'emergency').length,
        critical: Array.from(activeAlerts.values()).filter(a => a.severity === 'critical').length,
        warning: Array.from(activeAlerts.values()).filter(a => a.severity === 'warning').length,
        info: Array.from(activeAlerts.values()).filter(a => a.severity === 'info').length
      }
    },
    client_risk: {
      high_risk_clients: Array.from(clientBehavior.values())
        .filter(behavior => behavior.risk_score > 70)
        .map(behavior => ({
          client_id: behavior.client_id,
          risk_score: behavior.risk_score,
          failed_attempts: behavior.failed_attempts,
          unique_ips: behavior.ip_addresses.size,
          last_seen: behavior.last_seen
        })),
      medium_risk_clients: Array.from(clientBehavior.values())
        .filter(behavior => behavior.risk_score > 30 && behavior.risk_score <= 70)
        .length,
      low_risk_clients: Array.from(clientBehavior.values())
        .filter(behavior => behavior.risk_score <= 30)
        .length
    },
    metrics: {
      events_last_24h: recentEvents,
      alerts_last_hour: recentAnomalies,
      average_risk_score: Array.from(clientBehavior.values())
        .reduce((sum, behavior) => sum + behavior.risk_score, 0) / Math.max(clientBehavior.size, 1),
      top_anomaly_types: getTopAnomalyTypes(),
      monitoring_health: {
        events_tracked: securityEvents.size,
        clients_tracked: clientBehavior.size,
        alerts_active: activeAlerts.size
      }
    }
  };
}

/**
 * Get top anomaly types
 */
function getTopAnomalyTypes() {
  const anomalyTypes = {};
  
  Array.from(activeAlerts.values()).forEach(alert => {
    anomalyTypes[alert.type] = (anomalyTypes[alert.type] || 0) + 1;
  });

  return Object.entries(anomalyTypes)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));
}

/**
 * Resolve security alert
 */
function resolveAlert(alertId, resolutionData, metadata = {}) {
  const alert = activeAlerts.get(alertId);
  
  if (!alert) {
    throw new Error(`Alert not found: ${alertId}`);
  }

  alert.status = 'resolved';
  alert.resolved_at = new Date().toISOString();
  alert.resolution_data = resolutionData;
  alert.resolved_by = metadata.resolvedBy || 'system';
  _markDirty();

  logSecurityEvent('security_alert_resolved', {
    alert_id: alertId,
    alert_type: alert.type,
    resolution_data
  }, metadata);

  return alert;
}

/**
 * Get client security report
 */
function getClientSecurityReport(clientId) {
  const behavior = clientBehavior.get(clientId);
  
  if (!behavior) {
    throw new Error(`Client not found: ${clientId}`);
  }

  // Anomaly-driven alerts carry client_id in `details`; manually/usage-generated
  // ones carry it in `event_data`. Match either so the report is complete.
  const clientAlerts = Array.from(activeAlerts.values())
    .filter(alert =>
      alert.event_data?.client_id === clientId ||
      alert.details?.client_id === clientId
    );

  return {
    client_id: clientId,
    risk_score: behavior.risk_score,
    risk_level: behavior.risk_score > 70 ? 'high' : behavior.risk_score > 30 ? 'medium' : 'low',
    behavior_summary: {
      first_seen: behavior.first_seen,
      last_seen: behavior.last_seen,
      token_requests: behavior.token_requests,
      failed_attempts: behavior.failed_attempts,
      unique_ips: behavior.ip_addresses.size,
      unique_user_agents: behavior.user_agents.size,
      scopes_used: Array.from(behavior.scopes_used)
    },
    security_events: {
      total_alerts: clientAlerts.length,
      active_alerts: clientAlerts.filter(alert => alert.status === 'active').length,
      recent_alerts: clientAlerts.filter(alert => 
        alert.timestamp > (Date.now() - SECURITY_CONFIG.windows.day)
      ).length,
      alert_types: clientAlerts.map(alert => alert.type)
    },
    recommendations: generateSecurityRecommendations(behavior, clientAlerts)
  };
}

/**
 * Generate security recommendations
 */
function generateSecurityRecommendations(behavior, alerts) {
  const recommendations = [];

  if (behavior.risk_score > 70) {
    recommendations.push({
      priority: 'high',
      action: 'Review client activity immediately',
      description: 'High risk score indicates potential security issues'
    });
  }

  if (behavior.failed_attempts > 5) {
    recommendations.push({
      priority: 'medium',
      action: 'Investigate failed authentication attempts',
      description: 'Multiple failed attempts may indicate brute force attacks'
    });
  }

  if (behavior.ip_addresses.size > 5) {
    recommendations.push({
      priority: 'medium',
      action: 'Verify client IP usage patterns',
      description: 'Unusual IP diversity may indicate compromised credentials'
    });
  }

  const criticalAlerts = alerts.filter(alert => alert.severity === 'critical');
  if (criticalAlerts.length > 0) {
    recommendations.push({
      priority: 'high',
      action: 'Address critical security alerts',
      description: `${criticalAlerts.length} critical alerts require immediate attention`
    });
  }

  if (behavior.scopes_used.has('admin:delete') || behavior.scopes_used.has('admin:write')) {
    recommendations.push({
      priority: 'medium',
      action: 'Review high-risk scope usage',
      description: 'Client has access to sensitive administrative operations'
    });
  }

  return recommendations;
}

/**
 * Clean up old security data
 */
function cleanupSecurityData() {
  const now = Date.now();
  const cutoff = now - SECURITY_CONFIG.windows.week; // Keep data for 1 week
  let cleanedCount = 0;

  // Clean old security events
  for (const [key, event] of securityEvents.entries()) {
    if (event.last_seen < cutoff) {
      securityEvents.delete(key);
      cleanedCount++;
    }
  }

  // Clean old client behavior data
  for (const [clientId, behavior] of clientBehavior.entries()) {
    if (behavior.last_seen < cutoff) {
      clientBehavior.delete(clientId);
      cleanedCount++;
    }
  }

  // Clean resolved alerts older than 30 days
  const alertCutoff = now - (30 * 24 * 60 * 60 * 1000);
  for (const [alertId, alert] of activeAlerts.entries()) {
    if (alert.status === 'resolved' && alert.resolved_at && 
        new Date(alert.resolved_at).getTime() < alertCutoff) {
      activeAlerts.delete(alertId);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`[SecurityMonitoring] Cleaned up ${cleanedCount} old security records`);
    _markDirty();
  }

  return cleanedCount;
}

// ---------------------------------------------------------------------------
// LMDB persistence (periodic snapshot + boot hydrate)
// ---------------------------------------------------------------------------

// clientBehavior values hold Sets, which don't survive JSON. Convert to/from
// arrays at the persistence boundary only.
function _serializeBehavior(b) {
  return {
    ...b,
    ip_addresses: Array.from(b.ip_addresses || []),
    user_agents: Array.from(b.user_agents || []),
    scopes_used: Array.from(b.scopes_used || []),
  };
}
function _deserializeBehavior(b) {
  return {
    ...b,
    ip_addresses: new Set(b.ip_addresses || []),
    user_agents: new Set(b.user_agents || []),
    scopes_used: new Set(b.scopes_used || []),
  };
}

// Keep the newest N entries of a Map (insertion-ordered) as [key, value] pairs.
function _capEntries(map, max) {
  const all = Array.from(map.entries());
  return all.length > max ? all.slice(all.length - max) : all;
}

/** Write a single serialized snapshot to LMDB if state changed since the last flush. */
function snapshot(force = false) {
  if (!_dirty && !force) return false;
  try {
    securityStore.save({
      events: _capEntries(securityEvents, MAX_PERSISTED_EVENTS),
      alerts: _capEntries(activeAlerts, MAX_PERSISTED_ALERTS),
      behavior: _capEntries(clientBehavior, MAX_PERSISTED_BEHAVIOR)
        .map(([k, v]) => [k, _serializeBehavior(v)]),
      metrics: { ...securityMetrics },
      savedAt: new Date().toISOString(),
    });
    _dirty = false;
    return true;
  } catch (err) {
    console.error('[SecurityMonitoring] snapshot to LMDB failed:', err.message);
    return false;
  }
}

/** Repopulate the in-memory Maps from the last LMDB snapshot. Call once at boot. */
function hydrate() {
  try {
    const snap = securityStore.load();
    if (!snap) return;
    for (const [k, v] of snap.events || []) securityEvents.set(k, v);
    for (const [k, v] of snap.alerts || []) activeAlerts.set(k, v);
    for (const [k, v] of snap.behavior || []) clientBehavior.set(k, _deserializeBehavior(v));
    if (snap.metrics) Object.assign(securityMetrics, snap.metrics);
  } catch (err) {
    console.error('[SecurityMonitoring] hydrate from LMDB failed:', err.message);
  }
}

// Periodic flush. unref so it never holds the process open (and is inert in tests).
const _snapshotTimer = setInterval(() => snapshot(), SNAPSHOT_INTERVAL_MS);
if (_snapshotTimer.unref) _snapshotTimer.unref();

// Test and multi-user safety functions
function trackEvent(event) {
  if (!event.id) event.id = crypto.randomUUID();
  const key = `event:${event.id}`;
  securityEvents.set(key, event);
  _markDirty();
}

function getEventsByClientId(clientId) {
  return Array.from(securityEvents.values()).filter(e => e.clientId === clientId);
}

function getAllEvents() {
  return Array.from(securityEvents.values());
}

function clearAllEvents() {
  securityEvents.clear();
  activeAlerts.clear();
  clientBehavior.clear();
  ipReputation.clear();
  _dirty = false;
}

function getClientBehavior(clientId) {
  return clientBehavior.get(clientId);
}

function recordFailedAttempt(clientId) {
  if (!clientBehavior.has(clientId)) {
    clientBehavior.set(clientId, {
      client_id: clientId,
      first_seen: Date.now(),
      last_seen: Date.now(),
      events: [],
      ip_addresses: new Set(),
      user_agents: new Set(),
      scopes_used: new Set(),
      token_requests: 0,
      failed_attempts: 0,
      risk_score: 0
    });
  }
  const behavior = clientBehavior.get(clientId);
  behavior.failed_attempts = (behavior.failed_attempts || 0) + 1;
  _markDirty();
}

function recordIpReputation(ip, reputation) {
  ipReputation.set(ip, reputation);
  _markDirty();
}

function getIpReputation(ip) {
  return ipReputation.get(ip);
}

function persistToDisk() {
  return Promise.resolve(snapshot(true));
}

function reloadFromDisk() {
  hydrate();
}

module.exports = {
  monitorTokenUsage,
  monitorAuthentication,
  monitorCredentialRotation,
  getSecurityDashboard,
  getClientSecurityReport,
  resolveAlert,
  generateSecurityAlert,
  detectAnomalies,
  cleanupSecurityData,
  SECURITY_CONFIG,
  securityMetrics,
  hydrate,
  snapshot,
  trackEvent,
  getEventsByClientId,
  getAllEvents,
  clearAllEvents,
  getClientBehavior,
  recordFailedAttempt,
  recordIpReputation,
  getIpReputation,
  persistToDisk,
  reloadFromDisk
};
