'use strict';

// Per-user agent preferences, stored as a JSON PingOne user attribute
// (`agentPreferences`) — same storage idiom as agentRestrictions (STRING) and
// mayAct (JSON). The user sets what their AI agent is allowed to do; the gate
// in middleware/agentPreferencesGate.js enforces it on /api/mcp/tool.
//
// Attribute shape (JSON):
//   { "allowedActions": ["read", "transfer"],   // action tiers the agent may take
//     "maxAmount": 500,                          // optional USD cap per action
//     "detectAgent": true,                       // consult Protect agent detection at session start
//     "unknownAgentPolicy": "hitl" }             // "allow" | "hitl" | "deny"

const ACTIONS = Object.freeze(['read', 'write']);

const DEFAULT_PREFERENCES = Object.freeze({
  allowedActions: ACTIONS.slice(),
  detectAgent: true,
  unknownAgentPolicy: 'hitl',
});

function normalizePreferences(raw) {
  const prefs = { ...DEFAULT_PREFERENCES };
  if (!raw || typeof raw !== 'object') return { ...prefs };
  if (Array.isArray(raw.allowedActions)) {
    const allowed = raw.allowedActions.filter((a) => ACTIONS.includes(a));
    if (allowed.length > 0) prefs.allowedActions = ACTIONS.filter((a) => allowed.includes(a));
  }
  if (typeof raw.maxAmount === 'number' && Number.isFinite(raw.maxAmount) && raw.maxAmount >= 0) {
    prefs.maxAmount = raw.maxAmount;
  }
  if (typeof raw.detectAgent === 'boolean') prefs.detectAgent = raw.detectAgent;
  if (['allow', 'hitl', 'deny'].includes(raw.unknownAgentPolicy)) {
    prefs.unknownAgentPolicy = raw.unknownAgentPolicy;
  }
  return prefs;
}

// PingOne JSON schema attributes must be PATCHed as a real JSON OBJECT —
// sending a string fails with "agentPreferences must be a JSON object".
function serializePreferences(prefs) {
  return normalizePreferences(prefs);
}

// Resolve the preference value to apply when the real one cannot be determined.
// Mirrors agentRestrictionsGate's failover policy: failover_mode=permit opens
// up; every other mode (deny / fallback_simulated) stays closed — agent actions
// route to HITL rather than being silently allowed or hard-blocked, since the
// gate's job is preference enforcement, not outage response.
function failoverPreferences(simulatedAuthorizeService, configStore) {
  const mode = simulatedAuthorizeService.resolveAuthorizeMode(configStore).failoverMode;
  if (mode === 'permit') return { ...DEFAULT_PREFERENCES, allowedActions: ACTIONS.slice() };
  return { ...DEFAULT_PREFERENCES, allowedActions: [], unknownAgentPolicy: 'hitl' };
}

// Decision core — pure, unit-testable. Returns:
//   { decision: 'permit' } | { decision: 'hitl', reason } | { decision: 'deny', reason }
function evaluatePreferences({ prefs, requiredTier, amount, agentDetected }) {
  if (!prefs.allowedActions.includes(requiredTier)) {
    return {
      decision: 'hitl',
      reason: `Agent action tier "${requiredTier}" is not in the user's allowed actions [${prefs.allowedActions.join(', ') || 'none'}]`,
    };
  }
  if (prefs.maxAmount !== undefined && typeof amount === 'number' && Number.isFinite(amount) && amount > prefs.maxAmount) {
    return {
      decision: 'hitl',
      reason: `Agent action amount ${amount} exceeds the user's preference cap of ${prefs.maxAmount}`,
    };
  }
  const detectionActive = agentDetected && prefs.detectAgent !== false;
  if (detectionActive && prefs.unknownAgentPolicy === 'deny') {
    return { decision: 'deny', reason: 'AI agent detected and the user preference is to deny agent actions' };
  }
  if (detectionActive && prefs.unknownAgentPolicy === 'hitl') {
    return { decision: 'hitl', reason: 'AI agent detected — user preference requires human approval for agent actions' };
  }
  return { decision: 'permit' };
}

module.exports = {
  ACTIONS,
  DEFAULT_PREFERENCES,
  normalizePreferences,
  serializePreferences,
  failoverPreferences,
  evaluatePreferences,
};
