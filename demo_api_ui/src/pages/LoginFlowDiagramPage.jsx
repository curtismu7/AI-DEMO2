// demo_api_ui/src/pages/LoginFlowDiagramPage.jsx
// /login-flow — the login sequence diagram, on its own page. Was previously
// crammed into the small floating Agent Flow panel alongside the unrelated
// Token Exchange/Token Chain sections; moved out here so it has room.
// Reads the same in-memory agentFlowDiagram state the floating panel does —
// session-memory only, so it resets on reload (see loginFlowTraceService.js
// for why: the browser is away at PingOne for the middle of a login).
import React, { useEffect, useState } from 'react';
import { agentFlowDiagram } from '../services/agentFlowDiagramService';
import { StepTimeline } from '../components/AgentFlowDiagramPanel';
import './LoginFlowDiagramPage.css';

const PAGE_TITLE = 'Login Flow Diagram';

export default function LoginFlowDiagramPage() {
  const [snap, setSnap] = useState(() => agentFlowDiagram.getState());

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${PAGE_TITLE} · Super Banking`;
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => agentFlowDiagram.subscribe(setSnap), []);

  const hasLoginTrace = snap.toolName === 'login' && snap.steps.length > 0;

  return (
    <div className="login-flow-page">
      <div className="lfp-header">
        <h1 className="lfp-title">{PAGE_TITLE}</h1>
        <p className="lfp-subtitle">
          The real sequence recorded by the BFF during your last PingOne OAuth 2.0 + PKCE sign-in —
          lifelines, protocol detail, and a replay control.
        </p>
      </div>

      {hasLoginTrace ? (
        <div className="lfp-diagram">
          <StepTimeline steps={snap.steps} phase={snap.phase} />
        </div>
      ) : (
        <div className="lfp-empty">
          <p>No login recorded yet in this browser session.</p>
          <p className="lfp-empty-hint">
            Sign out and sign back in, then come back to this page — the trace lives only in
            memory, so it resets on reload.
          </p>
        </div>
      )}
    </div>
  );
}
