// banking_api_ui/src/hooks/useLangchainProvider.js
//
// Shared single-source-of-truth for the agent LLM provider selection,
// consumed by three surfaces (Config page, BankingAgent header,
// UserDashboard toolbar) so they cannot drift out of sync. Teaching
// spec: docs/superpowers/specs/2026-05-18-chatgpt-claude-as-agent.
//
// Server is the SSOT (req.session.langchain_config, resolved through
// llmProviderResolver). This hook hydrates from
// GET  /api/langchain/config/status   and persists via
// POST /api/langchain/config. `key_set` from the status endpoint is
// honest (anthropic-lmstudio always; helix when its creds set; openai/anthropic
// when the key the agent service actually uses is present) so callers
// can disable unconfigured options ("disable unconfigured" UX).
import { useCallback, useEffect, useState } from "react";

// Module-level shared state: all hook instances (AgentModeSelector, AIAgent,
// UserDashboard) subscribe here so they stay in sync when any one calls
// setMode or setProvider — without this each component keeps an independent
// React state copy that goes stale after the mode picker changes.
let _sharedMode = "heuristics";
let _sharedWiring = null;
let _sharedProvider = "helix";
const _modeListeners = new Set();
const _providerListeners = new Set();

function _broadcastMode(mode, wiring) {
  _sharedMode = mode;
  _sharedWiring = wiring;
  _modeListeners.forEach((fn) => { fn(mode, wiring); });
}
function _broadcastProvider(provider) {
  _sharedProvider = provider;
  _providerListeners.forEach((fn) => { fn(provider); });
}

// The providers we expose in the UI. groq/google exist server-side
// but are intentionally not surfaced (out of scope for this spec).
export const PROVIDER_OPTIONS = [
  { id: "helix",              label: "Helix (model-agnostic wrapper)" },
  { id: "anthropic-lmstudio", label: "LM Studio (Anthropic API, local)" },
  { id: "llamacpp",           label: "llama.cpp (local, native tool-calling)" },
  { id: "openai",             label: "OpenAI (ChatGPT)" },
  { id: "anthropic",          label: "Anthropic (Claude)" },
];

const STATUS_URL = "/api/langchain/config/status";
const SAVE_URL = "/api/langchain/config";

/**
 * @returns {{
 *   provider: string,
 *   model: string|undefined,
 *   keySet: Record<string, boolean>,
 *   options: typeof PROVIDER_OPTIONS,
 *   isConfigured: (id: string) => boolean,
 *   loading: boolean,
 *   saving: boolean,
 *   error: string|null,
 *   setProvider: (id: string) => Promise<void>,
 *   refresh: () => Promise<void>,
 *   mode: string,
 *   externalWiring: string|null,
 *   modeOptions: Array<{id:string,label:string,external:boolean}>,
 *   setMode: (id: string, wiring?: string) => Promise<void>,
 *   setExternalWiring: (w: string) => Promise<void>,
 * }}
 */
export default function useLangchainProvider() {
  const [provider, setProviderState] = useState(_sharedProvider);
  const [model, setModel] = useState(undefined);
  const [keySet, setKeySet] = useState({ 'anthropic-lmstudio': true });
  const [defaultModels, setDefaultModels] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setModeState] = useState(_sharedMode);
  const [externalWiring, setExternalWiringState] = useState(_sharedWiring);
  const [modeOptions, setModeOptions] = useState([]);

  // Subscribe to cross-instance broadcasts so every component stays in sync
  // when AgentModeSelector (or any other instance) calls setMode/setProvider.
  useEffect(() => {
    const onMode = (m, w) => {
      setModeState(m);
      setExternalWiringState(w);
    };
    const onProvider = (p) => setProviderState(p);
    _modeListeners.add(onMode);
    _providerListeners.add(onProvider);
    return () => {
      _modeListeners.delete(onMode);
      _providerListeners.delete(onProvider);
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(STATUS_URL, { credentials: "include" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const d = await res.json();
      const resolvedProvider = d.provider || "helix";
      const resolvedMode = d.agent_mode || "heuristics";
      const resolvedWiring = d.external_wiring || null;
      _sharedProvider = resolvedProvider;
      _sharedMode = resolvedMode;
      _sharedWiring = resolvedWiring;
      setProviderState(resolvedProvider);
      setModel(d.model);
      setKeySet(d.key_set || { 'anthropic-lmstudio': true });
      setDefaultModels(d.default_models || {});
      setModeState(resolvedMode);
      setExternalWiringState(resolvedWiring);
      setModeOptions(d.agent_modes || []);
    } catch (e) {
      setError(e.message || "Failed to load provider");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isConfigured = useCallback((id) => keySet[id] === true, [keySet]);

  const setProvider = useCallback(
    async (id) => {
      if (id === provider) return;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(SAVE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ provider: id, model: defaultModels[id] }),
        });
        if (!res.ok) throw new Error(`save ${res.status}`);
        const d = await res.json();
        // Server returns the *resolved* provider; trust it so the UI reflects reality.
        const resolvedProvider = d.provider || id;
        _broadcastProvider(resolvedProvider);
        setProviderState(resolvedProvider);
        setModel(d.model);
      } catch (e) {
        setError(e.message || "Failed to save provider");
      } finally {
        setSaving(false);
      }
    },
    [provider, defaultModels],
  );

  const setMode = useCallback(async (id, wiring) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(SAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agent_mode: id, external_wiring: wiring }),
      });
      if (!res.ok) throw new Error(`save ${res.status}`);
      const d = await res.json();
      const resolvedMode = d.agent_mode || id;
      const resolvedWiring = d.external_wiring ?? null;
      _broadcastMode(resolvedMode, resolvedWiring);
    } catch (e) {
      setError(e.message || "Failed to save mode");
    } finally {
      setSaving(false);
    }
  }, []);

  const setExternalWiring = useCallback(
    (w) => setMode(mode, w),
    [setMode, mode],
  );

  return {
    provider,
    model,
    keySet,
    options: PROVIDER_OPTIONS,
    isConfigured,
    loading,
    saving,
    error,
    setProvider,
    refresh,
    mode,
    externalWiring,
    modeOptions,
    setMode,
    setExternalWiring,
  };
}
