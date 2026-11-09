// demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx
//
// /demo/enterprise-mcp (and /pingfederate-id-jag/demo, the same component) — run the MCP
// Enterprise-Managed Authorization demo.
//
// Honesty: two run modes, and the wording below follows the one in use (runMode state). "Run live ID-JAG
// demo" is real: with no PingFederate session it signs the user out and takes a PingFederate login, with one
// it reuses that session (useAuth decides, not this page), then runs UC40; the Token chain holds the claims
// that run recorded. "Run mock demo" is simulated: sample steps and sample claims, no login, no request.
// Before either is pressed nothing has run. The 19-call walkthrough is a fixed reading of the architecture,
// not a trace; only the calls a run recorded show claims. This page never checks the outcome of a live run,
// so no chip here is green: it says what was requested, not what happened. A request that failed to start,
// or a run that finished, clears the run state (the id-jag-run-cleared event); the live wording then drops
// to "ended" instead of still claiming a sign-out is under way.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md)
// through the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first (role=note),
// P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons. P9 "one primary per view": "Run live ID-JAG demo" is the
// primary in every state (nothing run, live requested, mock replay, a recovery notice), because it is the one
// action that advances the demo to the real thing and is what the recovery notice tells the user to press
// again. "Run mock demo", the explainers, the theme switch, the call player and the filmstrip are secondaries.
// The inline "sign in as admin" in the recovery notice is a text link, not a button-sized control.
// Skipped: P6 (no inspector layout) and P8 (the call player and filmstrip are existing diagram components;
// they keep their own geometry, only their button fills are neutralised in the page sheet), and the standalone
// P1 shell bar (the app has its shell).

import { useCallback, useEffect, useState } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from "../components/pingUi";
import IdJagPathBar from "../components/IdJagPathBar";
import { diagramLinkProps } from "../utils/diagramLinks";
import IdJagCallPlayer from "../components/IdJagCallPlayer";
import TokenChainFilmstrip from "../components/TokenChainFilmstrip";
import { EDU } from "../components/education/educationIds";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { useThemeOptional } from "../context/ThemeContext";
import { requestLiveIdJagRun, requestMockIdJagReplay, RUN_MODES } from "../utils/idJagRunMode";
import { openAdminSignIn } from "../utils/signInService";
import "./EnterpriseMcpDemoPage.css";

const DEMO_CHIP = "show my balance";
// Local view state: a live request that has since been cleared (it failed to start, or it finished).
const LIVE_ENDED = "live-ended";

