import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { productsForUseCase } from '../utils/pingProducts';

const ProofContext = createContext(null);

// The backend catalog's expectedOutcome values that represent a "blocked or
// challenged" narrative (attacks track + hitl-consent). See decisionOf()
// below: these outcomes' block responses don't populate `decision` today, so
// outcomeMatches defaults to true for them — this set is what maps that
// true-by-default match to 'denied-as-expected' instead of 'verified'.
// DENY_503 belongs here too: UC29 is an attack-track use case whose whole point
// is that the call is refused. Without it, expectedIsDenyLike was false, so the
// verdict fell through to `decision === 'PERMIT'` — rendering UC29 as plain
// 'verified' when no decision was recorded, or 'mismatch' when one was. Never
// 'denied-as-expected'. Keep this set in step with the backend mirror in
// demo_api_server/services/stepVerificationExpectations.js (parity-gated).
const DENIED_LIKE_OUTCOMES = new Set(['DENY', 'DENY_401', 'DENY_403', 'DENY_429', 'DENY_503', 'STEP_UP', 'HITL_REQUIRED']);

// Which block kind each catalog expectedOutcome demands. mcpToolPipeline stamps
// the actual kind on trace.authorize.outcome (DENY / STEP_UP / HITL_REQUIRED /
// POLICY_NOT_FOUND). Comparing families — rather than the old "decision !==
// 'PERMIT'" — is what stops a use case expecting a hard DENY from rendering green
// when the engine actually returned an approval gate.
const EXPECTED_OUTCOME_FAMILY = {
  DENY: 'DENY', DENY_401: 'DENY', DENY_403: 'DENY', DENY_429: 'DENY', DENY_503: 'DENY',
  STEP_UP: 'STEP_UP', HITL_REQUIRED: 'HITL_REQUIRED',
};

// Sign-in / session cards are reused across runs (see beginTrace). Their tags
// must not select the Proof catalog entry — that belongs to the current call.
const SESSION_EVENT_IDS = new Set([
  'user-token',
  'session-token-introspection',
  'user-token-introspection',
  'id-token',
  'refresh-token',
]);

function isCallScopedEvent(e) {
  return !!(e && e.id && !SESSION_EVENT_IDS.has(e.id));
}

function firstUseCaseId(trace) {
  // Prefer call-scoped token events, then authorize — never sticky session cards.
  const fromTokens = (trace.tokenEvents || []).find((e) => isCallScopedEvent(e) && e.useCaseId)?.useCaseId;
  if (fromTokens) return fromTokens;
  if (trace.authorize && trace.authorize.useCaseId) return trace.authorize.useCaseId;
  return null;
}

// Mirrors firstUseCaseId's lookup order. useCaseId slugs are shared across
// verticals by design (Tasks 3-5), so `vertical` is what disambiguates which
// vertical instance of a narrative fired — stamped alongside useCaseId on
// tokenEvents and trace.authorize.
function verticalOf(trace) {
  const fromTokens = (trace.tokenEvents || []).find((e) => isCallScopedEvent(e) && e.vertical)?.vertical;
  if (fromTokens) return fromTokens;
  if (trace.authorize && trace.authorize.vertical) return trace.authorize.vertical;
  // Session-only vertical is a last resort when no call-scoped tag exists yet.
  const fromSession = (trace.tokenEvents || []).find((e) => e && e.vertical)?.vertical;
  if (fromSession) return fromSession;
  return null;
}

function decisionOf(trace) {
  // `decision` IS populated on block outcomes — mcpToolPipeline.js synthesizes it
  // for the block path ('INDETERMINATE' for step-up/HITL, 'DENY' otherwise), and
  // mcpToolAuthorizationService.js's PERMIT branch sets the real value. It is NOT
  // the raw PingOne decision on the block path: PingOne returns PERMIT plus a HITL
  // obligation for an approval gate, which the pipeline maps to 'INDETERMINATE'.
  // Because step-up and HITL collapse to the same value here, `decision` alone
  // cannot identify the block kind — computeVerdict uses trace.authorize.outcome
  // for that and keeps this only as the PERMIT/non-PERMIT fallback.
  const d = trace.authorize && trace.authorize.decision;
  return d || null;
}

/**
 * Compares an in-flight trace against a catalog entry's declared evidence and
 * computes a verdict. Pure function — no side effects, easy to unit-test in
 * isolation from the store/context plumbing above.
 */
