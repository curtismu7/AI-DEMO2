import { tokenChainTraceStore } from "./tokenChainTraceStore";
import {
  SPIFFE_BRIDGE_EVENT_IDS,
  SPIFFE_BRIDGE_PROMPT,
  SPIFFE_BRIDGE_TRACE_KIND,
} from "./spiffeBridgeSimulationModel";

const SIMULATION_EVENTS = [
  {
    id: "spiffe-svid-presented",
    lane: "AGENT",
    title: "Workload presents JWT-SVID",
    detail: { spiffeId: "spiffe://demo.local/ns/orders/sa/worker", trustDomain: "demo.local" },
  },
  {
    id: "spiffe-svid-verified",
    lane: "GATEWAY",
    title: "Bridge verifies SVID",
    detail: { checks: ["issuer", "audience", "expiry", "trust domain"], result: "verified" },
  },
  {
    id: "spiffe-id-mapped",
    lane: "GATEWAY",
    title: "SPIFFE ID mapped to PingOne client",
    detail: { mapping: "spiffe://demo.local/ns/orders/sa/worker → autonomous-agent-client" },
  },
  {
    id: "pingone-private-key-jwt",
    lane: "PINGONE",
    title: "PingOne assertion created",
    detail: { algorithm: "RS256", keyId: "bridge-key-01", grantType: "client_credentials" },
  },
];

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function runSpiffeBridgeSimulation({ delayMs = 650 } = {}) {
  tokenChainTraceStore.beginTrace({ prompt: SPIFFE_BRIDGE_PROMPT });
  const runId = tokenChainTraceStore.getState().trace.runId;

  const stillOwnsTrace = () => tokenChainTraceStore.getState().trace.runId === runId;

  try {
    for (const [index, event] of SIMULATION_EVENTS.entries()) {
      if (!stillOwnsTrace()) return { ok: false, cancelled: true, eventIds: [] };
      if (index > 0) {
        const previous = SIMULATION_EVENTS[index - 1];
        tokenChainTraceStore.ingestTokenEvent({
          ...previous,
          bridge: SPIFFE_BRIDGE_TRACE_KIND,
          status: "done",
          simulated: true,
          timestamp: new Date().toISOString(),
        });
      }
      tokenChainTraceStore.ingestTokenEvent({
        ...event,
        bridge: SPIFFE_BRIDGE_TRACE_KIND,
        status: index === SIMULATION_EVENTS.length - 1 ? "done" : "active",
        simulated: true,
        timestamp: new Date().toISOString(),
      });
      if (delayMs > 0 && index < SIMULATION_EVENTS.length - 1) await wait(delayMs);
    }
    if (!stillOwnsTrace()) return { ok: false, cancelled: true, eventIds: [] };
    tokenChainTraceStore.completeTrace(true);
    return { ok: true, eventIds: SPIFFE_BRIDGE_EVENT_IDS.slice() };
  } catch (error) {
    tokenChainTraceStore.completeTrace(false);
    throw error;
  }
}

export { SPIFFE_BRIDGE_EVENT_IDS, SPIFFE_BRIDGE_PROMPT, SPIFFE_BRIDGE_TRACE_KIND };
