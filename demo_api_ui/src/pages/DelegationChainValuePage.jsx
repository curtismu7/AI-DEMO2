import React, { useCallback, useState } from "react";
import apiClient from "../services/apiClient";
import { requiredFlagsForUseCase } from "../utils/requiredDemoFlags";
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
  },
  {
    key: "authorization",
    heading: "Authorization — the actor-aware decision",
    body:
      "A resource server can evaluate not just what the user can do, but whether THIS agent may act " +
      "for them. This run repeats the same governed delegation, then probes the same policy decision " +
      "with an unregistered agent identity in place of the real one — same user, same shape, denied.",
    prompt: "simulate an agent identity mismatch",
    primaryTool: "sensitive_holdings",
  },
];

export default function DelegationChainValuePage() {
  const [status, setStatus] = useState({});
  const [results, setResults] = useState({});

  const run = useCallback(async (entry) => {
    setStatus((s) => ({ ...s, [entry.key]: "running" }));
    try {
      // Both runs are gated by ff_a2a_delegation: the A2A overlay's heuristics
      // are only merged into dispatch when it is on, so an unarmed flag makes
      // the trigger phrase fall through to "unknown action" instead of running.
      const flags = requiredFlagsForUseCase({
        useCaseId: null,
        primaryTool: entry.primaryTool,
        maturity: "flag:ff_a2a_delegation",
      });
      if (flags.length) {
        const updates = Object.fromEntries(flags.map((f) => [f, true]));
        await apiClient.patch("/api/admin/feature-flags", { updates }).catch(() => {});
      }
      const res = await apiClient.post("/api/agent/invoke", {
        prompt: entry.prompt,
        forceHeuristic: true,
        vertical: VERTICAL,
      });
      setResults((r) => ({
        ...r,
        [entry.key]: { reply: res.data?.reply || "", tools: res.data?.toolsCalled || [] },
      }));
      setStatus((s) => ({ ...s, [entry.key]: "done" }));
    } catch (err) {
      setStatus((s) => ({ ...s, [entry.key]: "error" }));
      setResults((r) => ({ ...r, [entry.key]: { error: err.message } }));
    }
  }, []);

  return (
    <div className="dcv-page">
      <h1>The value of preserving the delegation chain</h1>
      <p className="dcv-intro">
        Token exchange provides two benefits for agentic systems: an evidential audit trail
        (accountability), and authorization decisions that account for the agent as well as the
        user. Run each scenario below and watch the token chain panel for the evidence.
      </p>
      {RUNS.map((entry) => (
        <section key={entry.key} className="dcv-run">
          <h2>{entry.heading}</h2>
          <p>{entry.body}</p>
          <button
            type="button"
            onClick={() => run(entry)}
            disabled={status[entry.key] === "running"}
          >
            {status[entry.key] === "running" ? "Running..." : "Run"}
          </button>
          {results[entry.key]?.reply && <p className="dcv-reply">{results[entry.key].reply}</p>}
          {results[entry.key]?.error && <p className="dcv-error">{results[entry.key].error}</p>}
        </section>
      ))}
    </div>
  );
}
