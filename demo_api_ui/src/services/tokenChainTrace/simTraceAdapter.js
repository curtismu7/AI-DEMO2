// Map an attack-sim result's server-built token events onto the event ids the
// full-pipeline TokenChainTraceRail (buildTraceSteps) recognizes, so a real
// attack sim lights the Sign-in + Token exchange steps — not just the chatbot
// prompt. Pure, unit-tested in isolation.
//
// The backend keeps emitting sim-* ids (consumed unchanged by the API Traffic
// panel and the Proof product-badge map); this adapter only reshapes the COPY
// fed to the trace rail. The PingOne Authorize DENY step is driven separately by
// tokenChainTraceStore.ingestAuthorize(data.authorize), not by these events.

const SIM_TO_RAIL_ID = {
  // The sim's real RFC 8693 delegated token → the rail's exchange step evidence.
  'sim-exchange-ok': 'exchanged-token',
};

/**
 * @param {{ tokenChainEvents?: Array<{id?: string}> }} data - attack-sim result
 * @returns {Array<object>} events with rail-recognized ids (originals untouched)
 */
export function buildSimRailEvents(data) {
  const events = data && Array.isArray(data.tokenChainEvents) ? data.tokenChainEvents : [];
  return events
    .filter((e) => e && e.id)
    .map((e) => {
      const railId = SIM_TO_RAIL_ID[e.id];
      return railId ? { ...e, id: railId } : e;
    });
}
