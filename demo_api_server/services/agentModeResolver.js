// banking_api_server/services/agentModeResolver.js
/**
 * Single SSOT mapping the user-facing agent MODE to the low-level
 * primitives (LLM provider, heuristic ROUTING on/off, external wiring).
 *
 * ARCHITECTURE-TRUTHS T-3 (amended): the heuristic ROUTING fast-path is
 * mode-dependent. Server-side transfer/HITL/Authorize enforcement is
 * INDEPENDENT of mode and is NOT affected here (see REGRESSION_PLAN §1).
 *
 * provider values feed llmProviderResolver unchanged (it stays the
 * single low-level resolver). heuristicRouting maps onto the existing
 * ff_heuristic_enabled primitive. externalWiring is 'bff' | 'platform'
 * for the three external (LLM) modes (null for heuristics-only).
 */
// FOUR single-brain modes. Each is exactly ONE router with NO fallback chain:
// heuristics is deterministic-only; the other three are pure-LLM (one provider).
// The old hybrid "Heuristics + X" combos and the hidden ChatGPT/LM-Studio modes
// were retired (2026-06-11) — fallback branches were the source of "agent does
// nothing / ignores the selected mode" instability. A mode whose provider is
// unconfigured is greyed out in the UI rather than silently falling back.
const AGENT_MODES = [
  { id: 'heuristics',   label: 'Heuristics only', provider: null,        heuristicRouting: true,  external: false },
  { id: 'llamacpp',     label: 'llama.cpp only',  provider: 'llamacpp',  heuristicRouting: false, external: true  },
  { id: 'claude',       label: 'Anthropic only',  provider: 'anthropic', heuristicRouting: false, external: true  },
  { id: 'helix_google', label: 'Helix only',      provider: 'helix',     heuristicRouting: false, external: true  },
];

const DEFAULT_MODE = 'heuristics'; // stable, no-config-safe default (deterministic)

function resolveAgentMode(modeId, externalWiring) {
  const found = AGENT_MODES.find((m) => m.id === modeId);
  const m = found || AGENT_MODES.find((x) => x.id === DEFAULT_MODE);
  return {
    mode: m.id,
    provider: m.provider,
    heuristicRouting: m.heuristicRouting,
    externalWiring: m.external ? (externalWiring === 'platform' ? 'platform' : 'bff') : null,
  };
}

module.exports = { resolveAgentMode, AGENT_MODES, DEFAULT_MODE };
