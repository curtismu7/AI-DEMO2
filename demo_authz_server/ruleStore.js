'use strict';

/**
 * ruleStore — the single mutable owner of the EDITABLE mock-authz policy knobs.
 *
 * Effective value = factory default (scope-topology.json + env) ⊕ a sparse
 * overlay persisted to rules-overlay.json. decision.js and routes/rules.js read
 * these getters at REQUEST time so an admin edit changes live enforcement.
 *
 * Token-validity guards (aud/exp/iat/nbf/iss, user lookup, intent) are NOT owned
 * here — they stay env/SoT driven in decision.js and cannot be edited.
 */

const fs = require('fs');
const path = require('path');
const scopeTopology = require('./scopeTopology');

const OVERLAY_PATH =
  process.env.AUTHZ_RULES_OVERLAY_PATH || path.join(__dirname, 'rules-overlay.json');

// Valid scopes are derived from the SoT's scopes map (via scopeTopology, the sole
// manifest loader) — not hardcoded — so the editor accepts every scope a tool
// legitimately uses (e.g. "transfer").
const ALLOWED_SCOPES = scopeTopology.allowedScopes();
if (ALLOWED_SCOPES.length === 0) ALLOWED_SCOPES.push('read', 'write', 'admin');

/** Factory defaults read at call time so operator env vars are still honored. */
function envDefaults() {
  return {
    hitlThresholdUsd: parseFloat(
      process.env.CONFIRM_THRESHOLD_USD || process.env.confirm_threshold_usd || '250'
    ),
    authorizedActorClientId:
      process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID
        || process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID
        || process.env.AGENT_OAUTH_CLIENT_ID || '',
    toolDiscoveryDecision: 'PERMIT',
  };
}

function emptyOverlay() {
  return { global: {}, tools: {} };
}

function loadOverlay() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OVERLAY_PATH, 'utf8'));
    return {
      global: parsed && typeof parsed.global === 'object' && parsed.global ? parsed.global : {},
      tools: parsed && typeof parsed.tools === 'object' && parsed.tools ? parsed.tools : {},
    };
  } catch {
    return emptyOverlay();
  }
}

let overlay = loadOverlay();

function persist() {
  const out = { version: 1, updatedAt: new Date().toISOString(), ...overlay };
  fs.writeFileSync(OVERLAY_PATH, JSON.stringify(out, null, 2));
}

// ── Request-time getters ──────────────────────────────────────────────────────

function getHitlThreshold() {
  return overlay.global.hitlThresholdUsd ?? envDefaults().hitlThresholdUsd;
}
function getAuthorizedActorClientId() {
  return overlay.global.authorizedActorClientId ?? envDefaults().authorizedActorClientId;
}
function getToolDiscoveryDecision() {
  return overlay.global.toolDiscoveryDecision ?? envDefaults().toolDiscoveryDecision;
}
function requiredScopesForTool(toolName) {
  const o = overlay.tools[toolName];
  if (o && Array.isArray(o.requiredScopes)) return o.requiredScopes;
  return scopeTopology.requiredScopesForTool(toolName);
}
function isWriteTool(toolName) {
  const o = overlay.tools[toolName];
  if (o && typeof o.isWrite === 'boolean') return o.isWrite;
  return scopeTopology.isWriteTool(toolName);
}
// hasChallengeType is intentionally not admin-overridable (challengeType is SoT-only),
// but routing through ruleStore keeps decision.js decoupled from scopeTopology directly.
function hasChallengeType(toolName) {
  return scopeTopology.hasChallengeType(toolName);
}

// ── Editable description for the UI ────────────────────────────────────────────

function field(value, def, overridden) {
  return { value, default: def, overridden };
}

function getEditableBlock() {
  const d = envDefaults();
  const g = overlay.global;
  const tools = {};
  for (const name of scopeTopology.gatewayToolNames()) {
    const o = overlay.tools[name] || {};
    tools[name] = {
      requiredScopes: field(
        requiredScopesForTool(name) || [],
        scopeTopology.requiredScopesForTool(name) || [],
        Array.isArray(o.requiredScopes)
      ),
      isWrite: field(isWriteTool(name), scopeTopology.isWriteTool(name), typeof o.isWrite === 'boolean'),
    };
  }
  return {
    global: {
      hitlThresholdUsd: field(getHitlThreshold(), d.hitlThresholdUsd, g.hitlThresholdUsd !== undefined),
      authorizedActorClientId: field(getAuthorizedActorClientId(), d.authorizedActorClientId, g.authorizedActorClientId !== undefined),
      toolDiscoveryDecision: field(getToolDiscoveryDecision(), d.toolDiscoveryDecision, g.toolDiscoveryDecision !== undefined),
    },
    tools,
    allowedScopes: ALLOWED_SCOPES,
  };
}

