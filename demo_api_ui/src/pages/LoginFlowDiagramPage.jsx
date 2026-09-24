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

const PAGE_TITLE = 'Identity Journey Map';
const LAST_LOGIN_TRACE_KEY = 'identity-journey:last-login-trace';

const JOURNEY_STAGES = [
  {
    label: 'Registration',
    detail: 'Create or discover the user identity and establish the application relationship.',
    handoff: 'Identity is ready',
  },
  {
    label: 'Authentication',
    detail: 'Redirect to PingOne for centralized sign-in; the application never handles the password.',
    handoff: 'Policy checks assurance',
  },
  {
    label: 'MFA step-up',
    detail: 'Require stronger proof when policy or transaction risk raises the assurance level.',
    handoff: 'Risk is resolved',
  },
  {
    label: 'Recovery',
    detail: 'Route an interrupted or expired journey through a safe recovery path without weakening policy.',
    handoff: 'Callback returns',
  },
  {
    label: 'Session complete',
    detail: 'Return to the application with the callback handled server-side and the session established.',
  },
];

function readLastLoginTrace() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(LAST_LOGIN_TRACE_KEY) || 'null');
    if (!saved || !Array.isArray(saved.steps) || saved.steps.length === 0) return null;
    return saved;
  } catch (_) {
    return null;
  }
}

function rememberLoginTrace(snap) {
  if (snap.toolName !== 'login' || !Array.isArray(snap.steps) || snap.steps.length === 0) return;
  try {
    sessionStorage.setItem(LAST_LOGIN_TRACE_KEY, JSON.stringify({
      phase: snap.phase,
      steps: snap.steps.map(({ title, detail, actor, toActor, protocolDetail }) => ({
        title,
        detail,
        actor,
        toActor,
        protocolDetail,
      })),
    }));
  } catch (_) {
    // Session storage is best-effort; the live in-memory trace still works.
  }
}

export default function LoginFlowDiagramPage() {
  const [snap, setSnap] = useState(() => agentFlowDiagram.getState());
  const [showTrace, setShowTrace] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${PAGE_TITLE} · Super Banking`;
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    let firstSnapshot = true;
    return agentFlowDiagram.subscribe((nextSnap) => {
      rememberLoginTrace(nextSnap);
      if (firstSnapshot) {
        firstSnapshot = false;
        return;
      }
      setSnap(nextSnap);
      setShowTrace(nextSnap.toolName === 'login' && nextSnap.steps.length > 0);
    });
  }, []);

  const handleRefresh = () => {
    const saved = readLastLoginTrace();
    if (!saved) return;
    agentFlowDiagram.showLoginFlow(saved.steps);
    setShowTrace(true);
  };

  const handleClear = () => {
    agentFlowDiagram.setState({ phase: 'idle', toolName: null, steps: [], serverEvents: [] });
    setShowTrace(false);
  };

  const hasLoginTrace = showTrace && snap.toolName === 'login' && snap.steps.length > 0;

  return (
    <div className="login-flow-page">
      <div className="lfp-header">
        <h1 className="lfp-title">{PAGE_TITLE}</h1>
        <p className="lfp-subtitle">
          The identity journey from registration through recovery, followed by the real sequence
          recorded by the BFF during your last PingOne OAuth 2.0 + PKCE sign-in.
        </p>
      </div>

      <section className="lfp-journey" aria-label="Identity journey map">
        <div className="lfp-section-heading">
          <h2>Identity journey</h2>
          <span>Journey stages</span>
        </div>
        <ol className="lfp-journey-track">
          {JOURNEY_STAGES.map((stage, index) => (
            <React.Fragment key={stage.label}>
              <li className={`lfp-journey-stage lfp-journey-stage--${index + 1}`}>
                <span className="lfp-journey-number">{index + 1}</span>
                <div>
                  <h3>{stage.label}</h3>
                  <p>{stage.detail}</p>
                </div>
              </li>
              {stage.handoff && (
                <li className="lfp-journey-handoff" aria-label={`Transition: ${stage.handoff}`}>
                  <span className="lfp-journey-arrow" aria-hidden="true">→</span>
                  <span>{stage.handoff}</span>
                </li>
              )}
            </React.Fragment>
          ))}
        </ol>
      </section>

      <section className={`lfp-trace${hasLoginTrace ? '' : ' lfp-trace--empty'}`} aria-label="Recorded login sequence">
        <div className="lfp-section-heading">
          <div>
            <h2>Live login evidence</h2>
            <span>OAuth 2.0 + PKCE</span>
          </div>
          <div className="lfp-trace-actions">
            <button type="button" className="lfp-trace-button" onClick={handleRefresh} aria-label="Refresh login trace">
              Refresh
            </button>
            <button type="button" className="lfp-trace-button lfp-trace-button--quiet" onClick={handleClear} aria-label="Clear login trace">
              Clear
            </button>
          </div>
        </div>
        {hasLoginTrace ? (
          <StepTimeline steps={snap.steps} phase={snap.phase} />
        ) : (
          <div className="lfp-empty">
          <p>No login recorded yet in this browser session.</p>
          <p className="lfp-empty-hint">
            Refresh restores the last captured login trace. The journey map above is the default view.
          </p>
          </div>
        )}
      </section>
    </div>
  );
}