export function computeVerdict(trace, catalogEntry) {
  const useCaseId = catalogEntry.useCaseId;
  const evidence = catalogEntry.evidence || { tokenChain: [], activity: [] };
  const vertical = verticalOf(trace);
  // Highlights for the ProofStrip box: what the user asked for, which tool ran
  // it, and which Ping products the catalog's evidence chain says are in play.
  // Chip clicks replay the chip's own button caption as trace.prompt.message
  // (see AIAgent.js handleDemoStepSelect / TokenChainContext beginTrace) — so
  // for a chip-driven run this ends up displaying the raw button text (e.g.
  // "hand off to a specialist") as if it were the user's intent, which reads
  // like an instruction rather than a description of what happened. Prefer
  // the catalog entry's title in that case; a genuine free-typed prompt that
  // doesn't match the trigger text is shown as-is.
  const rawIntent = trace.prompt?.message || catalogEntry.trigger?.text || null;
  const intent = rawIntent === catalogEntry.trigger?.text
    ? (catalogEntry.title || rawIntent)
    : rawIntent;
  const tool = catalogEntry.primaryTool || trace.mcpResult?.tool || null;
  const mechanism = productsForUseCase(catalogEntry).map((p) => p.label);
  const seenTokenIds = new Set((trace.tokenEvents || []).map((e) => e.id));
  const matchedSteps = (evidence.tokenChain || []).filter((step) => {
    if (step === 'authorize-decision') return !!trace.authorize;
    if (step === 'tool-dispatched') return !!trace.mcpResult;
    if (step === 'token-exchange') return trace.tokenEvents.some((e) => e && e.exchangeStep != null);
    return seenTokenIds.has(step);
  });
  const missingSteps = (evidence.tokenChain || []).filter((s) => !matchedSteps.includes(s));

  if (missingSteps.length > 0) {
    // "Waiting" is only honest while the run is still in flight. completeTrace()
    // stamps trace.outcome ('ok' | 'error') the moment the run ends, so an ended
    // run with evidence still missing has FAILED before those steps, not stalled
    // on them. Without this the two states rendered identically: during the
    // gateway mTLS scheme break, PingOne Authorize returned PERMIT and the tool
    // call died downstream, yet the strip read "Waiting on authorize-decision" —
    // pointing at the one component that had actually answered.
    const ended = trace.outcome === 'error';
    return {
      useCaseId, id: catalogEntry.id, title: catalogEntry.title,
      expectedOutcome: catalogEntry.expectedOutcome || null,
      state: 'incomplete', matchedSteps, missingSteps, vertical,
      intent, tool, mechanism,
      resultText: `${ended ? 'Run failed before' : 'Waiting on'} ${missingSteps.join(', ')}`,
    };
  }

  const decision = decisionOf(trace);
  const expected = catalogEntry.expectedOutcome;
  // The catalog's expectedOutcome is a narrative label (e.g. RANKED_RESULTS,
  // CODE_CONTEXT, DELEGATE_AND_EXECUTE, GUIDED_DEMO, GUIDED_LEARNING,
  // LIVE_MCP_TOOLS, PERMIT for successes; DENY/DENY_401/DENY_403/DENY_429/
  // STEP_UP/HITL_REQUIRED for denials) — but the real backend only ever emits
  // 'PERMIT' on trace.authorize.decision for a permit, never the specific
  // success label. So "does the real decision satisfy expectations" is a
  // binary question keyed on DENIED_LIKE_OUTCOMES membership, not a literal
  // string match against `expected`.
  const expectedIsDenyLike = !!expected && DENIED_LIKE_OUTCOMES.has(expected);
  // When the block path reported WHICH kind of block occurred, hold the run to
  // the specific outcome the catalog claims. Without this, any non-PERMIT value
  // satisfied every deny-like expectation, so a use case advertising a hard DENY
  // went green on a HITL approval gate (and vice versa).
  const actualOutcome = trace.authorize && trace.authorize.outcome;
  const expectedFamily = expected && EXPECTED_OUTCOME_FAMILY[expected];
  const outcomeMatches = expectedIsDenyLike && expectedFamily && actualOutcome
    ? actualOutcome === expectedFamily
    : !expected || !decision
      ? true
      : expectedIsDenyLike
        ? decision !== 'PERMIT'
        : decision === 'PERMIT';
  const state = outcomeMatches
    ? (expectedIsDenyLike ? 'denied-as-expected' : 'verified')
    : 'mismatch';
  // STEP_UP/HITL_REQUIRED are approval gates, not hard denials — the call is
  // paused, not refused, and goes on to PERMIT once the human/MFA step is
  // satisfied. Labeling that "denied" reads as a contradiction next to the
  // chat's own "completed successfully" message, so give those two families
  // their own gate-specific wording and reserve "denied" for the real DENY
  // family (where the call is in fact refused).
  // "then permitted" is only true when the human actually satisfied the gate.
  // TransactionConsentModal records a refusal on the trace, so a declined run
  // says so instead of asserting a permit that never happened. The state stays
  // 'denied-as-expected' (green): enforcement did exactly its job — the gate
  // held — and the only thing that changes is what the run is reported to have
  // ended in.
  const gateDeclined = trace.approvalOutcome === 'declined';
  const resultText = state === 'mismatch'
    ? 'Result did not match the expected outcome'
    : expectedIsDenyLike
      ? (expectedFamily === 'STEP_UP'
          ? (gateDeclined
              ? 'Step-up MFA required as expected — you declined, so the transaction was not completed'
              : 'Step-up MFA required as expected — then permitted')
          : expectedFamily === 'HITL_REQUIRED'
            ? (gateDeclined
                ? 'Human approval required as expected — you declined, so the transaction was not completed'
                : 'Human approval required as expected — then permitted')
            : 'Denied as expected by policy')
      : tool
        ? `Completed — ${tool} dispatched`
        : 'Completed';
  return {
    useCaseId,
    // Catalog identity carried alongside the verdict so consumers that need to
    // name the use case (the Token Chain step pop-out) don't have to re-fetch
    // /api/use-cases to render "UC7 — Step-up required · expected STEP_UP".
    id: catalogEntry.id,
    expectedOutcome: expected || null,
    title: catalogEntry.title,
    state,
    matchedSteps,
    missingSteps: [],
    vertical,
    intent, tool, mechanism, resultText,
  };
}

