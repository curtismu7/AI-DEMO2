'use strict';

/**
 * scopeTopology.js — BFF accessor for the repo-root scope-topology.json SSOT.
 * Loaded + schema-validated once at first require. Throws on invalid manifest
 * so a malformed topology fails fast at service boot, never silently.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
// Default resolves to the repo-root SSOT (host, tests, image builds). In Docker
// dev the repo root is bind-mounted as a directory and SCOPE_TOPOLOGY_PATH points
// here — a directory mount survives the host file being replaced (git merge /
// regen give it a new inode), which a single-file bind mount does not.
const MANIFEST_PATH =
  process.env.SCOPE_TOPOLOGY_PATH || path.join(ROOT, 'scope-topology.json');

let _manifest = null;
let _manifestMtimeMs = 0;

function load() {
  // Memoized, but re-validated against the file's mtime so an edited or
  // replaced SSOT (git merge/checkout, topology regen, admin editor save) is
  // picked up on the next read without a process restart. statSync costs
  // microseconds. Boot keeps fail-fast semantics (first load throws on a bad
  // manifest); after boot a failed reload keeps serving the last good
  // manifest instead of taking down in-flight requests.
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(MANIFEST_PATH).mtimeMs;
  } catch (err) {
    if (!_manifest) throw err;
    return _manifest; // transient stat blip — keep the memo
  }
  if (_manifest && mtimeMs === _manifestMtimeMs) return _manifest;
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const m = JSON.parse(raw);
    // v1, v2, and v3 are accepted. v2 adds resources.*.mirroredScopes,
    // a top-level `servers` block, and apps.*.{type,grantTypes,isResourceServer}.
    // v3 adds the deployment section for public app URLs. All additions are optional.
    if (!m || (m.version !== 1 && m.version !== 2 && m.version !== 3) || !m.scopes || !m.tools || !m.apps || !m.resources) {
      throw new Error('[scopeTopology] scope-topology.json missing required top-level keys or unsupported version');
    }
    _manifest = m;
    _manifestMtimeMs = mtimeMs;
    return _manifest;
  } catch (err) {
    if (_manifest) {
      console.error('[scopeTopology] reload failed — keeping previous manifest:', err.message);
      _manifestMtimeMs = mtimeMs; // don't retry the same bad write on every call
      return _manifest;
    }
    throw err;
  }
}

/** Required scopes for a tool. Falls back to ['read'] for unknown tools. */
function toolScopes(toolName) {
  const t = load().tools[toolName];
  return t ? t.requiredScopes.slice() : ['read'];
}

/** Tool surface class: 'gateway' | 'exchange-only' | 'legacy-alias' | undefined. */
function toolSurface(toolName) {
  const t = load().tools[toolName];
  return t ? t.surface : undefined;
}

/** challengeType for a tool ('step_up' | 'consent'); defaults to 'consent'. */
function toolChallengeType(toolName) {
  const t = load().tools[toolName];
  return (t && t.challengeType) || 'consent';
}

/**
 * True when the tool DECLARES a challengeType in the SoT (i.e. it is a
 * consent-gated or step-up tool), as opposed to `toolChallengeType`'s 'consent'
 * default for ungated tools. Mirrors the mock authz server's
 * ruleStore.hasChallengeType so the BFF simulated engine can gate no-amount
 * tools by tool name exactly like the mock and the P1AZ snapshot policy.
 */
function toolDeclaresChallenge(toolName) {
  const t = load().tools[toolName];
  return !!(t && t.challengeType);
}

/**
 * True when the tool is A2A-delegated — reachable ONLY via specialist delegation.
 * Authorize DENYs it unless the token's act chain shows a specialist delegated by
 * the generalist (depth >= 2). SoT flag: tools.<name>.a2aDelegated === true.
 */
function isA2aDelegatedTool(toolName) {
  const t = load().tools[toolName];
  return !!(t && t.a2aDelegated === true);
}

/**
 * True when the tool requires agent mediation (an `act` claim).
 * Used by the UC16 impersonation-block rule: when ff_require_act_for_agent_tools=true,
 * tool calls to these tools are DENIED if the bearer token has no `act` claim.
 * SoT flag: tools.<name>.requiresAgentMediation === true.
 * Fail-open: returns false for unknown tools.
 */
function isAgentMediatedTool(toolName) {
  const t = load().tools[toolName];
  return !!(t && t.requiresAgentMediation === true);
}

/**
 * Specialist-only scope override for a tool. When set, A2A Exchange #2 requests
 * this scope instead of requiredScopes[]. Needed because PingOne enforces scope-name
 * uniqueness across grants — a specialist can't hold the same scope name on two
 * different resource servers. Returns null when no override is defined.
 */
function a2aDelegatedScope(toolName) {
  const t = load().tools[toolName];
  return (t && t.a2aDelegatedScope) || null;
}

