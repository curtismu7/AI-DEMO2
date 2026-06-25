'use strict';

const path = require('path');
const scopeTopology = require(path.resolve(__dirname, '../../scope-topology.json'));

// Build a tool → riskLevel map from scope-topology.json at load time.
// Each tool in the BankingToolRegistry has requiredScopes that match scope names here.
// riskLevel 'high' or 'critical' → write tier. 'low' or 'medium' → read tier.
const WRITE_RISK_LEVELS = new Set(['high', 'critical']);

// Tool → required scopes mapping sourced from scope-topology.json tools section.
// Falls back to scope-level riskLevel lookup.
function _buildToolTierMap() {
  const map = {};
  const scopes = scopeTopology.scopes || {};
  // tools section maps tool names to their required scopes (if present)
  const tools = scopeTopology.tools || {};
  for (const [toolName, toolDef] of Object.entries(tools)) {
    const requiredScopes = toolDef.requiredScopes || [];
    const isWrite = requiredScopes.some((scopeName) => {
      const scope = scopes[scopeName];
      return scope && WRITE_RISK_LEVELS.has(scope.riskLevel);
    });
    map[toolName] = isWrite ? 'write' : 'read';
  }
  return map;
}

const _toolTierMap = _buildToolTierMap();

/**
 * Resolve the capability tier required for a given tool name.
 * Derives from scope-topology.json riskLevel — no hardcoded route map.
 * Unknown tools default to 'read' (fail open).
 *
 * @param {string} toolName
 * @returns {'read'|'write'}
 */
function getRequiredTier(toolName) {
  return _toolTierMap[toolName] || 'read';
}

/**
 * Evaluate whether an agent call should be denied based on the user's
 * agentRestrictions attribute and the required tier for the tool.
 *
 * @param {'read'|'write'|'none'} agentRestrictions
 * @param {'read'|'write'} requiredTier
 * @returns {boolean} true if the call should be denied
 */
function isAgentRestricted(agentRestrictions, requiredTier) {
  if (agentRestrictions === 'none') return true;
  if (agentRestrictions === 'read' && requiredTier === 'write') return true;
  return false;
}

module.exports = { getRequiredTier, isAgentRestricted };
