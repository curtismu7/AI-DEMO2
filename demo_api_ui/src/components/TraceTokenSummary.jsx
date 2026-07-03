// End-of-flow token summary: every token seen in the trace, with its claims
// and how it changed vs its parent in the delegation chain.
import React from "react";
import { diffTokenClaims } from "../services/tokenChainTrace/diffTokenClaims";

// Chain order + display metadata. exchanged-token's parent is user-token.
const TOKEN_META = {
  "user-token": { name: "User Token", cls: "user", role: "subject_token", parent: null, inspect: "user" },
  "agent-actor-token": { name: "Agent Token", cls: "agent", role: "actor_token", parent: null, inspect: "agent" },
  "exchanged-token": { name: "Delegated Token", cls: "mcp", role: "act chain", parent: "user-token", inspect: "mcp" },
};

export default function TraceTokenSummary({ tokenEvents, onInspect }) {
  const byId = Object.fromEntries((tokenEvents || []).map((e) => [e.id, e]));
  const tokens = Object.keys(TOKEN_META).map((id) => byId[id] && { id, evt: byId[id] }).filter(Boolean);
  if (!tokens.length) return null;

  return (
    <details className="tctr-acc">
      <summary><span className="tctr-chev">▶</span> Token Summary
        <span className="tctr-count">{tokens.length}</span></summary>
      <div className="tctr-acc-body">
        {tokens.map(({ id, evt }) => {
          const meta = TOKEN_META[id];
          const parent = meta.parent ? byId[meta.parent] : null;
          const changes = parent ? diffTokenClaims(parent.claims || {}, evt.claims || {}) : [];
          return (
            <div key={id} className={`tctr-tok tctr-tok--${meta.cls}`}>
              <button type="button" className="tctr-tok-inspect" onClick={() => onInspect(meta.inspect)}>
                Inspect
              </button>
              <div className="tctr-tok-head">
                <span className="tctr-tok-name">{evt.label || meta.name}</span>
                <span className="tctr-tok-role">{meta.role}</span>
              </div>
              <div className="tctr-tok-claims">
                {Object.entries(evt.claims || {}).slice(0, 6)
                  .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                  .join(" · ")}
              </div>
              {changes.length > 0 && (
                <div className="tctr-tok-changes">
                  {changes.map((c) => (
                    <div key={c.claim} className="tctr-tok-change">
                      <span className="tctr-kv-k">{c.claim}</span>
                      <span className="tctr-kv-v">{c.from} → {c.to} <em>({c.note})</em></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
