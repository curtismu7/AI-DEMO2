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
const A2A_REFS = ["A2A message/send", "JSON-RPC 2.0"];

const quote = (text) => (text ? `“${text}”` : "");
// ": “what was said”." as the end of a sentence, without doubling the full stop
// when the quoted text already ends one.
const saying = (text) => (text ? `: ${quote(text)}${/[.!?]$/.test(text) ? "" : "."}` : ".");

// What an agent puts on the wire for a hand-off. The main agent reports its own
// request (event.request). The LangChain agent reports only that its hop
// happened, so its request is rebuilt here from the fixed shape it sends
// (langchain_agent/src/agent/a2a_delegation.py); ids and the key are not known.
const sendBody = (from, text) => [
  "POST <Privilege gateway>/<remote agent app>/…",
  "Content-Type: application/json",
  `Authorization: Bearer <${from}'s own agent key>`,
  "",
  JSON.stringify({
    jsonrpc: "2.0",
    id: "<request id>",
    method: "message/send",
    params: { message: { role: "user", messageId: "<message id>", parts: [{ kind: "text", text }] } },
  }, null, 2),
].join("\n");

const replyBody = (text) => [
  "HTTP 200",
  "",
  JSON.stringify({
    jsonrpc: "2.0",
    id: "<request id>",
    result: { kind: "message", role: "agent", messageId: "<message id>", parts: [{ kind: "text", text }] },
  }, null, 2),
].join("\n");

/**
 * Steps for a three-deep Privilege A2A chain run (main agent -> gateway ->
 * LangChain agent -> gateway -> specialist), from its hop events (`pa2a-<n>`,
 * see utils/privilegeA2aChainRun.js) in arrival order. The gateway sits between
 * every pair of agents in both directions, so a call is three steps (caller,
 * gateway check, callee) and so is its reply (callee, gateway, caller). A
 * refused call stops at the gateway step.
 *
 * When the caller read the callee's A2A Agent Card first (a `card` event), two
 * steps come before the call: the request, and the card with its data.
 *
 * A step's lane names its actor, so its title says only what the actor did.
 * The detail panel shows `narrative`, `kv`, `request` and `response`; the
 * reason for a step is part of its narrative because the panel has no slot
 * for one.
 */