export default function EnterpriseMcpDemoPage() {
  // The learning-path links need a Router; the page is also rendered bare in unit tests.
  const inRouter = useInRouterContext();
  const [runMode, setRunMode] = useState(null);
  const [failureCode, setFailureCode] = useState(() => {
    if (typeof window === "undefined") return null;
    const code = new URLSearchParams(window.location.search).get("error");
    return FAILURE_MESSAGES[code] ? code : null;
  });
  useEffect(() => {
    const onProviderRequired = (event) => {
      setRunMode(null);
      setFailureCode(FAILURE_MESSAGES[event.detail?.code] ? event.detail.code : "id_jag_provider_required");
    };
    // The launcher clears the run state when a live start fails (BFF/PingFederate error, blocked launch) and
    // when a run completes. This page cannot tell which, so it stops claiming a sign-out is under way.
    const onRunCleared = () => setRunMode((mode) => (mode === RUN_MODES.LIVE_ID_JAG ? LIVE_ENDED : mode));
    window.addEventListener("id-jag-provider-required", onProviderRequired);
    window.addEventListener("id-jag-run-cleared", onRunCleared);
    return () => {
      window.removeEventListener("id-jag-provider-required", onProviderRequired);
      window.removeEventListener("id-jag-run-cleared", onRunCleared);
    };
  }, []);
  // Optional variant on purpose: useEducationUI() THROWS outside its provider,
  // which would take the whole page down anywhere the provider is absent. Null
  // here simply hides the explainer buttons rather than shipping dead controls.
  const edu = useEducationUIOptional();
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const handleLiveRun = useCallback(() => {
    setFailureCode(null);
    const intent = requestLiveIdJagRun({
      mode: RUN_MODES.LIVE_ID_JAG,
      message: DEMO_CHIP,
      returnTo: "/pingfederate-id-jag/demo",
    });
    if (intent) {
      setRunMode(RUN_MODES.LIVE_ID_JAG);
    }
  }, []);
  const handleMockRun = useCallback(() => {
    // A live-start failure notice is about the live run; it must not sit beside a mock replay banner.
    setFailureCode(null);
    requestMockIdJagReplay();
    setRunMode(RUN_MODES.MOCK_ID_JAG);
  }, []);

  const running = runMode === RUN_MODES.LIVE_ID_JAG ? "live"
    : runMode === RUN_MODES.MOCK_ID_JAG ? "mock"
      : runMode === LIVE_ENDED ? "ended" : "idle";
  const statusText = {
    live: "Live PF ID-JAG requested — the agent runs after PingFederate sign-in (or straight away if you already have a PingFederate session).",
    mock: "Mock replay — no login or live tokens",
    ended: "Live PF ID-JAG request ended — see the Token chain for what it recorded.",
    idle: "",
  }[running];

  return (
    <PingPage className="emd-page">
      <SimBanner data-testid="emd-banner">
        {running === "idle" && (
          <>
            <strong>NOTHING HAS RUN YET</strong> — <strong>Run live ID-JAG demo</strong> is real: it asks for a PingFederate
            login (signing you out first unless you already have a PingFederate session), then runs the agent.
            <strong>Run mock demo</strong> is simulated: sample steps and sample claims, no login, no request. The 19-call walkthrough is a fixed reading of the architecture, not a
            trace; only the calls a run recorded show claims.
          </>
        )}
        {running === "live" && (
          <>
            <strong>LIVE RUN REQUESTED</strong> — real: unless you already have a PingFederate session you are signed
            out and sent to PingFederate to log in, then the agent runs. This page does not check that it started or
            how it ended; the Token chain below shows what the run records. The 19-call walkthrough is still a fixed
            reading of the architecture, not a trace.
          </>
        )}
        {running === "ended" && (
          <>
            <strong>LIVE RUN ENDED</strong> — a real run was requested and has since finished or stopped. This page
            does not check which: if a notification said it could not start, nothing ran; otherwise the Token chain
            below shows what it recorded. The 19-call walkthrough is a fixed reading of the architecture, not a trace.
          </>
        )}
        {running === "mock" && (
          <>
            <strong>MOCK REPLAY</strong> — simulated: the steps and claims in the Token chain are samples, and the
            replay made no login and no request. Nothing here came from a real run. The 19-call walkthrough is a fixed
            reading of the architecture, not a trace.
          </>
        )}
      </SimBanner>
      <PageHeader
        eyebrow="ID-JAG · Enterprise-managed MCP access"
        title="Enterprise-Managed MCP Authorization"
        summary={(
          <>
            IT decides centrally which employees reach which MCP servers. The identity provider
            evaluates policy and signs an <strong>ID-JAG</strong>; the MCP authorization server
            redeems it for an access token. No per-server consent screen, and no token at all for
            an employee who is not entitled.
          </>
        )}
        actions={(
          <button
            type="button"
            onClick={toggleDarkMode}
            className="pu-btn"
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            {darkMode ? "Light mode" : "Dark mode"}
          </button>
        )}
      />
      <PageFrame>
        {inRouter && typeof window !== "undefined" && window.location.pathname.startsWith("/pingfederate-id-jag") && (
          <IdJagPathBar current="run" />
        )}

        <Section id="emd-flow-h" kicker="1 · The flow" title="What you are about to see">
          <Card>
            <ol className="emd-steps">
              <li><strong>Policy at the IdP.</strong> Group membership is checked <em>before</em> anything is minted.</li>
              <li><strong>ID-JAG issued.</strong> A signed, single-use grant naming this user, this MCP server, these scopes, and the client it is for.</li>
              <li><strong>ID-JAG redeemed.</strong> The MCP authorization server verifies it against the IdP JWKS and issues its own token. The ID-JAG goes no further.</li>
              <li><strong>The gateway checks that token.</strong> It verifies the signature, applies policy, and forwards it to the MCP server.</li>
              <li><strong>The MCP server runs the tool.</strong> It calls the BFF banking API with the same token. No redirect to an MCP authorize endpoint anywhere in the flow.</li>
            </ol>
            {inRouter && (
              <p className="pu-note">
                After a run, <Link to="/pingfederate-id-jag/implementation" {...diagramLinkProps("/pingfederate-id-jag/implementation")}>See how we built it</Link> shows the real
                claims from your last run next to each step.
              </p>
            )}
            {edu?.open && (
              <div className="pu-actions">
                <button type="button" className="pu-btn" onClick={() => edu.open(EDU.ENTERPRISE_MANAGED_AUTH, "overview")}>
                  Enterprise-Managed Auth: full explainer
                </button>
                <button type="button" className="pu-btn" onClick={() => edu.open(EDU.ID_JAG, "how-it-works")}>
                  ID-JAG / Cross-App Access: the grant itself
                </button>
              </div>
            )}
          </Card>
        </Section>

        <Section id="emd-run-h" kicker="2 · Choose a run" title="Run it" lede="Pick one. The live run is real and needs PingFederate; the mock replay is a rehearsal that works signed out.">
          <CardGrid>
            <Card title="Live ID-JAG run" tone="live">
              <p className="pu-status-line"><StatusChip tone="info">Real run</StatusChip>Needs a PingFederate login.</p>
              <KvList
                items={[
                  { label: "Your session", value: "Signed out first, unless you already have a PingFederate session" },
                  { label: "Login", value: "PingFederate" },
                  { label: "Agent prompt", value: `“${DEMO_CHIP}” (UC40)` },
                  { label: "Tokens", value: "Real; claims appear in the Token chain" },
                ]}
              />
              <div className="pu-actions">
                <button type="button" className="pu-btn pu-btn--primary" onClick={handleLiveRun}>
                  Run live ID-JAG demo
                </button>
              </div>
            </Card>
            <Card title="Mock replay" tone="neutral">
              <p className="pu-status-line"><StatusChip tone="neutral">Simulated</StatusChip>Sample steps, shown immediately.</p>
              <KvList
                items={[
                  { label: "Your session", value: "Untouched; works signed out" },
                  { label: "Login", value: "None" },
                  { label: "Agent prompt", value: "None sent" },
                  { label: "Tokens", value: "Samples, labelled mock; no request is made" },
                ]}
              />
              <div className="pu-actions">
                <button type="button" className="pu-btn" onClick={handleMockRun}>
                  Run mock demo
                </button>
              </div>
            </Card>
          </CardGrid>
          {failureCode && (
            <Card tone="warn" className="emd-prerequisite" role="alert">
              <p className="pu-status-line"><StatusChip tone="warn">Action needed</StatusChip></p>
              <p className="emd-prerequisite__text">{FAILURE_MESSAGES[failureCode]}</p>
            </Card>
          )}
          {/* The role=status span is mounted from the first render and only its text changes, so assistive
              technology announces each change; a region inserted together with its text is often missed. */}
          <p className={`pu-status-line emd-run-status${running === "idle" ? " emd-run-status--idle" : ""}`}>
            {running === "live" && <StatusChip tone="info">Live requested</StatusChip>}
            {running === "mock" && <StatusChip tone="neutral">Simulated</StatusChip>}
            {running === "ended" && <StatusChip tone="neutral">Live run ended</StatusChip>}
            <span role="status">{statusText}</span>
          </p>
        </Section>

        <Section id="emd-calls-h" kicker="3 · Every call" title="Every call, in order">
          <Card tone="neutral">
            <p className="pu-note">
              All 19 calls from sign-in to the banking API. Pick the movie reel or the sequence diagram; Simulate steps
              through them, and the calls that a run records show their real claims.
            </p>
            <IdJagCallPlayer />
          </Card>
        </Section>

        <Section id="emd-chain-h" kicker="4 · The record" title="What the run recorded">
          <Card tone="neutral" className="emd-film">
            <p className="pu-note">
              The Token chain is the live record of your run. Watch for <code>ID-JAG issued</code> and <code>ID-JAG redeemed</code> in the trace.
              Mock replay shows sample steps; an ordinary exchange is labeled as a stand-in.
            </p>
            <TokenChainFilmstrip />
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// One message per failure code from the BFF / launcher: each says what actually went wrong.
// Declared below the page on purpose: the pattern check reads the file top to bottom and the sign-in
// button inside the first message would otherwise come "before the banner". Used only at render time.
const FAILURE_MESSAGES = {
  id_jag_provider_required: (
    <>
      <strong>PingOne is selected.</strong> Live ID-JAG requires PingFederate.
      Select PF with the top-bar P1/PF switch, then run the demo again.
      If the switch requires admin access, <button type="button" className="emd-admin-signin" onClick={() => openAdminSignIn({ returnTo: "/pingfederate-id-jag/demo" })}>sign in as admin</button> first.
    </>
  ),
  id_jag_provider_mismatch: (
    <>
      <strong>You are signed in with PingFederate, but the shared login provider is set to PingOne.</strong>{" "}
      Select PF with the top-bar P1/PF switch (needs an admin), then run the demo again.
    </>
  ),
  id_jag_intent_lost: (
    <>
      <strong>The sign-in handoff was lost</strong> (it timed out or the server restarted mid-run).
      PingFederate is still selected; run the demo again.
    </>
  ),
  id_jag_return_mismatch: (
    <>
      <strong>The sign-in returned to a different page than the one that started the run.</strong>{" "}
      Run the demo again from this page.
    </>
  ),
};