// Cap on how many past runs keep a rendered verdict. Older runs fall out and
// their strip disappears rather than showing someone else's result.
const MAX_TRACKED_RUNS = 20;

export function ProofOfEnforcementProvider({ children, vertical = 'banking' }) {
  const [catalog, setCatalog] = useState([]);
  const [verdict, setVerdict] = useState(null);
  // Verdict per RUN, keyed by the trace's runId (beginTrace stamps a fresh one
  // per call). recompute fires on every store emit — beginTrace, each
  // ingestTokenEvent, ingestAuthorize, completeTrace — so a single run produces
  // several snapshots; keying by run means the later ones REPLACE the earlier
  // ones instead of accumulating. The previous append-only `history` array made
  // every entry a snapshot of the same run, and positional lookups into it
  // repainted older strips with the newest run's result.
  const [verdictsByRun, setVerdictsByRun] = useState({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/use-cases?vertical=${encodeURIComponent(vertical)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { useCases: [] }))
      .then((data) => { if (!cancelled) setCatalog(data.useCases || []); })
      .catch(() => { if (!cancelled) setCatalog([]); });
    return () => { cancelled = true; };
  }, [vertical]);

  const recompute = useCallback((snap) => {
    const trace = snap.trace;
    const useCaseId = firstUseCaseId(trace);
    if (!useCaseId) { setVerdict(null); return; }
    const entry = catalog.find((u) => u.useCaseId === useCaseId);
    if (!entry) { setVerdict(null); return; }
    const next = computeVerdict(trace, entry);
    setVerdict(next);
    const runId = trace.runId;
    if (runId == null) return;
    setVerdictsByRun((prev) => {
      const merged = { ...prev, [runId]: next };
      const keys = Object.keys(merged);
      if (keys.length <= MAX_TRACKED_RUNS) return merged;
      const keep = keys.map(Number).sort((a, b) => b - a).slice(0, MAX_TRACKED_RUNS);
      return Object.fromEntries(keep.map((k) => [k, merged[k]]));
    });
  }, [catalog]);

  useEffect(() => tokenChainTraceStore.subscribe(recompute), [recompute]);

  // verdictFor(runId) is what pins a rendered strip to the run that produced it;
  // `verdict` stays the latest-run value the banner/panel/workbench read.
  const verdictFor = useCallback(
    (runId) => (runId == null ? null : verdictsByRun[runId] || null),
    [verdictsByRun],
  );

  const value = useMemo(() => ({ verdict, verdictFor }), [verdict, verdictFor]);

  return <ProofContext.Provider value={value}>{children}</ProofContext.Provider>;
}

export function useProofOfEnforcement() {
  const ctx = useContext(ProofContext);
  if (!ctx) throw new Error('useProofOfEnforcement must be used within ProofOfEnforcementProvider');
  return ctx;
}

/**
 * Same context, null instead of throwing. TokenChainTraceRail mounts on ~20
 * surfaces and not all of them sit under ProofOfEnforcementProvider, so the
 * rail cannot use the throwing hook to look up which use case is running.
 * @returns {{verdict: object|null, history: object[]}|null}
 */
export function useProofOfEnforcementOptional() {
  return useContext(ProofContext);
}
