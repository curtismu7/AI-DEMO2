import React from "react";
import SimpleStepperBar from "./SimpleStepperBar";
import StepsTabContent from "./StepsTabContent";
import { StatusChip } from "./pingUi";

// Small parts of the /dashboard frame that carry buttons or cards, moved out of UserDashboardPing2026.js unchanged
// so that file holds the frame only (banner, title band, layout, the agent host).

const openGuide = (eventName) => () => window.dispatchEvent(new CustomEvent(eventName));

/** The Simple stepper for the two layouts that have no token rail (clinical split and Focus Mode). */
export function SimpleStepperInline() {
  return (
    <section aria-label="Simple stepper" data-testid="dashboard-simple-stepper">
      <SimpleStepperBar />
      <StepsTabContent />
    </section>
  );
}

/** Height drag handle under the agent column in the middle layout. */
export function MiddleResizeHandle({ onMouseDown }) {
  return (
    <button
      type="button"
      className="ud-middle-resize-handle"
      onMouseDown={onMouseDown}
      aria-label="Drag to resize assistant height"
    >
      <span
        className="ud-middle-resize-handle__grip"
        aria-hidden="true"
      >
        <span className="ud-middle-resize-handle__bar" />
      </span>
      <span className="ud-middle-resize-handle__label">
        Resize height
      </span>
    </button>
  );
}

/** Topology / Token chain / Script shortcuts in the float layout's token rail. */
export function FloatChainActions() {
  return (
    <div className="ud-float-chain-actions">
      <button
        type="button"
        className="ud-float-chain-btn"
        title="Real-time token topology — RFC 8693 delegation chain"
        onClick={() => window.dispatchEvent(new CustomEvent('token-topology-open'))}
      >
        Topology
      </button>
      <button
        type="button"
        className="ud-float-chain-btn"
        title="Floating token chain — RFC 8693 delegation trace rail"
        onClick={() => window.dispatchEvent(new CustomEvent('floating-token-chain-open'))}
      >
        Token chain
      </button>
      <button
        type="button"
        className="ud-float-chain-btn"
        title="Open 15-Min Security Demo Script"
        onClick={() => window.dispatchEvent(new CustomEvent('demo-script-toggle'))}
      >
        Script
      </button>
    </div>
  );
}

/** The CIBA and Client ID Metadata Document guides live in app-level drawers (CIBAPanel, CimdSimPanel).
 *  Here they are cards, collapsed by default, each with a button that opens the same drawer. */
export function DashboardExplainers() {
  return (
    <div className="udp-explainers">
      <section className="pu-card udp-explainer" aria-labelledby="udp-ciba-h">
        <h2 id="udp-ciba-h" className="pu-h3">Backchannel authentication (CIBA)</h2>
        <StatusChip tone="info">Explainer</StatusChip>
        <details>
          <summary>How the step-up works</summary>
          <p className="pu-note">
            When a transfer needs stronger proof, the app asks PingOne to authenticate you out of band, for example
            with an approval on your phone, while this page waits and checks for the answer.
          </p>
          <div className="pu-actions">
            <button type="button" className="pu-btn" onClick={openGuide("education-open-ciba")}>
              Open the CIBA guide
            </button>
          </div>
        </details>
      </section>
      <section className="pu-card udp-explainer" aria-labelledby="udp-cimd-h">
        <h2 id="udp-cimd-h" className="pu-h3">Client ID Metadata Document</h2>
        <StatusChip tone="info">Explainer</StatusChip>
        <details>
          <summary>What the document is</summary>
          <p className="pu-note">
            A client ID that is a URL. The authorization server fetches the client's metadata from it instead of
            needing the client registered in advance.
          </p>
          <div className="pu-actions">
            <button type="button" className="pu-btn" onClick={openGuide("education-open-cimd")}>
              Open the Client ID Metadata Document guide
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}

/** Middle-layout open FAB — shown when middle placement hasn't been expanded yet.
 *  App.js global float is suppressed for middle so there is exactly one FAB. */
export function MiddleAgentFab({ onOpen }) {
  return (
    <button
      type="button"
      className="banking-agent-fab"
      onClick={onOpen}
      aria-label="Open AI banking assistant in middle column"
      title="Open AI Agent"
    >
      <span className="banking-agent-fab-icon">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4 10h3v7H4zM10.5 10h3v7h-3zM2 19h20v3H2zM17 10h3v7h-3zM12 1 2 6v2h20V6z" />
        </svg>
      </span>
      <span className="banking-agent-fab-label">AI Agent</span>
    </button>
  );
}
