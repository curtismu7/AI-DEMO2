import { useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./LandingPage.css";

function IconShield() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconTokenExchange() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function IconConnect() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function IconAgent() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      <circle cx="9" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function LandingPage({ user, hasTopNav }) {
  const navigate = useNavigate();

  // The AI Agent FAB and Demo Script launcher are global, fixed-position
  // buttons portaled to document.body; on phones they can land directly on
  // top of the hero's own CTA row (PR #2793 fixed this at 440x956 but a
  // padding-only fix can't cover every viewport height without regressing
  // another one — see TECH_DEBT.md 2026-09-05). Hide those two floats only
  // while the hero CTAs are actually on screen, so they never fight for the
  // same pixels regardless of device height.
  //
  // useLayoutEffect (not useEffect) plus a synchronous initial
  // getBoundingClientRect check, not just the observer's first callback:
  // IntersectionObserver's own initial entry fires asynchronously, which
  // left a frame where the floats were visible over the CTAs on first paint
  // (PR #2799 review).
  useLayoutEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const heroActions = document.querySelector(".landing-hero-actions");
    if (!heroActions) return undefined;

    const rect = heroActions.getBoundingClientRect();
    const initiallyInView = rect.top < window.innerHeight && rect.bottom > 0;
    document.body.classList.toggle("landing-hero-ctas-in-view", initiallyInView);

    const observer = new IntersectionObserver(
      ([entry]) => {
        document.body.classList.toggle("landing-hero-ctas-in-view", entry.isIntersecting);
      },
      { threshold: 0.1 },
    );
    observer.observe(heroActions);
    return () => {
      observer.disconnect();
      document.body.classList.remove("landing-hero-ctas-in-view");
    };
  }, []);

  const handleAdminDashboard = (e) => {
    e.preventDefault();
    if (user?.role === "admin") {
      navigate("/admin");
    } else {
      window.location.href = "/api/auth/oauth/login";
    }
  };

  const handleCustomerDashboard = (e) => {
    e.preventDefault();
    navigate("/dashboard");
  };

  const handleUseCases = (e) => {
    e.preventDefault();
    if (user) {
      navigate("/use-cases/live");
    } else {
      window.location.href = "/api/auth/oauth/user/login?return_to=/use-cases/live";
    }
  };

  return (
    <div className="landing-page" data-rd-v2>
      {/* Logged-out: white marketing header; logged-in: no top nav (sidebar + App.js TopNav handles it) */}
      {!user && !hasTopNav && (
        <header className="landing-header">
          <div className="landing-header-content">
            <div className="landing-logo">
              <p className="landing-logo-title">PingOne Identity</p>
              <p>AI-Powered Demo</p>
            </div>
            <div className="landing-header-actions">
              <button
                type="button"
                onClick={handleAdminDashboard}
                className="btn btn-primary"
              >
                Admin Dashboard
              </button>
              <button
                type="button"
                onClick={handleCustomerDashboard}
                className="btn btn-secondary"
              >
                Customer Dashboard
              </button>
              <button
                type="button"
                onClick={handleUseCases}
                className="btn btn-secondary"
              >
                Use Cases
              </button>
              <button
                type="button"
                onClick={() => navigate("/configure")}
                className="btn btn-secondary"
              >
                Setup
              </button>
            </div>
          </div>
        </header>
      )}

      <main className="landing-main">
        {/* Hero Section */}
        <section className="landing-hero" aria-label="Hero section">
          <div className="landing-hero-content">
            <h1 className="landing-hero-headline">
              Secure Identity for AI-Powered Applications
            </h1>
            <p className="landing-hero-subheadline">
              A live reference implementation of PingOne OAuth 2.0, RFC 8693
              token delegation, and MCP-secured AI agents — built for enterprise
              demos and developer exploration.
            </p>
            <div className="landing-hero-actions">
              <button
                type="button"
                onClick={handleAdminDashboard}
                className="hero-cta hero-cta-primary"
              >
                Admin Dashboard
              </button>
              <button
                type="button"
                onClick={handleCustomerDashboard}
                className="hero-cta hero-cta-secondary"
              >
                Customer Dashboard
              </button>
              <button
                type="button"
                onClick={handleUseCases}
                className="hero-cta hero-cta-secondary"
              >
                Use Cases
              </button>
              <button
                type="button"
                onClick={() => navigate("/configure")}
                className="hero-cta hero-cta-secondary"
              >
                Setup
              </button>
            </div>
          </div>
        </section>

        {/* Identity Evolution Callout */}
        <section className="landing-callout" aria-label="Identity evolution">
          <div className="landing-callout-content">
            <p className="landing-callout-lead">
              The identity stack is evolving from <em>"Who are you?"</em> to{" "}
              <em>"What is this agent authorized to do?"</em>
            </p>
            <p className="landing-callout-body">
              At Ping Identity, we're introducing new capabilities to help
              organizations govern AI agents, enable trusted access, and operate
              identity at AI speed.
            </p>
            <p className="landing-callout-body">
              No parallel identity stacks. No secret sprawl. Just a unified
              identity control plane built for the agentic enterprise.
            </p>
          </div>
        </section>

        {/* Features Section */}
        <section className="landing-features">
          <div className="landing-features-heading">
            <h2>Core Capabilities</h2>
            <p>
              See how PingOne secures every layer of an AI-powered banking
              application
            </p>
          </div>
          <ul className="landing-features-grid">
            {/* Feature 1: Auth Flows */}
            <li className="landing-feature-card">
              <div className="landing-feature-icon">
                <IconShield />
              </div>
              <h3 className="landing-feature-title">3 Auth Flows</h3>
              <p className="landing-feature-description">
                Experience OIDC, CIBA push auth, and in-flight step-up
                challenges — all protecting banking operations
              </p>
            </li>

            {/* Feature 2: RFC 8693 */}
            <li className="landing-feature-card">
              <div className="landing-feature-icon">
                <IconTokenExchange />
              </div>
              <h3 className="landing-feature-title">RFC 8693 Token Exchange</h3>
              <p className="landing-feature-description">
                Watch secure delegation in action: user tokens transformed to
                agent tokens with act claims
              </p>
            </li>

            {/* Feature 3: MCP Integration */}
            <li className="landing-feature-card">
              <div className="landing-feature-icon">
                <IconConnect />
              </div>
              <h3 className="landing-feature-title">MCP Spec Integration</h3>
              <p className="landing-feature-description">
                See how AI agents connect to banking APIs via the Model Context
                Protocol with full auth context
              </p>
            </li>

            {/* Feature 4: AI Agent */}
            <li className="landing-feature-card">
              <div className="landing-feature-icon">
                <IconAgent />
              </div>
              <h3 className="landing-feature-title">AI Agent Demo</h3>
              <p className="landing-feature-description">
                Observe real-time agent operations: transfers, balance checks,
                transaction analysis — all secured by tokens
              </p>
            </li>
          </ul>
        </section>

      </main>
    </div>
  );
}
