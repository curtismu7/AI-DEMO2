import { useEffect, useState } from "react";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";

// Only these claims are ever shown; anything else in the decoded token is dropped.
const SHOW = ["iss", "sub", "aud", "client_id", "scope", "resource", "exp"];

export function readableClaims(event) {
  const raw = event && event.claims;
  const claims = raw && raw.claims ? raw.claims : raw;
  if (!claims || typeof claims !== "object") return null;
  const out = {};
  for (const k of SHOW) if (claims[k] !== undefined) out[k] = claims[k];
  return Object.keys(out).length ? out : null;
}

/** The trace of the most recent run (live or mock), kept current. */
export function useLastRunTrace() {
  const [snap, setSnap] = useState(() => tokenChainTraceStore.getState());
  useEffect(() => tokenChainTraceStore.subscribe(setSnap), []);
  return snap && snap.trace ? snap.trace : null;
}

/** { claims, mock } for a call's recorded evidence event, or null when none was recorded. */
export function liveEvidenceFor(call, trace) {
  if (!call || !call.evidence || !trace) return null;
  const event = (trace.tokenEvents || []).find((e) => e && e.id === call.evidence);
  const claims = readableClaims(event);
  if (!claims) return null;
  return { claims, mock: String(trace.provenance || "").startsWith("mock") };
}
