import { useCallback, useEffect, useState } from 'react';
import { useAgentUiMode } from '../../context/AgentUiModeContext';

/**
 * TalkPane — the chat-left / narration-right split that lives under the Talk tab.
 *
 * Phase 3c: the left column registers itself as the BankingAgent surface host
 * via setSurfaceHostEl (same pattern as EmbeddedAgentDock). The existing
 * <BankingAgent> rendered by App.js portals into this host — no duplicate
 * instance, no React tree changes elsewhere. While the host is empty (first
 * mount, agent not yet rendered) the column shows a brief placeholder.
 *
 * Phase 3d wires TokenAuditTimeline into the right column (currently shows
 * placeholder cards subscribed to TokenChainContext).
 */
export default function TalkPane() {
  const { setSurfaceHostEl, setClinicalSplit } = useAgentUiMode();
  const [hostEl, setHostEl] = useState(null);

  const hostRefCb = useCallback((el) => setHostEl(el), []);

  useEffect(() => {
    setSurfaceHostEl(hostEl);
    return () => {
      setSurfaceHostEl((cur) => (cur === hostEl ? null : cur));
    };
  }, [hostEl, setSurfaceHostEl]);

  // Tell App.js to render BankingAgent with mode="inline" + splitColumnChrome.
  // That swaps the floating dock chrome for the .ba-mode-inline layout that
  // already exists in BankingAgent.css.
  useEffect(() => {
    setClinicalSplit(true);
    return () => setClinicalSplit(false);
  }, [setClinicalSplit]);

  // Auto-open the agent once the host is ready. BankingAgent listens for the
  // 'banking-agent-open' event (see BankingAgent.js:2314) — same channel the
  // AdminSideNav uses. Without this the user lands on an "AI Agent" FAB they
  // have to click before chatting; in the clinical layout the chat IS the
  // page so we open it for them.
  useEffect(() => {
    if (!hostEl) return undefined;
    const t = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('banking-agent-open'));
    }, 80);
    return () => clearTimeout(t);
  }, [hostEl]);

  return (
    <div className="ac-talk">
      <section className="ac-talk-chat" aria-label="Chat with assistant">
        {/* BankingAgent portals into this div via surfaceHostEl. */}
        <div ref={hostRefCb} className="ac-chat-host" />
      </section>

      <aside className="ac-talk-narrate" aria-label="Live token chain narration">
        <header className="ac-narrate-head">
          <div className="ac-eyebrow ac-eyebrow--small">Audit timeline</div>
          <h2 className="ac-narrate-h2">
            What just <i>happened</i>
          </h2>
          <div className="ac-narrate-meta">
            Phase 3d wires the real <strong>TokenAuditTimeline</strong> here.
          </div>
        </header>

        <div className="ac-narrate-tabs" role="tablist" aria-label="Narration view">
          <button type="button" role="tab" aria-selected="true"  className="ac-narrate-tab ac-narrate-tab--on">Token chain</button>
          <button type="button" role="tab" aria-selected="false" className="ac-narrate-tab">MCP calls</button>
          <button type="button" role="tab" aria-selected="false" className="ac-narrate-tab">Rules</button>
          <button type="button" role="tab" aria-selected="false" className="ac-narrate-tab">Tools</button>
        </div>

        <div className="ac-narrate-body">
          <TimelinePlaceholderCard tokenRole="Subject token"      rfc="RFC 8693 §2.1" name="User access token"            sub="PingOne OIDC · stays in BFF" />
          <TimelinePlaceholderCard tokenRole="Actor token"        rfc="RFC 8693 §2.2" name="Agent actor (CC prefetched)"  sub="Client credentials · adds delegation proof" />
          <TimelinePlaceholderCard tokenRole="Delegated MCP token" rfc="RFC 8693 §3.2" name="Result of exchange"           sub="Nested act claim · sent only to MCP server" />
        </div>
      </aside>
    </div>
  );
}

function TimelinePlaceholderCard({ tokenRole, rfc, name, sub }) {
  return (
    <div className="ac-tstep ac-tstep--done">
      <div className="ac-tstep-card">
        <div className="ac-tstep-row1">
          <span className="ac-tstep-role">{tokenRole}</span>
          <span className="ac-tstep-rfc">{rfc}</span>
        </div>
        <div className="ac-tstep-name">{name}</div>
        <div className="ac-tstep-sub">{sub}</div>
      </div>
    </div>
  );
}
