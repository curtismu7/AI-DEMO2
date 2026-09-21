import { useState } from "react";
import "./SpiffePingoneBridgePage.css";
import { runSpiffeBridgeSimulation } from "../services/tokenChainTrace/spiffeBridgeSimulation";

const HANDOFF_STEPS = [
  {
    number: "01",
    title: "Workload presents an SVID",
    detail: "A SPIFFE workload identity arrives as a signed JWT-SVID.",
    state: "simulated",
  },
  {
    number: "02",
    title: "Bridge verifies identity",
    detail: "The bridge checks issuer, audience, expiry, and SPIFFE trust-domain claims.",
    state: "simulated",
  },
  {
    number: "03",
    title: "SPIFFE ID maps to a client",
    detail: "An explicit allow-list maps the workload URI to one PingOne client ID.",
    state: "real",
  },
  {
    number: "04",
    title: "PingOne receives private_key_jwt",
    detail: "The bridge signs a short-lived assertion with its configured RSA key.",
    state: "real",
  },
];

const CONFIG_LINES = [
  ["FF_SPIFFE_PINGONE_BRIDGE", "true"],
  ["SPIFFE_PINGONE_CLIENT_MAP", "spiffe://demo.local/ns/orders/sa/worker → client-id"],
  ["SPIFFE_BRIDGE_PRIVATE_KEY", "<redacted RSA private key>"],
  ["SPIFFE_BRIDGE_KID", "bridge-key-01"],
];

function StatusPill({ children, tone = "neutral" }) {
  return <span className={`spiffe-bridge__pill spiffe-bridge__pill--${tone}`}>{children}</span>;
}