function appGrantedScopes(appName) {
  const a = load().apps[appName];
  return a ? a.grantedScopes.slice() : [];
}

/**
 * All scopes that must exist on a resource server = native scopes the RS owns
 * PLUS scopes mirrored onto it because it is an RFC 8693 exchange-hop audience
 * (ARCHITECTURE-TRUTHS T-10). This is the set bootstrap must provision onto
 * the PingOne resource. Deduped, order: native first then mirrored.
 */
function resourceScopes(resourceName) {
  const r = load().resources[resourceName];
  if (!r) return [];
  const native = r.scopes || [];
  const mirrored = r.mirroredScopes || [];
  return [...new Set([...native, ...mirrored])];
}

/** Just the scopes this RS canonically owns (no mirrored). */
function resourceNativeScopes(resourceName) {
  const r = load().resources[resourceName];
  return r && r.scopes ? r.scopes.slice() : [];
}

/** Just the scopes mirrored onto this RS for exchange hops (v2). [] if none. */
function resourceMirroredScopes(resourceName) {
  const r = load().resources[resourceName];
  return r && r.mirroredScopes ? r.mirroredScopes.slice() : [];
}

/** Resource server's audience (uri). null if not modelled. */
function resourceUri(resourceName) {
  const r = load().resources[resourceName];
  return (r && r.uri) || null;
}

/**
 * PingOne display name provisioned for a topology resource
 * (provisioning.resourceNames, e.g. "Super Banking API" -> "Demo API").
 * Falls back to the canonical topology name when no mapping exists.
 */
function provisionedResourceName(resourceName) {
  const p = load().provisioning;
  return (p && p.resourceNames && p.resourceNames[resourceName]) || resourceName;
}

// Canonical PingOne resource-server audiences, keyed by role. The single source
// of truth for these hostnames is the resources[].uri fields in
// scope-topology.json. Identity-format / delegation / RFC 9728 services derive
// their literals and regexes from here instead of hardcoding the strings, so a
// rename in scope-topology.json propagates everywhere.
const AUDIENCE_RESOURCE_NAMES = {
  enduser: 'Super Banking API',
  agentGateway: 'Super Banking Agent Gateway',
  mcpServer: 'Super Banking MCP Server',
  mcpGateway: 'Super Banking MCP Gateway',
  a2aIntermediate: 'Super Banking A2A Intermediate',
};

/** { enduser, agentGateway, mcpServer, mcpGateway } resolved from scope-topology.json. */
function audiences() {
  const out = {};
  for (const [key, resourceName] of Object.entries(AUDIENCE_RESOURCE_NAMES)) {
    const uri = resourceUri(resourceName);
    if (!uri) {
      // Fail fast at boot (consistent with load()) rather than letting a null
      // audience flow into the consuming regexes / URI templates.
      throw new Error(`[scopeTopology] no resource uri for audience '${key}' (resource '${resourceName}')`);
    }
    out[key] = uri;
  }
  return out;
}

/** Full app entry { grantedScopes, type?, grantTypes?, isResourceServer? } or null. */
function appEntry(appName) {
  return load().apps[appName] || null;
}

/** v2 servers block: { resource, validatesAudience?, gatesOnToolScopes?, description? } or null. */
function serverEntry(serverName) {
  const s = load().servers || {};
  return s[serverName] || null;
}

/** All resource server names modelled in the topology. */
function allResources() {
  return Object.keys(load().resources);
}

/** All app names modelled in the topology. */
function allApps() {
  return Object.keys(load().apps);
}

function allTools() {
  return Object.keys(load().tools);
}

function scopeMeta(scope) {
  return load().scopes[scope] || null;
}

/** All scope names declared in scopes{}. */
function allScopes() {
  return Object.keys(load().scopes);
}

/**
 * External-spelling -> canonical-manifest-scope map (aliases{} in the manifest).
 * Reconciles spellings used outside the manifest (PingGateway env, OAuth
 * /authorize) with the canonical scope declared in scopes{}. {} if none.
 */
function aliases() {
  return { ...(load().aliases || {}) };
}

/**
 * Normalize an external scope spelling to its canonical manifest scope via
 * aliases{}. Canonical / unknown scopes pass through unchanged (idempotent).
 */
function normalizeScope(scope) {
  const a = load().aliases || {};
  return a[scope] || scope;
}

module.exports = {
  toolScopes,
  toolSurface,
  toolChallengeType,
  toolDeclaresChallenge,
  isA2aDelegatedTool,
  isAgentMediatedTool,
  a2aDelegatedScope,
  appGrantedScopes,
  resourceScopes,
  resourceNativeScopes,
  resourceMirroredScopes,
  resourceUri,
  provisionedResourceName,
  audiences,
  appEntry,
  serverEntry,
  allResources,
  allApps,
  allTools,
  scopeMeta,
  allScopes,
  aliases,
  normalizeScope,
  _manifest: load,
};
