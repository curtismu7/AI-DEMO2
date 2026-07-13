import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';

const ProofContext = createContext(null);

function firstUseCaseId(trace) {
  const fromTokens = (trace.tokenEvents || []).find((e) => e && e.useCaseId)?.useCaseId;
  if (fromTokens) return fromTokens;
  if (trace.authorize && trace.authorize.useCaseId) return trace.authorize.useCaseId;
  return null;
}

// Mirrors firstUseCaseId's lookup order. useCaseId slugs are shared across
// verticals by design (Tasks 3-5), so `vertical` is what disambiguates which
// vertical instance of a narrative fired — stamped alongside useCaseId on
// tokenEvents and trace.authorize.
function verticalOf(trace) {
  const fromTokens = (trace.tokenEvents || []).find((e) => e && e.vertical)?.vertical;
  if (fromTokens) return fromTokens;
  if (trace.authorize && trace.authorize.vertical) return trace.authorize.vertical;
  return null;
}

function decisionOf(trace) {
  // NOTE (discovered during planning, not fixed by this plan): the PERMIT
  // branch of mcpToolAuthorizationService.js populates evaluation.decision
  // (e.g. 'PERMIT'), but its plain-DENY branch (services/mcpToolAuthorizationService.js:442-455)
  // never sets `decision` on the block body at all — only `decisionContext`
  // (a fixed string like 'McpFirstTool') and `decisionId`. So `trace.authorize.decision`
  // is reliably present for PERMIT outcomes but absent for DENY/HITL/STEP_UP block
  // outcomes. Fast-follow fix (out of scope here — touches mcpToolAuthorizationService.js,
  // not just the tagging this plan adds): add `decision: r.decision` to that DENY
  // branch's returned body, mirroring the PERMIT branch, then pass it through
  // mcpToolPipeline.js's block-path mcpAuthorizeEvaluation alongside useCaseId.
  // Until then, `computeVerdict` below treats a missing `decision` as "can't
  // contradict expectedOutcome" (see outcomeMatches) rather than fabricate one —
  // it relies on the evidence-step-completeness check (matchedSteps/missingSteps)
  // as the primary signal, which does not depend on this field.
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
  const seenTokenIds = new Set((trace.tokenEvents || []).map((e) => e.id));
  const matchedSteps = (evidence.tokenChain || []).filter((step) => {
    if (step === 'authorize-decision') return !!trace.authorize;
    if (step === 'tool-dispatched') return !!trace.mcpResult;
    return seenTokenIds.has(step);
  });
  const missingSteps = (evidence.tokenChain || []).filter((s) => !matchedSteps.includes(s));

  if (missingSteps.length > 0) {
    return { useCaseId, title: catalogEntry.title, state: 'incomplete', matchedSteps, missingSteps, vertical };
  }

  const decision = decisionOf(trace);
  const expected = catalogEntry.expectedOutcome;
  const outcomeMatches = !expected || !decision || expected === decision;
  return {
    useCaseId,
    title: catalogEntry.title,
    state: outcomeMatches
      ? (expected === 'DENY' || expected === 'STEP_UP' || expected === 'HITL' ? 'denied-as-expected' : 'verified')
      : 'mismatch',
    matchedSteps,
    missingSteps: [],
    vertical,
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