export default function SpiffePingoneBridgePage() {
  const [isRunning, setIsRunning] = useState(false);
  const [simulationStatus, setSimulationStatus] = useState("ready");

  const openAgentSurface = (surface) => {
    window.dispatchEvent(new CustomEvent("banking-agent-open"));
    if (surface === "sequence") {
      window.dispatchEvent(new CustomEvent("agent-filmstrip-toggle", {
        detail: { on: false, surface: "none" },
      }));
      window.dispatchEvent(new CustomEvent("agent-sequence-diagram-toggle", {
        detail: { on: true, surface: "both" },
      }));
    } else {
      window.dispatchEvent(new CustomEvent("agent-sequence-diagram-toggle", {
        detail: { on: false, surface: "none" },
      }));
      window.dispatchEvent(new CustomEvent("agent-filmstrip-toggle", {
        detail: { on: true, surface: "both" },
      }));
    }
  };

  const runSimulation = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setSimulationStatus("running");
    openAgentSurface("movie-reel");
    try {
      await runSpiffeBridgeSimulation();
      setSimulationStatus("complete");
    } catch {
      setSimulationStatus("error");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="spiffe-bridge">
      <header className="spiffe-bridge__hero">
        <div className="spiffe-bridge__hero-copy">
          <p className="spiffe-bridge__eyebrow">Identity handoff / implementation preview</p>
          <h1>SPIFFE → PingOne Bridge</h1>
          <p className="spiffe-bridge__lede">
            Translate a workload identity into a PingOne-compatible client assertion
            without pretending PingOne understands SPIFFE directly.
          </p>
        </div>
        <StatusPill tone="todo">TODO / simulated</StatusPill>
      </header>

      <section className="spiffe-bridge__demo-controls" aria-labelledby="spiffe-bridge-demo-title">
        <div>
          <p className="spiffe-bridge__kicker">Interactive demo</p>
          <h2 id="spiffe-bridge-demo-title">Watch the bridge handoff in the agent</h2>
          <p>Everything here is local simulation. No SPIRE workload API or PingOne tenant is contacted.</p>
        </div>
        <div className="spiffe-bridge__demo-actions">
          <button type="button" className="spiffe-bridge__button spiffe-bridge__button--primary" onClick={runSimulation} disabled={isRunning}>
            {isRunning ? "Running simulated bridge…" : "Run simulated bridge"}
          </button>
          <button type="button" className="spiffe-bridge__button" onClick={() => openAgentSurface("movie-reel")}>
            Open movie reel
          </button>
          <button type="button" className="spiffe-bridge__button" onClick={() => openAgentSurface("sequence")}>
            Show sequence view
          </button>
        </div>
        <span className="spiffe-bridge__demo-status" role="status">Simulation status: {simulationStatus}</span>
      </section>

      <section className="spiffe-bridge__handoff" aria-labelledby="spiffe-bridge-flow-title">
        <div className="spiffe-bridge__section-heading">
          <div>
            <p className="spiffe-bridge__kicker">The handoff</p>
            <h2 id="spiffe-bridge-flow-title">One identity, two trust systems</h2>
          </div>
          <p>SPIFFE proves who the workload is. PingOne authorizes the client assertion.</p>
        </div>
        <div className="spiffe-bridge__flow">
          {HANDOFF_STEPS.map((step, index) => (
            <div className="spiffe-bridge__flow-item" key={step.number}>
              <article className={`spiffe-bridge__step spiffe-bridge__step--${step.state}`}>
                <span className="spiffe-bridge__step-number">{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </div>
                <StatusPill tone={step.state}>{step.state}</StatusPill>
              </article>
              {index < HANDOFF_STEPS.length - 1 && <span className="spiffe-bridge__connector" aria-hidden="true">→</span>}
            </div>
          ))}
          <div className="spiffe-bridge__destination">
            <span>Token endpoint</span>
            <strong>PingOne</strong>
            <code>grant_type=client_credentials</code>
          </div>
        </div>
      </section>

      <div className="spiffe-bridge__lower-grid">
        <section className="spiffe-bridge__panel" aria-labelledby="spiffe-bridge-now-title">
          <div className="spiffe-bridge__panel-title">
            <h2 id="spiffe-bridge-now-title">What is here now</h2>
            <StatusPill tone="real">Implemented</StatusPill>
          </div>
          <ul className="spiffe-bridge__checklist">
            <li>Explicit SPIFFE ID to PingOne client mapping</li>
            <li>Fail-closed behavior for unknown or unmapped identities</li>
            <li>Separate bridge signing key and key ID for private_key_jwt</li>
            <li>Opt-in feature flag so the existing flow stays unchanged</li>
          </ul>
        </section>

        <section className="spiffe-bridge__panel spiffe-bridge__panel--todo" aria-labelledby="spiffe-bridge-next-title">
          <div className="spiffe-bridge__panel-title">
            <h2 id="spiffe-bridge-next-title">What remains</h2>
            <StatusPill tone="todo">TODO</StatusPill>
          </div>
          <ul className="spiffe-bridge__checklist">
            <li>Live SPIRE verification and workload API connectivity</li>
            <li>JWKS publication and signing-key rotation</li>
            <li>PingOne tenant validation with a real client registration</li>
          </ul>
        </section>
      </div>

      <section className="spiffe-bridge__config" aria-labelledby="spiffe-bridge-config-title">
        <div className="spiffe-bridge__section-heading">
          <div>
            <p className="spiffe-bridge__kicker">Configuration shape</p>
            <h2 id="spiffe-bridge-config-title">The boundary is explicit</h2>
          </div>
          <p>Values are illustrative. Secrets never belong in this page or in source control.</p>
        </div>
        <div className="spiffe-bridge__config-window" role="group" aria-label="SPIFFE bridge configuration preview">
          <div className="spiffe-bridge__window-bar"><span /><span /><span /><code>.env / bridge</code></div>
          {CONFIG_LINES.map(([name, value]) => (
            <div className="spiffe-bridge__config-line" key={name}>
              <code className="spiffe-bridge__config-name">{name}</code>
              <code>{value}</code>
            </div>
          ))}
        </div>
      </section>

      <footer className="spiffe-bridge__footer">
        <span className="spiffe-bridge__footer-mark">Bridge posture</span>
        <strong>Safe to demo, not ready to call live.</strong>
        <span>Until SPIRE and PingOne are both connected, unknown identities remain denied.</span>
      </footer>
    </div>
  );
}
