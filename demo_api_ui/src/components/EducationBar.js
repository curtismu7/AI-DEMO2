// banking_api_ui/src/components/EducationBar.js
import React, { useCallback, useRef, useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import { useDemoTour } from '../context/DemoTourContext';
import { useDemoMode } from '../hooks/useDemoMode';
import './EducationBar.css';

/**
 * Top-right hamburger: Agent UI + OAuth/learn shortcuts (full mode) or Agent UI only (DEMO_MODE).
 */
export default function EducationBar() {
  const demoMode = useDemoMode();
  const { open } = useEducationUI();
  const [panelOpen, setPanelOpen] = useState(false);
  const menuRef = useRef(null);

  const close = useCallback(() => setPanelOpen(false), []);
  const tour = useDemoTour();

  useEffect(() => {
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [close]);

  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  const go = useCallback((panelId, tabId) => () => { open(panelId, tabId); close(); }, [open, close]);

  const openCiba = () => {
    window.dispatchEvent(new CustomEvent('education-open-ciba', { detail: { tab: 'what' } }));
    close();
  };

  const openCimd = () => {
    window.dispatchEvent(new CustomEvent('education-open-cimd', { detail: { tab: 'what' } }));
    close();
  };

  const openApiTraffic = () => {
    window.open('/api-traffic', 'ApiTraffic', 'width=1400,height=900,scrollbars=yes,resizable=yes');
    close();
  };

  if (demoMode === true) {
    return (
      <div className="edu-bar edu-bar--dock" ref={menuRef}>
        <button
          type="button"
          className="edu-bar-hamburger"
          aria-expanded={panelOpen}
          aria-controls="edu-bar-panel"
          aria-label="Agent UI menu"
          onClick={() => setPanelOpen((o) => !o)}
        >
          <span className="edu-bar-hamburger__line" aria-hidden="true" />
          <span className="edu-bar-hamburger__line" aria-hidden="true" />
          <span className="edu-bar-hamburger__line" aria-hidden="true" />
        </button>
        {panelOpen && (
          <div
            id="edu-bar-panel"
            className="edu-bar-panel edu-bar-panel--minimal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edu-bar-panel-title"
          >
            <h2 id="edu-bar-panel-title" className="edu-bar-panel__title">
              Agent UI
            </h2>
            <button
              type="button"
              className="edu-bar-panel__btn"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('agent-flow-diagram-open'));
                close();
              }}
            >
              Agent flow diagram
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="edu-bar edu-bar--dock" ref={menuRef}>
      <button
        type="button"
        className="edu-bar-hamburger"
        aria-expanded={panelOpen}
        aria-controls="edu-bar-panel"
        aria-label="Learn topics and agent UI"
        onClick={() => setPanelOpen((o) => !o)}
      >
        <span className="edu-bar-hamburger__line" aria-hidden="true" />
        <span className="edu-bar-hamburger__line" aria-hidden="true" />
        <span className="edu-bar-hamburger__line" aria-hidden="true" />
      </button>
      {panelOpen && (
        <div
          id="edu-bar-panel"
          className="edu-bar-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edu-bar-panel-title"
        >
          <h2 id="edu-bar-panel-title" className="edu-bar-panel__title">
            Learn &amp; agent
          </h2>

          <div className="edu-bar-panel__section">
            <button type="button" className="edu-bar-panel__btn edu-bar-panel__btn--featured" onClick={() => { tour.start(); close(); }}>
              Guided Demo Tour (5 min)
            </button>
            <button type="button" className="edu-bar-panel__btn edu-bar-panel__btn--featured" onClick={go(EDU.BEST_PRACTICES, 'overview')}>
              AI Agent Best Practices
            </button>
          </div>

          <div className="edu-bar-panel__section">
            <p className="edu-bar-panel__heading">OAuth flows</p>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.OBO, 'what')}>On-Behalf-Of (OBO)</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.A2A_DELEGATION, 'what')}>Agent-to-Agent (A2A)</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.LOGIN_FLOW, 'what')}>Authorization Code + PKCE</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.LOGIN_FLOW, 'ciba')}>CIBA (OOB) — short (drawer)</button>
            <button type="button" className="edu-bar-panel__btn" onClick={openCiba}>CIBA — full guide (floating)</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.TOKEN_EXCHANGE, 'why')}>Token Exchange (RFC 8693)</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.PAR, 'what')}>PAR (RFC 9126)</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.RAR, 'what')}>RAR (RFC 9396)</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.DPOP, 'what')}>DPoP (RFC 9449)</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.JWT_CLIENT_AUTH, 'what')}>JWT client auth (RFC 7523)</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.OIDC_21, 'what')}>OIDC 2.1 spec alignment</button>
          </div>

          <div className="edu-bar-panel__section">
            <p className="edu-bar-panel__heading">Shortcuts</p>
            <NavLink
              to="/demo-data"
              className={({ isActive }) =>
                `edu-bar-panel__btn edu-bar-panel__link${isActive ? ' edu-bar-panel__link--active' : ''}`
              }
              title="Sandbox accounts, balances, profile, MFA threshold, agent layout"
              onClick={close}
            >
              Demo config
            </NavLink>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.MAY_ACT, 'what')}>may_act / act</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.LOGIN_FLOW, 'pkce')}>PKCE</button>
            <button type="button" className="edu-bar-panel__btn" onClick={openCiba}>CIBA</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.MCP_PROTOCOL, 'what')}>MCP Protocol</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.INTROSPECTION, 'why')}>Introspection</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.AGENT_GATEWAY, 'overview')}>Agent Gateway</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.HUMAN_IN_LOOP, 'what')}>Human-in-the-loop</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.RFC_INDEX, 'index')}>RFC Index</button>
            <button type="button" className="edu-bar-panel__btn" onClick={openCimd}>CIMD</button>
            <button type="button" className="edu-bar-panel__btn" onClick={openApiTraffic} title="Open API Traffic Viewer in new window">API</button>
            <button type="button" className="edu-bar-panel__btn" onClick={() => { window.dispatchEvent(new CustomEvent('agent-flow-diagram-open')); close(); }}>Agent flow diagram</button>
          </div>

          <div className="edu-bar-panel__section">
            <p className="edu-bar-panel__heading">Token flows</p>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.TOKEN_FLOW, 'diagram')}>2-Token exchange flow</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.RFC_8693, 'overview')}>RFC 8693 deep-dive</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.TOKEN_CHAIN, 'banking-app')}>Token chain education</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.FLOW_DIAGRAMS, 'overview')}>Flow diagrams</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.TRANSACTION_TOKENS, 'what-why')}>Transaction tokens (TxT)</button>
          </div>

          <div className="edu-bar-panel__section">
            <p className="edu-bar-panel__heading">MCP &amp; agents</p>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.STEP_UP, 'what')}>Step-up authentication</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.PINGONE_AUTHORIZE, 'what')}>PingOne Authorize</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.PINGGATEWAY_MCP, 'overview')}>PingOne Agent Gateway + MCP</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.ENTERPRISE_MANAGED_AUTH, 'overview')}>Enterprise-managed auth</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.WEB_MCP, 'overview')}>Web-based MCP</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.MCP_ELICITATION, 'what')}>MCP elicitation</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.AGENT_RESTRICTIONS, 'overview')}>Agent restrictions</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.INTENT_DELEGATION, 'overview')}>Intent delegation</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.ARCHITECTURE_DIAGRAM, 'context')}>Architecture diagram</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.CUA, 'what')}>Computer use agents</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.VERTICAL_SETUP, 'overview')}>Vertical setup</button>
          </div>

          <div className="edu-bar-panel__section">
            <p className="edu-bar-panel__heading">AI landscape</p>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.AI_PRIMER, 'terminology')}>AI primer</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.AGENT_FRAMEWORKS, 'overview')}>Agent frameworks (inventory)</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.LLM_LANDSCAPE, 'commercial')}>LLM landscape</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.AI_PLATFORM_LANDSCAPE, 'aws')}>AI platform landscape</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.AGENT_BUILDER_LANDSCAPE, 'langchain')}>Agent builder landscape</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.AGENTIC_MATURITY, 'overview')}>Agentic maturity model</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.LANGCHAIN, 'overview')}>LangChain</button>
          </div>

          <div className="edu-bar-panel__section">
            <p className="edu-bar-panel__heading">Security &amp; standards</p>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.SENSITIVE_DATA, 'least-data')}>Sensitive data handling</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.AUTHZEN, 'overview')}>AuthZen</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.ID_JAG, 'overview')}>ID-JAG / Cross-App Access</button>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.IETF_STANDARDS, 'overview')}>IETF standards</button>
          </div>

          <div className="edu-bar-panel__section">
            <p className="edu-bar-panel__heading">Integrations</p>
            <button type="button" className="edu-bar-panel__btn" onClick={go(EDU.GLEAN, 'overview')}>Glean + PingOne</button>
          </div>
        </div>
      )}
    </div>
  );
}
