import { useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { openSignIn, openAdminSignIn } from "../utils/signInService";
import { PingPage, SimBanner, PageFrame, Section, Card, StatusChip } from "./pingUi";
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

const FEATURES = [
  {
    Icon: IconShield,
    title: "3 Auth Flows",
    description:
      "Experience OIDC, CIBA push auth, and in-flight step-up challenges — all protecting banking operations",
  },
  {
    Icon: IconTokenExchange,
    title: "RFC 8693 Token Exchange",
    description:
      "Watch secure delegation in action: user tokens transformed to agent tokens with act claims",
  },
  {
    Icon: IconConnect,
    title: "MCP Spec Integration",
    description:
      "See how AI agents connect to banking APIs via the Model Context Protocol with full auth context",
  },
  {
    Icon: IconAgent,
    title: "AI Agent Demo",
    description:
      "Observe real-time agent operations: transfers, balance checks, transaction analysis — all secured by tokens",
  },
];

export default function LandingPage({ user }) {
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
      openAdminSignIn({ returnTo: "/admin" });
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
      openSignIn({ returnTo: "/use-cases/live" });
    }
  };

  // One primary per state (Ping UI P9): the action this visitor most likely wants next.
  //   signed out -> Use Cases (it opens sign-in, then the live use cases)
  //   customer   -> Customer Dashboard
  //   admin      -> Admin Dashboard
  const isAdmin = user?.role === "admin";
  const state = !user ? "signed-out" : isAdmin ? "admin" : "customer";
  const primary = { "signed-out": "use-cases", customer: "customer", admin: "admin" }[state];
  const stateChip = {
    "signed-out": { tone: "neutral", word: "Signed out" },
    customer: { tone: "info", word: "Signed in as customer" },
    admin: { tone: "info", word: "Signed in as admin" },
  }[state];

  return (
    <PingPage className="landing-page">
      {/* P2: states the sign-in state the app passed in, and that this page calls no API itself. */}
      <SimBanner data-testid="landing-banner">
        <StatusChip tone={stateChip.tone}>{stateChip.word}</StatusChip>{" "}
        This page makes no API calls of its own; the sign-in state comes from the app.
      </SimBanner>

      {/* Hero Section. The site header is the app's TopNav: this page adds no second one. */}
      <section className="landing-hero" aria-label="Hero section">
        <div className="landing-hero-content">
          <h1 className="landing-hero-headline">
            Secure Identity for AI-Powered Applications
          </h1>
          <p className="landing-hero-zero-trust">ZERO TRUST</p>
          <p className="landing-hero-subheadline">
            A live reference implementation of PingOne OAuth 2.0, RFC 8693
            token delegation, and MCP-secured AI agents — built for enterprise
            demos and developer exploration.
          </p>
          <div className="landing-hero-actions">
            <HeroButton
              onClick={handleAdminDashboard}
              lead={primary === "admin"}
            >
              Admin Dashboard
            </HeroButton>
            <HeroButton
              onClick={handleCustomerDashboard}
              lead={primary === "customer"}
            >
              Customer Dashboard
            </HeroButton>
            <HeroButton
              onClick={handleUseCases}
              lead={primary === "use-cases"}
            >
              Use Cases
            </HeroButton>
            <HeroButton
              onClick={() => navigate("/configure")}
              lead={primary === "setup"}
            >
              Setup
            </HeroButton>
          </div>
        </div>
      </section>

      <PageFrame>
        {/* Identity Evolution Callout */}
        <section className="landing-callout" aria-label="Identity evolution">
          <Card className="landing-callout-card">
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
            {/* Closing line adapted from the Ping brand hub boilerplate
                (brand.pingidentity.com/hub/39 → Written Guidelines → Boilerplate) */}
            <p className="landing-callout-body landing-callout-boilerplate">
              At Ping Identity, we make it possible to trust every digital
              moment — across customers, employees, partners, and non-human
              identities. With Ping, all digital experiences start with trust.
            </p>
          </Card>
        </section>

        {/* Features Section */}
        <Section
          id="landing-capabilities"
          kicker="What is inside"
          title="Core Capabilities"
          lede="See how PingOne secures every layer of an AI-powered banking application"
        >
          <ul className="pu-card-grid landing-features-grid" role="list">
            {FEATURES.map(({ Icon, title, description }) => (
              <li key={title} className="pu-card landing-feature-card">
                <div className="landing-feature-icon">
                  <Icon />
                </div>
                <h3 className="pu-h3 landing-feature-title">{title}</h3>
                <p className="landing-feature-description">{description}</p>
              </li>
            ))}
          </ul>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// One primary per view state (see LandingPage): `lead` is the Ping Red button, every other action is secondary.
function HeroButton({ lead, ...rest }) {
  return <button type="button" className={lead ? "pu-btn pu-btn--primary" : "pu-btn"} {...rest} />;
}
