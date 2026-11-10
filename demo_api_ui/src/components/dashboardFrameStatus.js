// The wording behind the customer dashboard's frame (UserDashboardPing2026): the mode banner and the status chips.
// Pure functions of what the page can actually know, so each state can be tested without rendering the dashboard.
import { pausedGateState } from "../services/tokenChainTrace/buildTraceSteps";
import { RUN_PROVENANCE } from "../config/agentTerminology";

const ENGINE = "Agent answers come from the agent engine in use; the run trace shows what each run called.";

/**
 * Mode banner text. The page knows: whether a session is signed in, and what the account list holds (nothing, the
 * built-in sample list, or accounts from the banking API). It does not know whether the agent engine or the bank behind
 * the BFF is live or mocked, so it never says so.
 * @param {object|null} user
 * @param {Array} accounts
 */
export function dashboardModeText(user, accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  const sample = list.some((a) => a && a._demo);
  if (!user) {
    return sample
      ? "Guest session with demo accounts: the balances and transactions here are sample data. Agent answers come from the agent engine in use; sign in to act on your own accounts."
      : "Guest session. No accounts are shown here; sign in to act on your own accounts. Agent answers come from the agent engine in use.";
  }
  if (sample) return `Demo accounts: the balances and transactions on this page are sample data, not your own. ${ENGINE}`;
  if (list.length > 0) return `Signed in: balances and transactions come from the banking API for your session. ${ENGINE}`;
  // Signed in but nothing loaded: the accounts request failed (5xx, 403) or the bank returned none. Say only that.
  return `Signed in. No accounts loaded: the accounts request failed or returned none, so no balances or transactions are shown. ${ENGINE}`;
}

/**
 * Chip on the "Banking assistant" card. It says what the page knows about the session, not that the agent works: the
 * page has no health signal from the agent host, and the chat can be signed in and still waiting on a gateway.
 */
export function chatStatusChip({ hostPending, user }) {
  if (hostPending) return { tone: "neutral", word: "Starting" };
  if (!user) return { tone: "warn", word: "Guest: sign in to act" };
  return { tone: "ok", word: "Signed in" };
}

/**
 * Chip on the "Run trace" card, from the same trace the sequence diagram draws. It reads the same classification
 * buildRunStory uses (pausedGateState, the expected-DENY test), because the transport stamps a paused approval gate and
 * an expected DENY `outcome: 'error'` even though the control worked.
 * @param {object|null} trace  tokenChainTraceStore.getState().trace
 * @param {number|null} baselineRunId  runId of the trace that was already in the store when the page mounted. A run from
 *   before the visit is not this visit's run, so it is labelled as earlier instead of keeping its verdict.
 */
export function runTraceChip(trace, baselineRunId = null) {
  if (!trace?.startedAt) return { tone: "neutral", word: "Not run" };
  if (baselineRunId != null && trace.runId === baselineRunId) return { tone: "neutral", word: "Earlier run" };

  const expectedDeny = Boolean(trace.mcpResult?.denied && trace.mcpResult?.expected);
  if (expectedDeny) return { tone: "info", word: "Expected DENY" };

  const gate = pausedGateState(trace);
  if (gate) {
    return gate.declined
      ? { tone: "info", word: "Approval declined" }
      : { tone: "warn", word: `Paused: ${gate.label}` };
  }

  if (trace.outcome === "error") return { tone: "danger", word: "Run failed" };

  if (trace.outcome === "ok" || trace.outcome === "mock-success") {
    const mock = trace.provenance === "mock-id-jag" || trace.provenance === "mock" || trace.outcome === "mock-success";
    if (mock) return { tone: "info", word: `${RUN_PROVENANCE.mock} captured` };
    if (trace.provenance === "recorded") return { tone: "info", word: `${RUN_PROVENANCE.recorded} captured` };
    return { tone: "ok", word: "Run captured" };
  }
  return { tone: "info", word: "Run started" };
}
