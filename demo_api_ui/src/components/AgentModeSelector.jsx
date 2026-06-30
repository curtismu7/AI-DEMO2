// banking_api_ui/src/components/AgentModeSelector.jsx
import React, { useEffect, useRef, useState } from "react";
import useLangchainProvider from "../hooks/useLangchainProvider";
import "./AgentModeSelector.css";

// FOUR single-brain modes (2026-06-11 simplification). Each maps to one
// provider; heuristics needs none. A mode is greyed out when its provider is
// unconfigured/unreachable — the honest disabled state that replaced the old
// silent Helix fallback.
const CORE_MODE_IDS = ['heuristics', 'llamacpp', 'claude', 'helix_google'];
const MODE_PROVIDER = { heuristics: null, llamacpp: 'llamacpp', claude: 'anthropic', helix_google: 'helix' };

// `compact` = condensed variant for the BankingAgent header.
// `onChange` (optional) is notified { mode, provider } after a committed
// mode/provider change so a co-located key UI can re-sync server state.
export default function AgentModeSelector({ compact = false, onChange }) {
  const {
    mode,
    externalWiring,
    modeOptions,
    saving,
    loading,
    setMode,
    setExternalWiring,
    provider,
    keySet,
  } = useLangchainProvider();

  // llama.cpp availability is a live reachability probe (the server may be down or
  // no model loaded); anthropic/helix come from the honest sync keySet.
  // null = not yet probed (treated as available so we never flicker-disable).
  const [llamaCppOk, setLlamaCppOk] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/langchain/provider/llamacpp/status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setLlamaCppOk(d ? d.status === "available" : false); })
      .catch(() => { if (!cancelled) setLlamaCppOk(false); });
    return () => { cancelled = true; };
  }, []);

  // A mode is available when its provider is configured/reachable. Heuristics is
  // always available; an un-probed llama.cpp is assumed available (avoid flicker).
  const modeAvailable = (id) => {
    const p = MODE_PROVIDER[id];
    if (!p) return true;
    if (p === 'llamacpp') return llamaCppOk !== false;
    return keySet?.[p] === true;
  };

  const settledRef = useRef(null);
  useEffect(() => {
    if (loading) return;
    if (settledRef.current === null) {
      settledRef.current = { mode, provider };
      return;
    }
    if (settledRef.current.mode !== mode || settledRef.current.provider !== provider) {
      settledRef.current = { mode, provider };
      if (typeof onChange === "function") onChange({ mode, provider });
    }
  }, [mode, provider, loading, onChange]);

  if (loading || modeOptions.length === 0) return null;

  // The four single-brain modes, in picker order. Filtering by id is robust
  // against the resolver order and keeps any retired modes out of the UI.
  const coreOptions = CORE_MODE_IDS
    .map((id) => modeOptions.find((m) => m.id === id))
    .filter(Boolean);

  const current = modeOptions.find((m) => m.id === mode);
  const isExternal = !!current && current.external;
  const showDegraded = isExternal && externalWiring === "platform";

  return (
    <div className={`ams${compact ? " ams--compact" : ""}`}>
      <label className="ams-label">
        Agent mode
        <select
          aria-label="Agent mode"
          value={mode}
          disabled={saving}
          onChange={(e) => setMode(e.target.value, externalWiring)}
          className="ctl-select ams-select"
        >
          {coreOptions.map((m) => {
            const available = modeAvailable(m.id);
            return (
              <option key={m.id} value={m.id} disabled={!available}>
                {m.label}{available ? "" : " — not configured"}
              </option>
            );
          })}
        </select>
      </label>

      <label className={`ams-label ams-wiring${isExternal ? "" : " ams-wiring--hidden"}`}>
        Wiring
        <select
          aria-label="External wiring"
          value={externalWiring ?? "bff"}
          disabled={saving || !isExternal}
          onChange={(e) => setExternalWiring(e.target.value)}
          className="ctl-select ams-select"
        >
          <option value="bff">via BFF (token chain intact)</option>
          <option value="platform">platform-driven (token chain lost)</option>
        </select>
      </label>

      {showDegraded && !compact && (
        <p className="ams-degraded" role="note">
          ⚠️ Delegation lost here — a third party holds a broad gateway token.
          No per-tool RFC 8693 exchange, no <code>act</code> claim, Token Chain
          dark before the gateway. The Ping Agent Gateway + PingOne Authorization Server still enforce
          policy on every tool call.
        </p>
      )}

      {showDegraded && compact && (
        <span
          className="ams-degraded-chip"
          role="note"
          title="Delegation lost — third party holds a broad gateway token. No per-tool RFC 8693 exchange, no act claim. Gateway + PingOne Authorization Server still enforce."
        >
          ⚠️ delegation lost
        </span>
      )}
    </div>
  );
}
