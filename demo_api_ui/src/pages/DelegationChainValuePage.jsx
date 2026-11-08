// /delegation-chain-value: two real agent runs that prove the value of a delegation chain (accountability, then an
// actor-aware authorization decision), with the token-chain evidence shown under them.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through the shared
// primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons.
// Skipped: P1 (the app has its own shell), P6 (no list-and-detail inspector: two scenario cards and a rail) and P8 (the diagram
// is the shared EmbeddedFlowDiagram, and the evidence is the shared TokenChainTraceRail, neither is page boxes).
//
// P9, one primary per view state. The primary is the one action that advances the demo:
//   - nothing run yet: "Run" on Accountability;
//   - Accountability done (or failed, so retry it): the first scenario that is not done is the primary, so after
//     Accountability that is "Run" on Authorization;
//   - both done: "Run again" on Accountability stays the primary (the demo starts over there);
//   - a run in flight: its button is the primary and shows "Running..." (aria-disabled, so focus stays on it).
// "Clear" and the light/dark toggle are always secondaries. The shared diagram's own Simulate / Reset buttons and the
// token-chain rail's controls are not part of this page's markup; their look is owned by shared files (see the PR).
import React, { useCallback, useState } from "react";
import apiClient from "../services/apiClient";
import { sendAgentMessage } from "../services/demoAgentService";
import TokenChainTraceRail from "../components/TokenChainTraceRail";
import { requiredFlagsForUseCase } from "../utils/requiredDemoFlags";
import { useThemeOptional } from "../context/ThemeContext";
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import {
  DELEGATION_CHAIN_EDGES, DELEGATION_CHAIN_GROUPS, DELEGATION_CHAIN_NODES, DELEGATION_CHAIN_STEPS,
} from "../config/delegationChainValueDiagram";
import "./DelegationChainValuePage.css";

const VERTICAL = "sporting-goods";

/**
 * The two halves of the delegation-chain value proposition, each backed by a
 * real agent run rather than prose: UC2 (accountability) and UC2.6
 * (authorization). Trigger phrases are the catalog's own — the page dispatches
 * them through the same /api/agent/invoke path a chip click uses.
 */
const RUNS = [
  {
    key: "accountability",
    heading: "Accountability — the audit trail",
    body:
      "Every hop in a multi-agent delegation is recorded as a nested act claim bound to the user. " +
      "This run delegates to a specialist agent and mints a real, governed token — the full chain " +
      "(who acted, on whose behalf) is attributable end to end.",
    prompt: "hand off to a specialist",
    primaryTool: "sensitive_holdings",
    actor: "Registered specialist agent",
  },
  {
    key: "authorization",
    heading: "Authorization — the actor-aware decision",
    body:
      "A resource server can evaluate not just what the user can do, but whether THIS agent may act " +
      "for them. This run repeats the same governed delegation, then probes the same policy decision " +
      "with an unregistered agent identity in place of the real one — same user, same shape, and the " +
      "expected outcome is a denial. Read the decision in the evidence below, not in the reply sentence.",
    prompt: "simulate an agent identity mismatch",
    primaryTool: "sensitive_holdings",
    actor: "Unregistered agent (made up for the probe)",
  },
];

// The word is always shown; the tone only adds colour to it (P7). A completed run is "Reply received" in the info
// tone, never green: the page cannot tell from the reply sentence whether the agent allowed or refused the call
// (a refusal such as "a2a_unauthorized" also comes back as a reply), so success colouring would be a false verdict.
const RUN_CHIP = {
  idle: { tone: "neutral", word: "Not run" },
  running: { tone: "info", word: "Running" },
  done: { tone: "info", word: "Reply received" },
  empty: { tone: "warn", word: "No reply" },
  error: { tone: "danger", word: "Failed" },
};
const CARD_TONE = { idle: undefined, running: "live", done: "live", empty: "warn", error: "danger" };

function runView(status, result) {
  if (status === "running") return "running";
  if (status === "error") return "error";
  if (status === "done") return result?.reply ? "done" : "empty";
  return "idle";
}

