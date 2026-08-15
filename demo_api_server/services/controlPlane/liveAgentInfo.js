'use strict';
const { resolveAgentMode, AGENT_MODES } = require('../agentModeResolver');
const configStore = require('../configStore');
const { verticalManifest } = require('../verticalManifest');

// Builds the "live agent" roster row. The label reflects the session-active
// vertical and the current LLM provider, demonstrating that the real kill is
// vertical- and provider-agnostic (it severs authority, not compute). Never
// throws — falls back to safe defaults.
function getLiveAgentRow(req) {
  let verticalLabel = 'Live';
  try {
    const id = verticalManifest.resolver.activeIdFor(req);
    const manifest = verticalManifest.resolver.resolve(id);
    verticalLabel = (manifest && manifest.identity && manifest.identity.displayName) || id || 'Live';
  } catch (_) { /* fall back */ }

  let provider = null;
  let providerLabel = 'Heuristics';
  try {
    const modeId = configStore.getEffective('agent_mode');
    const resolved = resolveAgentMode(modeId);
    provider = resolved.provider;
    const entry = AGENT_MODES.find((m) => m.id === resolved.mode);
    providerLabel = (entry && entry.label) || resolved.mode;
  } catch (_) { /* fall back */ }

  return {
    id: 'demo-agent',
    kind: 'live',
    label: `Live Agent (${verticalLabel})`,
    vertical: verticalLabel,
    provider,
    providerLabel,
    source: 'this-app',
    sourceLabel: 'This App',
    status: 'active',
  };
}

module.exports = { getLiveAgentRow };
