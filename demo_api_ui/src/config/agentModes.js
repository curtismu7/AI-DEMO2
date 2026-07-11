// demo_api_ui/src/config/agentModes.js
//
// Client-side single source of truth for the FIVE single-brain agent modes.
// This table MUST mirror the server resolver's CORE_MODES in
// demo_api_server/services/agentModeResolver.js — the drift guard in
// __tests__/agentModes.test.js reads that file and fails the build if the id
// set or provider mapping here disagrees with the server.
//
// Why this file exists: the id/provider mapping was previously duplicated in
// AgentModeSelector.jsx (CORE_MODE_IDS / MODE_PROVIDER) and AIAgent.js
// (PURE_LLM_MODES / PURE_LLM_LABELS / _MODE_PROVIDER_MAP). Those drifted — the
// AIAgent copies still named the retired `ollama` mode instead of `llamacpp`,
// so a down llama.cpp failed SILENTLY instead of offering the Heuristics
// fallback. Deriving everything from one table removes that whole bug class.
//
// Each mode maps to exactly one LLM provider; `heuristics` needs none (provider
// null, always available). "Pure" LLM modes are the ones with a provider — when
// that provider is unreachable the agent must fail loud (offer Heuristics),
// never answer silently.

export const AGENT_MODES = [
  { id: "heuristics",   label: "Heuristics", provider: null,        pure: false },
  // Gemini first among LLM modes: on the CPU-only SE cluster it answers in
  // seconds while llama.cpp (gpt-oss-20b) takes minutes — lead live demos
  // with the fast provider. Order here IS the picker order (CORE_MODE_IDS).
  { id: "gemini",       label: "Google Gemini", provider: "google",   pure: true  },
  { id: "llamacpp",     label: "llama.cpp",  provider: "llamacpp",  pure: true  },
  { id: "mlx",          label: "MLX",        provider: "mlx",       pure: true  },
  { id: "claude",       label: "Anthropic",  provider: "anthropic", pure: true  },
  { id: "helix_google", label: "Helix",      provider: "helix",     pure: true  },
];

// Picker order for the core modes.
export const CORE_MODE_IDS = AGENT_MODES.map((m) => m.id);

// mode id -> provider string the BFF expects (null for heuristics).
export const MODE_PROVIDER = Object.fromEntries(
  AGENT_MODES.map((m) => [m.id, m.provider]),
);

// The pure single-brain LLM modes (everything except heuristics). When the
// selected pure provider is down we tell the user and offer Heuristics rather
// than silently blending in the heuristic parser.
export const PURE_LLM_MODES = AGENT_MODES.filter((m) => m.pure).map((m) => m.id);

// Short display labels for the "X is selected but not configured" message.
export const PURE_LLM_LABELS = Object.fromEntries(
  AGENT_MODES.filter((m) => m.pure).map((m) => [m.id, m.label]),
);

// Stable, no-config-safe default (deterministic; needs no provider).
export const DEFAULT_MODE = "heuristics";