export default function DelegationChainValuePage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [status, setStatus] = useState({});
  const [results, setResults] = useState({});
  const [lastPrompt, setLastPrompt] = useState(null);

  const run = useCallback(async (entry) => {
    setStatus((s) => ({ ...s, [entry.key]: "running" }));
    try {
      // A2A delegation itself is always on; only the MCP gateway runtime flags
      // still need arming for the tool dispatch to succeed.
      const flags = requiredFlagsForUseCase({
        useCaseId: null,
        primaryTool: entry.primaryTool,
        maturity: "works",
      });
      if (flags.length) {
        const updates = Object.fromEntries(flags.map((f) => [f, true]));
        // _noAuthBanner: arming is best effort on an admin-gated route, so its
        // 401 says nothing about the session — without this it raises the global
        // re-auth banner over a run that may have succeeded.
        await apiClient
          .patch("/api/admin/feature-flags", { updates }, { _noAuthBanner: true })
          .catch(() => {});
      }
      // sendAgentMessage hits the same /api/agent/invoke endpoint but ALSO
      // drives tokenChainTraceStore (beginTrace + ingestLegacyRunTrace on the
      // response), which is what feeds the rail below. The page's pitch is the
      // per-hop act chain — showing it is the point of running anything here.
      const res = await sendAgentMessage(entry.prompt, null, {
        forceHeuristic: true,
        vertical: VERTICAL,
      });
      setLastPrompt(entry.prompt);
      setResults((r) => ({
        ...r,
        [entry.key]: { reply: res?.reply || "", tools: res?.toolsCalled || [] },
      }));
      setStatus((s) => ({ ...s, [entry.key]: "done" }));
    } catch (err) {
      setStatus((s) => ({ ...s, [entry.key]: "error" }));
      setResults((r) => ({ ...r, [entry.key]: { error: err.message } }));
    }
  }, []);

  const handleClearAll = useCallback(() => {
    setStatus({});
    setResults({});
    setLastPrompt(null);
  }, []);

  const hasResults = Object.keys(results).length > 0;
  // P9: the first scenario that has not completed is the one primary; once both are done it is the first again.
  const primaryKey = (RUNS.find((e) => status[e.key] !== "done") || RUNS[0]).key;

  return (
    <PingPage className="dcv-page">
      <SimBanner data-testid="dcv-banner">
        <strong>REAL RUNS, DRAWN DIAGRAM</strong> — Real: each Run button sends its prompt to this app&apos;s
        /api/agent/invoke (a keyword-matched agent, no LLM), and the evidence panel shows the token claims that
        run returned. Before a run it tries to switch on the MCP gateway feature flags the tool call needs
        (admin access only, skipped without it). Not real: the diagram is a drawing, its Simulate button only
        animates it, and its token values are MOCK teaching values. In the identity-mismatch scenario the
        unregistered agent is made up for the probe and no token is minted for it.
      </SimBanner>
      <PageHeader
        eyebrow="WHY THIS DEMO EXISTS"
        title="Prove who acted, and who authorized it"
        summary={<>Delegated agents create a trust gap: a user may authorize one agent, while a different
          specialist or tool performs the action. This page makes that gap visible. Each scenario
          runs through the live token-exchange and authorization path, then shows the evidence in
          the token-chain panel.</>}
        actions={(
          <button
            type="button"
            onClick={toggleDarkMode}
            className="pu-btn"
            data-testid="dcv-theme-toggle"
            title="Switch this page between light and dark"
          >
            {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
          </button>
        )}
      />
      <PageFrame>
        <Section id="dcv-flow-h" kicker="1 · The flow" title="How a delegated call travels">
          <EmbeddedFlowDiagram
            testId="dcv-chain-diagram"
            title="What the two runs do"
            ariaLabel="Delegation chain diagram"
            diagramLabel="Generalist to specialist delegation with token exchanges, and the identity-mismatch probe"
            lede="Both runs go through /api/agent/invoke. The first delegates across two agents with nested act claims; the second probes the same policy decision with an unregistered agent."
            config={{ GROUPS: DELEGATION_CHAIN_GROUPS, NODES: DELEGATION_CHAIN_NODES, EDGES: DELEGATION_CHAIN_EDGES, STEPS: DELEGATION_CHAIN_STEPS }}
            pingStyle
          />
        </Section>

        <Section id="dcv-run-h" kicker="2 · Run it" title="Run the two scenarios" lede="Run Accountability first, then Authorization. Each run replaces the evidence below.">
          <CardGrid>
            {RUNS.map((entry) => {
              const view = runView(status[entry.key], results[entry.key]);
              const chip = RUN_CHIP[view];
              const busy = view === "running";
              const label = busy ? "Running..." : view === "done" || view === "empty" ? "Run again" : "Run";
              const result = results[entry.key];
              const items = [
                { label: "Prompt", value: entry.prompt, mono: true },
                { label: "Acting as", value: entry.actor },
                { label: "Tool", value: entry.primaryTool, mono: true },
              ];
              if (result?.tools) items.push({ label: "Tools called", value: result.tools.length ? result.tools.join(", ") : "none", mono: true });
              return (
                <Card key={entry.key} title={entry.heading} tone={CARD_TONE[view]} data-testid={`dcv-run-${entry.key}`} data-state={view}>
                  <p className="pu-status-line"><StatusChip tone={chip.tone}>{chip.word}</StatusChip></p>
                  <p className="pu-note">{entry.body}</p>
                  <KvList items={items} />
                  <div className="pu-actions">
                    <button
                      type="button"
                      className={primaryKey === entry.key ? "pu-btn pu-btn--primary" : "pu-btn"}
                      aria-disabled={busy ? "true" : undefined}
                      aria-label={`${busy ? "Running" : label}: ${entry.heading}`}
                      onClick={busy ? undefined : () => run(entry)}
                      data-testid={`dcv-run-button-${entry.key}`}
                    >
                      {label}
                    </button>
                  </div>
                  <div className="dcv-result" role="status" aria-live="polite">
                    {result?.reply && <p className="dcv-reply">{result.reply}</p>}
                    {result?.error && <p className="dcv-error" role="alert">{result.error}</p>}
                  </div>
                </Card>
              );
            })}
          </CardGrid>
          <div className="pu-actions dcv-clear-row">
            <button
              type="button"
              className="pu-btn"
              aria-disabled={hasResults ? undefined : "true"}
              onClick={hasResults ? handleClearAll : undefined}
              data-testid="dcv-clear"
            >
              Clear
            </button>
          </div>
        </Section>

        <Section
          id="dcv-chain-h"
          kicker="3 · The evidence"
          title="The chain from that run"
          lede="Every hop of the run above, with the token claims it carried: subject, audience, scopes, and the nested act chain naming each agent in order."
        >
          <Card tone={lastPrompt ? "live" : "neutral"} data-testid="dcv-chain" data-state={lastPrompt ? "run" : "empty"}>
            {lastPrompt ? (
              <>
                <p className="pu-status-line"><StatusChip tone="info">From the run</StatusChip><span>Prompt: <span className="pu-mono">{lastPrompt}</span></span></p>
                <TokenChainTraceRail />
              </>
            ) : (
              <p className="pu-empty pu-note">Nothing to show yet. Run a scenario above and its token chain appears here.</p>
            )}
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
