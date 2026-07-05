import { useCallback, useEffect, useState } from 'react';
import { useAgentUiMode } from '../../context/AgentUiModeContext';
import TokenAuditTimeline from './TokenAuditTimeline';

/**
 * TalkPane — the chat-left / narration-right split that lives under the Talk tab.
 *
 * Phase 3c: the left column registers itself as the BankingAgent surface host
 * via setSurfaceHostEl (same pattern as EmbeddedAgentDock). The existing
 * <BankingAgent> rendered by App.js portals into this host — no duplicate
 * instance, no React tree changes elsewhere. While the host is empty (first
 * mount, agent not yet rendered) the column shows a brief placeholder.
 *
 * Right column: TokenAuditTimeline (Phase 3d) — live TokenChainContext events
 * for the most recent agent action. The full inspector is on the Tokens tab.
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
            Live token chain for the last agent action — full inspector on the{' '}
            <strong>Tokens</strong> tab.
          </div>
        </header>

        <div className="ac-narrate-body">
          <TokenAuditTimeline />
        </div>
      </aside>
    </div>
  );
}
