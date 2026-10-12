// WelcomeWizard — first-run welcome + provisioning wizard for the AI-DEMO2 demo.
//
// Two jobs in one stepped card:
//   1. Orient: what the demo is, what it can do, where the docs live.
//   2. Provision: collect a ping email + cell, call POST /api/demo/provision-wizard
//      (creates the customer user and a +admin user with forceChange temp password,
//      email+SMS MFA), show the credentials, then walk the new user through their
//      first sign-in and passkey registration.
//
// Auto-opens once per browser (demo_welcome_seen in localStorage); re-openable
// from the Learning Hub and the TopNav "Welcome" button.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDemoTour } from "../context/DemoTourContext";
import apiClient from "../services/apiClient";
import "./WelcomeWizard.css";

const STORAGE_KEY = "demo_welcome_seen";

export const WelcomeWizard = ({ open, onClose }) => {
  const { start: startTour } = useDemoTour();
  const [stepIndex, setStepIndex] = useState(0);
  const [email, setEmail] = useState("");
  const [cell, setCell] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [error, setError] = useState(null);
  // Docked mode: after the user follows an action link, the wizard shrinks to
  // a non-blocking bottom-right card (DemoTourModal geometry) so they can use
  // the linked page and pick the tour back up where they left off. The
  // seen-flag is only set on explicit close/skip/finish — following a link
  // must never lose their place.
  const [docked, setDocked] = useState(false);

  useEffect(() => {
    if (open) {
      setStepIndex(0);
      setDocked(false);
    }
  }, [open]);

  if (!open) return null;

  const markSeen = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* private mode / storage disabled — wizard just re-opens next visit */
    }
    onClose();
  };

  const finish = () => {
    markSeen();
    startTour("general");
  };

  const provision = async () => {
    setProvisioning(true);
    setError(null);
    try {
      const { data } = await apiClient.post("/api/demo/provision-wizard", { email, cell });
      setCredentials(data.credentials || null);
      if (data.errors) {
        setError(
          "Some steps failed: " +
            Object.entries(data.errors)
              .map(([k, v]) => k)
              .join(", ") +
            ". You can continue — the tour explains what to check.",
        );
      }
      setStepIndex(stepIndex + 1);
    } catch (err) {
      setError(err?.response?.data?.message || "Provisioning failed — is the backend running?");
    } finally {
      setProvisioning(false);
    }
  };

  // Step definitions. The provision step is interactive (form), so it's
  // rendered specially rather than from this list.
  const steps = [
    {
      title: "Welcome to AI-DEMO2",
      body: (
        <>
          <p>
            This is a working demo of governed AI agents in the enterprise. A user chats with
            an AI agent that takes real actions on their behalf — and every action the agent
            takes is authenticated, authorized, and auditable end to end.
          </p>
        </>
      ),
    },
    {
      title: "What it can do",
      body: (
        <ul className="ww-list">
          <li>Chat with an AI agent that executes real actions on your behalf</li>
          <li>Watch A2A delegation — token exchange with act claims proves who the agent acts for at every hop</li>
          <li>Approve sensitive actions out of band — HITL consent and CIBA</li>
          <li>See Agent Privilege policy decisions on every MCP tool call, with full observability across each run</li>
          <li>Switch verticals — banking, healthcare, retail, workforce — and re-skin the demo</li>
        </ul>
      ),
      action: { label: "Browse all use cases", route: "/use-cases" },
    },
    {
      title: "Set up your demo accounts",
      body: null, // rendered specially below
    },
    {
      title: "Your credentials",
      body: credentials ? (
        <>
          <p>Save these — the temp password must be changed at first sign-in.</p>
          <div className="ww-creds">
            <div className="ww-cred-row"><span>Customer</span><code>{credentials.customerUsername}</code></div>
            <div className="ww-cred-row"><span>Admin</span><code>{credentials.adminUsername}</code></div>
            <div className="ww-cred-row"><span>Temp password</span><code>{credentials.password}</code></div>
          </div>
        </>
      ) : (
        <p>Provisioning was skipped — you can still take the tour.</p>
      ),
    },
    {
      title: "Sign in & register a passkey",
      body: (
        <p>
          Sign in as your new customer user (the pi.flow modal opens when you click below).
          After the password change you'll land on the dashboard — open your profile menu and
          choose <strong>Security</strong> to register a passkey. Email and SMS MFA are
          already enrolled to the contact details you gave.
        </p>
      ),
      action: { label: "Sign in now", route: "/" },
    },
    {
      title: "Docs & guides",
      body: (
        <p>
          The <strong>Learning Hub</strong> has in-app lessons, this tour, the full guided
          demo tour, and the AI Security Academy. Every page also has a <strong>Guide</strong>{" "}
          button with a walkthrough of just that page.
        </p>
      ),
      action: { label: "Open the Learning Hub", route: "/learning" },
    },
    {
      title: "You're ready",
      body: (
        <p>
          Best next step: take the guided demo tour — it walks the full story from customer
          login to delegated agent actions. Or pick a scenario from the{" "}
          <strong>Use Cases</strong> menu.
        </p>
      ),
    },
  ];

  const isProvisionStep = stepIndex === 2;
  const total = steps.length;
  const current = steps[stepIndex];
  const progress = ((stepIndex + 1) / total) * 100;

  if (docked) {
    return (
      <div className="ww-docked" role="dialog" aria-label="Welcome wizard">
        <div className="ww-card ww-card-docked">
          <div className="ww-progress"><div className="ww-progress-bar" style={{ width: `${progress}%` }} /></div>
          <div className="ww-body">
            <h2 className="ww-title">{current.title}</h2>
            <div className="ww-text ww-text-clamp">{current.body}</div>
          </div>
          <div className="ww-footer">
            <button
              type="button"
              className="ww-btn ww-btn-secondary"
              onClick={() => (stepIndex === 0 ? markSeen() : setStepIndex(stepIndex - 1))}
            >
              {stepIndex === 0 ? "Skip" : "‹ Back"}
            </button>
            <div className="ww-dots" aria-hidden="true">
              {steps.map((_, i) => (
                <span key={i} className={`ww-dot${i === stepIndex ? " ww-dot-active" : ""}`} />
              ))}
            </div>
            <button
              type="button"
              className="ww-btn ww-btn-primary"
              aria-label="Expand welcome wizard"
              onClick={() => setDocked(false)}
            >
              ⤢ Expand
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ww-backdrop" role="dialog" aria-modal="true" aria-label="Welcome wizard">
      <div className="ww-card">
        <div className="ww-progress"><div className="ww-progress-bar" style={{ width: `${progress}%` }} /></div>
        <button type="button" className="ww-close" aria-label="Close welcome wizard" onClick={markSeen}>✕</button>

        <div className="ww-body">
          <h2 className="ww-title">{current.title}</h2>
          {isProvisionStep ? (
            <>
              <p className="ww-text">
                Give us your ping email and cell — we'll create your customer account and an
                admin account, enroll email + SMS MFA, and hand you a temp password.
              </p>
              <label className="ww-label" htmlFor="ww-email">Ping email</label>
              <input
                id="ww-email"
                className="ww-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@pingidentity.com"
                autoComplete="email"
              />
              <label className="ww-label" htmlFor="ww-cell">Cell</label>
              <input
                id="ww-cell"
                className="ww-input"
                type="tel"
                value={cell}
                onChange={(e) => setCell(e.target.value)}
                placeholder="+1 206 555 0123"
                autoComplete="tel"
              />
              {error && <p className="ww-error">{error}</p>}
              <button
                type="button"
                className="ww-btn ww-btn-primary"
                disabled={provisioning || !email.includes("@") || cell.length < 7}
                onClick={provision}
              >
                {provisioning ? "Setting up…" : "Set up my accounts"}
              </button>
              <button type="button" className="ww-skip-link" onClick={() => setStepIndex(stepIndex + 1)}>
                Skip — provision later
              </button>
            </>
          ) : (
            <>
              <div className="ww-text">{current.body}</div>
              {current.action && (
                <Link
                  to={current.action.route}
                  className="ww-action-btn"
                  onClick={() => setDocked(true)}
                >
                  {current.action.label} →
                </Link>
              )}
            </>
          )}
        </div>

        <div className="ww-footer">
          <button
            type="button"
            className="ww-btn ww-btn-secondary"
            onClick={() => (stepIndex === 0 ? markSeen() : setStepIndex(stepIndex - 1))}
          >
            {stepIndex === 0 ? "Skip" : "‹ Back"}
          </button>
          <div className="ww-dots" aria-hidden="true">
            {steps.map((_, i) => (
              <span key={i} className={`ww-dot${i === stepIndex ? " ww-dot-active" : ""}`} />
            ))}
          </div>
          {stepIndex < total - 1 ? (
            <button
              type="button"
              className="ww-btn ww-btn-primary"
              disabled={isProvisionStep && !credentials}
              onClick={() => setStepIndex(stepIndex + 1)}
            >
              Next ›
            </button>
          ) : (
            <button type="button" className="ww-btn ww-btn-primary" onClick={finish}>
              Take the guided tour
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default WelcomeWizard;
