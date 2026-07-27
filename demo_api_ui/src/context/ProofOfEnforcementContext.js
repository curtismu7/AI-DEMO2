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
  const intent = trace.prompt?.message || catalogEntry.trigger?.text || null;
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
    return {
      useCaseId, title: catalogEntry.title, state: 'incomplete', matchedSteps, missingSteps, vertical,
      intent, tool, mechanism,
      resultText: `Waiting on ${missingSteps.join(', ')}`,
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
  const resultText = state === 'mismatch'
    ? 'Result did not match the expected outcome'
    : expectedIsDenyLike
      ? (expectedFamily === 'STEP_UP'
          ? 'Step-up MFA required as expected — then permitted'
          : expectedFamily === 'HITL_REQUIRED'
            ? 'Human approval required as expected — then permitted'
            : 'Denied as expected by policy')
      : tool
        ? `Completed — ${tool} dispatched`
        : 'Completed';
  return {
    useCaseId,
    title: catalogEntry.title,
    state,
    matchedSteps,
    missingSteps: [],
    vertical,
    intent, tool, mechanism, resultText,
  };
}

export function ProofOfEnforcementProvider({ children, vertical = 'banking' }) {
  const [catalog, setCatalog] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const [history, setHistory] = useState([]);

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
    setHistory((prev) => [next, ...prev].slice(0, 20));
  }, [catalog]);

  useEffect(() => tokenChainTraceStore.subscribe(recompute), [recompute]);

  const value = useMemo(() => ({ verdict, history }), [verdict, history]);

  return <ProofContext.Provider value={value}>{children}</ProofContext.Provider>;
}

export function useProofOfEnforcement() {
  const ctx = useContext(ProofContext);
  if (!ctx) throw new Error('useProofOfEnforcement must be used within ProofOfEnforcementProvider');
  return ctx;
}
