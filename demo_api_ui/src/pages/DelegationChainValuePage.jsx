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
      <p className="dcv-eyebrow">WHY THIS DEMO EXISTS</p>
      <h1>Prove who acted, and who authorized it</h1>
      <p className="dcv-intro">
        Delegated agents create a trust gap: a user may authorize one agent, while a different
        specialist or tool performs the action. This page makes that gap visible. Each scenario
        runs through the live token-exchange and authorization path, then shows the evidence in
        the token-chain panel.
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