export function buildPrivilegeA2aChainSteps(tokenEvents) {
  const events = (Array.isArray(tokenEvents) ? tokenEvents : [])
    .filter((event) => typeof event?.id === "string" && event.id.startsWith("pa2a-") && event.from && event.to);
  // The main agent announces its call before the gateway answers. If that call
  // is then refused, the refusal is the outcome of the same call: keep the
  // announcement only as the source of the request, or the view shows the call
  // forwarded and then refused.
  const refusalOf = (event, index) => events.slice(index + 1)
    .find((later) => later.status === "error" && later.from === event.from && later.to === event.to);
  const announced = (event, index) => events.slice(0, index).reverse()
    .find((earlier) => earlier.kind === "delegate" && earlier.from === event.from && earlier.to === event.to);

  return events.flatMap((event, index) => {
    if (event.kind === "delegate" && refusalOf(event, index)) return [];
    const from = chainActor(event.from);
    const to = chainActor(event.to);
    const refused = event.status === "error";
    const origin = refused ? announced(event, index) : event;
    // What was said on this hop: the message of a call, or the text of a reply.
    const said = (event.kind === "card" ? "" : (refused ? origin?.detail : event.detail)) || "";
    const saidRow = (label) => (said ? [[label, said]] : []);
    const timing = typeof event.elapsedMs === "number" ? [["Round trip", `${event.elapsedMs} ms`]] : [];
    const facts = [
      `${from} → ${to}`,
      ...(said ? [quote(said.length > 60 ? `${said.slice(0, 57)}…` : said)] : []),
      ...timing.map(([, value]) => value),
    ];
    const step = (suffix, title, lane, status, detail) => ({
      id: `${event.id}${suffix}`,
      title,
      lane,
      status,
      detail: { facts, rfcs: A2A_REFS, tokenEvent: event, ...detail },
    });

    // Discovery: the caller read the callee's A2A Agent Card before calling it.
    if (event.kind === "card") {
      const card = event.card;
      const skills = Array.isArray(card?.skills) ? card.skills : [];
      const ask = step("-discover", `Asks for ${to}'s A2A Agent Card`, chainLane(event.from), "done", {
        narrative: `Before calling, ${from} asked the Privilege gateway for ${to}'s A2A Agent Card, with its own agent key. The card is how one agent learns what another is, what it can do and how to talk to it, without that being hard-coded.`,
        kv: [["From", from], ["About", to], ["Asked", "Privilege gateway"], ["Credential", `${from}'s own agent key (Bearer)`]],
        ...(event.request ? { request: { title: `A2A Agent Card request · ${from} → Privilege gateway`, text: event.request } } : {}),
      });
      if (!card) {
        return [ask, step("-card", "No A2A Agent Card returned", PRIVILEGE_GATEWAY_LANE, "done", {
          facts: ["A2A Agent Card", "not returned"],
          narrative: `${event.detail || "No Agent Card was returned"}. ${from} carries on: it calls the gateway's route for ${to} either way.`,
          kv: [["A2A Agent Card", "Not returned"]],
          ...(event.response ? { response: { title: `Response to ${from}`, text: event.response } } : {}),
        })];
      }
      return [ask, step("-card", `Returns ${to}'s A2A Agent Card`, PRIVILEGE_GATEWAY_LANE, "done", {
        facts: ["A2A Agent Card", card.name, `${skills.length} skill${skills.length === 1 ? "" : "s"}`],
        narrative: `This is the A2A Agent Card: ${to} describes itself as “${card.name}”, speaking A2A ${card.protocolVersion || "(version not stated)"} over ${card.preferredTransport || "an unstated transport"}, with ${skills.length} skill${skills.length === 1 ? "" : "s"}. ${from} uses it to know who it is about to call and how; the call that follows is the A2A message/send the card describes. ${from} still sends that call to the gateway's route, not to the endpoint the card names, so the gateway checks it.`,
        kv: [
          ["A2A Agent Card", "Returned through the Privilege gateway"],
          ["Agent name", card.name],
          ...(card.description ? [["Description", card.description]] : []),
          ["A2A protocol version", card.protocolVersion || "not stated"],
          ["Transport", card.preferredTransport || "not stated"],
          ["Skills", skills.length ? skills.join(", ") : "none listed"],
          ...(card.url ? [["Endpoint named in the card", card.url]] : []),
          ["Endpoint the caller uses", "The Privilege gateway's route for this agent"],
        ],
        ...(event.response ? { response: { title: `A2A Agent Card · ${to}`, text: event.response } } : {}),
      })];
    }

    if (event.kind === "result") {
      const response = { title: `A2A reply · ${from} → ${to}`, text: event.response || replyBody(said) };
      return [
        step("-reply", `Replies to ${to}`, chainLane(event.from), "done", {
          narrative: `${from} answered the A2A call${saying(said)} It sends the reply to the gateway, not to ${to}: it has no direct route to ${to}, so the gateway sees both halves of the conversation.`,
          kv: [["From", from], ["To", to], ["Protocol", "A2A message, as a JSON-RPC 2.0 result"], ...saidRow("Reply")],
          response,
        }),
        step("-relay", "Relays the reply", PRIVILEGE_GATEWAY_LANE, "done", {
          narrative: `The reply from ${from} returned through the Privilege gateway on its way to ${to}. The gateway is the only path between the two agents, in both directions. We have confirmed it screens the call; we have not seen it inspect a reply.`,
          kv: [["Path", `${from} → Privilege gateway → ${to}`], ["Reply inspection", "Not observed in our tests of this gateway"], ...timing],
        }),
        step("-return", `Receives the reply from ${from}`, chainLane(event.to), "done", {
          narrative: `${to} received ${from}'s answer${saying(said)} ${to} can now use it: pass it up the chain, or return it to the person who asked.`,
          kv: [["Received from", "Privilege gateway"], ["Originally from", from], ...saidRow("Reply")],
          response,
        }),
      ];
    }

    // The card the caller read for this callee, if it read one.
    const cardRead = events.slice(0, index).find((earlier) => earlier.kind === "card" && earlier.card && earlier.from === event.from && earlier.to === event.to)?.card;
    const call = step("-call", `Calls ${to} · A2A message/send`, chainLane(event.from), "done", {
      narrative: `${from} sent an A2A message/send for ${to} to the Privilege gateway${saying(said)} It presented its own agent key as the Bearer token. ${from} never calls ${to} directly; it addresses the gateway's route for ${to}, so the hand-off can be checked before ${to} sees it.`,
      kv: [
        ["From", from],
        ["To", to],
        ["Protocol", "A2A message/send over JSON-RPC 2.0"],
        ["Credential", `${from}'s own agent key (Bearer)`],
        ...(cardRead ? [["Described by", `A2A Agent Card “${cardRead.name}”, read before this call`]] : []),
        ...saidRow("Message"),
      ],
      request: { title: `A2A message/send · ${from} → Privilege gateway`, text: origin?.request || sendBody(from, said) },
    });
    if (refused) {
      const reason = event.detail || "no reason given";
      return [call, step("-gateway", "Refuses the call", PRIVILEGE_GATEWAY_LANE, "error", {
        narrative: `The gateway or the agent behind it refused this call: ${reason}. The hand-off stopped here: ${to} did no work for this call, and ${from} received the refusal instead of an answer.`,
        kv: [["Outcome", "Refused"], ["Reason", reason], ["Reached the next agent", "No"], ...timing],
        ...(event.response ? { response: { title: `Refusal returned to ${from}`, text: event.response } } : {}),
      })];
    }
    return [
      call,
      step("-gateway", "Checks key, scope, policy and guardrail", PRIVILEGE_GATEWAY_LANE, "done", {
        narrative: `The gateway recognised ${from}'s key, confirmed it has the a2a scope and a policy for ${to}, and screened the message before forwarding it. Each agent has its own key and its own grants, so the gateway decides hop by hop who may call whom and what may cross.`,
        kv: [
          ["Agent key", `Recognised as ${from}`],
          ["Scope", "a2a — present"],
          ["Policy", `${from} may call ${to}`],
          ["Guardrail", "Message screened — passed"],
          ...timing,
        ],
      }),
      step("-forward", `Receives the call from ${from}`, chainLane(event.to), "done", {
        narrative: `${to} received the call from the gateway, not from ${from} directly${saying(said)} It never sees ${from}'s agent key: a caller's key is never passed on, so a leaked key works at the gateway only.`,
        kv: [
          ["Received from", "Privilege gateway"],
          ["Originally from", from],
          ["Credential presented", `Whatever the gateway is set to present for ${to}; never ${from}'s key`],
          ...saidRow("Message"),
        ],
      }),
    ];
  });
}