// ── Mutators ────────────────────────────────────────────────────────────────

function applyPatch(patch) {
  if (!patch || typeof patch !== 'object') {
    const e = new Error('patch must be an object'); e.code = 'INVALID_PATCH'; throw e;
  }
  const errors = [];
  const next = { global: { ...overlay.global }, tools: { ...overlay.tools } };

  const unknownTop = Object.keys(patch).filter((k) => !['global', 'tools', 'version', 'updatedAt'].includes(k));
  if (unknownTop.length) errors.push(`unknown keys: ${unknownTop.join(',')}`);

  if (patch.global !== undefined) {
    if (typeof patch.global !== 'object' || patch.global === null) {
      errors.push('global must be an object');
    } else {
      for (const [key, val] of Object.entries(patch.global)) {
        if (key === 'hitlThresholdUsd') {
          if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) errors.push('hitlThresholdUsd must be a finite number >= 0');
          else next.global.hitlThresholdUsd = val;
        } else if (key === 'authorizedActorClientId') {
          if (typeof val !== 'string') errors.push('authorizedActorClientId must be a string');
          else next.global.authorizedActorClientId = val.trim();
        } else if (key === 'toolDiscoveryDecision') {
          if (val !== 'PERMIT' && val !== 'DENY') errors.push('toolDiscoveryDecision must be PERMIT or DENY');
          else next.global.toolDiscoveryDecision = val;
        } else {
          errors.push(`unknown global key: ${key}`);
        }
      }
    }
  }

  if (patch.tools !== undefined) {
    if (typeof patch.tools !== 'object' || patch.tools === null) {
      errors.push('tools must be an object');
    } else {
      for (const [toolName, entry] of Object.entries(patch.tools)) {
        if (scopeTopology.requiredScopesForTool(toolName) === null) { errors.push(`unknown tool: ${toolName}`); continue; }
        if (!entry || typeof entry !== 'object') { errors.push(`tool ${toolName}: entry must be an object`); continue; }
        const nextEntry = { ...(next.tools[toolName] || {}) };
        const unknownKeys = Object.keys(entry).filter((k) => !['requiredScopes', 'isWrite'].includes(k));
        if (unknownKeys.length) errors.push(`tool ${toolName}: unknown keys ${unknownKeys.join(',')}`);
        if (entry.requiredScopes !== undefined) {
          if (!Array.isArray(entry.requiredScopes) || entry.requiredScopes.some((s) => !ALLOWED_SCOPES.includes(s))) {
            errors.push(`tool ${toolName}: requiredScopes must be a subset of known scopes`);
          } else {
            nextEntry.requiredScopes = [...new Set(entry.requiredScopes)];
          }
        }
        if (entry.isWrite !== undefined) {
          if (typeof entry.isWrite !== 'boolean') errors.push(`tool ${toolName}: isWrite must be boolean`);
          else nextEntry.isWrite = entry.isWrite;
        }
        next.tools[toolName] = nextEntry;
      }
    }
  }

  if (errors.length) { const e = new Error(errors.join('; ')); e.code = 'INVALID_PATCH'; throw e; }
  const previous = overlay;
  overlay = next;
  try {
    persist();
  } catch (err) {
    overlay = previous; // roll back in-memory state if the write fails
    throw err;
  }
  return getEditableBlock();
}

function reset() {
  try { fs.unlinkSync(OVERLAY_PATH); } catch { /* ignore */ }
  overlay = emptyOverlay();
  return getEditableBlock();
}

module.exports = {
  getHitlThreshold,
  getAuthorizedActorClientId,
  getToolDiscoveryDecision,
  requiredScopesForTool,
  isWriteTool,
  hasChallengeType,
  getEditableBlock,
  applyPatch,
  reset,
};
