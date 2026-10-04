// Steps for a Privilege A2A chain run. Kept beside buildTraceSteps because the
// trace store builds its step list from here: every view that reads the store
// (reel, filmstrip, sequence, token topology, system flow) then shows the chain
// instead of an empty banking pipeline.

// Names follow Ping's reference demo: the caller is the main agent.
const PRIVILEGE_CHAIN_ACTORS = { main: "Main agent", langchainagent: "LangChain agent" };
const chainActor = (name) => PRIVILEGE_CHAIN_ACTORS[name] || `${name} specialist`;
// Each actor is its own lane, so the sequence view draws one lifeline per
// agent with the gateway between them. GATEWAY is the existing gateway lane.
const chainLane = (name) => chainActor(name).toUpperCase().replace(/\s+/g, "-");
const PRIVILEGE_GATEWAY_LANE = "GATEWAY";

/**
 * Steps for a three-deep Privilege A2A chain run (main agent -> gateway ->
 * LangChain agent -> gateway -> specialist), from its hop events (`pa2a-<n>`,
 * see utils/privilegeA2aChainRun.js) in arrival order. A call is three steps
 * (caller, gateway check, callee) because the gateway sits between every pair
 * of agents; a refused call stops at the gateway step. A reply is one step.
 */
export function buildPrivilegeA2aChainSteps(tokenEvents) {
  const hops = (Array.isArray(tokenEvents) ? tokenEvents : [])
    .filter((event) => typeof event?.id === "string" && event.id.startsWith("pa2a-") && event.from && event.to);
  return hops.flatMap((event) => {
    const from = chainActor(event.from);
    const to = chainActor(event.to);
    const facts = [
      `${event.from} → ${event.to}`,
      ...(typeof event.elapsedMs === "number" ? [`${event.elapsedMs} ms`] : []),
    ];
    const step = (suffix, title, lane, status, narrative) => ({
      id: `${event.id}${suffix}`,
      title,
      lane,
      status,
      detail: { narrative, facts, tokenEvent: event },
    });
    if (event.kind === "result") {
      return [step("", `${from} returned to ${to} · back through the Privilege gateway`, chainLane(event.to), "done",
        `${from} answered ${to}. The reply passed back through the gateway.`)];
    }
    const refused = event.status === "error";
    const call = step("-call", `${from} calls ${to} · presents its own agent key`, chainLane(event.from), "done",
      `${from} sent an A2A message/send for ${to} to the Privilege gateway, with its own agent key as the Bearer token.`);
    if (refused) {
      return [call, step("-gateway", "Privilege gateway — refused", PRIVILEGE_GATEWAY_LANE, "error",
        `The gateway or the agent behind it refused this call: ${event.detail || "no reason given"}.`)];
    }
    return [
      call,
      step("-gateway", "Privilege gateway checks key, scope, policy and guardrail", PRIVILEGE_GATEWAY_LANE, "done",
        `The gateway recognised ${from}'s key, confirmed it has the a2a scope and a policy for ${to}, and screened the message before forwarding it.`),
      step("-forward", `Forwarded to ${to}`, chainLane(event.to), "done",
        `${to} received the call from the gateway, not from ${from} directly; it never sees ${from}'s agent key.`),
    ];
  });
}
