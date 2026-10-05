// Steps for a Privilege A2A chain run. Kept beside buildTraceSteps because the
// trace store builds its step list from here: every view that reads the store
// (reel, filmstrip, sequence, token topology, system flow) then shows the chain
// instead of an empty banking pipeline.

// Names follow Ping's reference demo: the caller is the main agent.
const PRIVILEGE_CHAIN_ACTORS = { main: "Main agent", langchainagent: "LangChain agent", analyst: "Analyst agent", mcp: "MCP tools" };
const chainActor = (name) => PRIVILEGE_CHAIN_ACTORS[name] || `${name} specialist`;
// Each actor is its own lane, so the sequence view draws one lifeline per
// agent with the gateway between them. GATEWAY is the existing gateway lane.
const chainLane = (name) => chainActor(name).toUpperCase().replace(/\s+/g, "-");
const PRIVILEGE_GATEWAY_LANE = "GATEWAY";
const A2A_REFS = ["A2A message/send", "JSON-RPC 2.0"];
// The name the gateway's log gives each caller: the agent its key belongs to
// in the Agent Registry.
const GATEWAY_CLIENT = { main: "main-agent", langchainagent: "langchain-caller" };
// The Agentic App the gateway routes each callee through. The specialists'
// names are the middle agent's delegation targets (A2A_DELEGATE_TARGETS in
// k8s/02-configmap.yaml); the app is the route each target's URL names.
const GATEWAY_APP = { langchainagent: "langchainagent", refunds: "hostile-a2a", restricted: "restrictedagent" };
const GATEWAY_RECORD_ID = "pa2a-gateway-record";
const RECORD_ROW = "Gateway's own record";

// What the A2A specification requires at each kind of step, and why the
// gateway is where it is. The detail panel shows these with RFC info on.
const A2A_SPEC = { label: "A2A specification", href: "https://a2a-protocol.org/latest/specification/", title: "Agent2Agent (A2A) Protocol specification" };
const A2A_DISCOVERY = { label: "A2A agent discovery", href: "https://a2a-protocol.org/latest/topics/agent-discovery/", title: "How a client finds an agent's Agent Card" };
const JSON_RPC = { label: "JSON-RPC 2.0", href: "https://www.jsonrpc.org/specification", title: "JSON-RPC 2.0 specification" };
const WELL_KNOWN = { label: "RFC 8615", href: "https://www.rfc-editor.org/rfc/rfc8615", title: "Well-Known Uniform Resource Identifiers" };
const BEARER = { label: "RFC 6750", href: "https://www.rfc-editor.org/rfc/rfc6750", title: "OAuth 2.0 Bearer Token Usage" };
const SPEC = {
  card: {
    refs: [A2A_SPEC, A2A_DISCOVERY, WELL_KNOWN],
    mandate: "An A2A agent describes itself in an Agent Card: a JSON document with its name, skills, transport, capabilities and the security it expects. A client can fetch it from a well-known path under the agent's address.",
    why: "A caller that reads the card learns how to talk to the agent without that being hard-coded. Fetching it through the gateway means discovery is checked like any other request.",
    failure: "Following the card's own endpoint. A card names the agent's direct address; a caller that uses it goes round the gateway. Here the caller keeps the gateway's route.",
  },
  call: {
    refs: [A2A_SPEC, JSON_RPC, BEARER],
    mandate: "message/send is a JSON-RPC 2.0 request. Its params carry a Message with a role, a messageId and one or more parts. Credentials travel in HTTP headers, never inside the message.",
    why: "The caller addresses the gateway's route for the agent, not the agent, so every hand-off passes one check, made with the caller's own key.",
    failure: "Sharing one key across agents. The gateway could then not tell which agent is calling, and grants made per agent would mean nothing.",
  },
  gateway: {
    refs: [A2A_SPEC, BEARER],
    mandate: "A2A leaves authentication and authorization to the HTTP layer: an agent, or an intermediary in front of it, identifies the caller from the request's credentials and decides whether to serve it.",
    why: "The gateway is that intermediary. It identifies the caller by its key, checks that key's scope and the policy for this pair of agents, and screens the message before the next agent sees it.",
    failure: "Assuming every caller is screened. In our tests the guardrail inspected calls made with an agent key; a call made with a person's sign-in was not inspected.",
  },
  refused: {
    refs: [A2A_SPEC, JSON_RPC],
    mandate: "A failed JSON-RPC call returns an error object with a code and a message in place of a result.",
    why: "Refusing at the gateway means the next agent does no work and sees no part of a message it should not have received.",
    failure: "Pairing replies to requests by id. This gateway's guardrail error does not echo the request's id, so a client that relies on it cannot match the refusal to its call.",
  },
  forward: {
    refs: [A2A_SPEC],
    mandate: "The agent authenticates whoever calls it at the HTTP layer. Behind a gateway that caller is the gateway, presenting the credential configured for this agent.",
    why: "The caller's key stops at the gateway. An agent never holds another agent's key, so a leaked key is useful at the gateway only.",
    failure: "Leaving the agent reachable at its own address. Anyone who can reach it directly, with a credential it accepts, skips every check shown here.",
  },
  reply: {
    refs: [A2A_SPEC, JSON_RPC],
    mandate: "The result of message/send is a Message with role agent, or a Task. The JSON-RPC response carries the id of the request it answers.",
    why: "The reply returns by the same path as the call, so one place sees both halves of the conversation.",
    failure: "Assuming replies are screened like calls. We have confirmed the gateway screens a call; we have not seen it inspect a reply.",
  },
};

/**
 * Rows for a gateway step from the gateway's own guardrail log (the
 * `pa2a-gateway-record` event, see utils/privilegeA2aChainRun.js). `outcome` is
 * `allowed`, `blocked` (the guardrail refused) or `denied` (policy refused).
 * Returns `{ rows, verdict }`; until the record arrives there are no rows.
 */
function gatewayRecord(record, caller, outcome, callee) {
  if (!record) return { rows: [] };
  if (record.state === "needsAuth") {
    return { rows: [[RECORD_ROW, "Not loaded. On the LLM Gateway page, under Gateway findings, choose Load findings and then Sign in to this door (one click), then run this again."]] };
  }
  if (record.state !== "ready") return { rows: [[RECORD_ROW, `Could not be read: ${record.error || "unknown error"}`]] };
  const wanted = outcome === "allowed" ? "a2a_request_alert" : "a2a_request_blocked";
  // The record is every line in the run's time window, oldest first: the newest
  // match is this run's.
  const verdict = (record.guardrail || []).findLast((entry) => entry.client === GATEWAY_CLIENT[caller] && entry.event === wanted);
  const app = GATEWAY_APP[callee];
  // A policy refusal: the gateway's own line names the principal and the app.
  const denial = outcome === "denied" && (record.denials || []).findLast((entry) => entry.app === app);
  if (denial) {
    return {
      rows: [
        [RECORD_ROW, `policy denied · ${denial.reason || "no access"} · a2a app ${denial.app}`],
        ["Principal the key resolved to", denial.principal],
        ...(denial.time ? [["Recorded at", denial.time]] : []),
      ],
    };
  }
  // An accepted call: the gateway's line for the request it handed to the app.
  const accepted = outcome === "allowed" && (record.requests || []).findLast((entry) => entry.app === app && entry.method === "POST");
  const acceptedRows = accepted ? [
    ["Gateway's request record", `Accepted ${accepted.method} ${accepted.path} for app ${accepted.app}`],
    ["Principal the key resolved to", accepted.principal],
    ...(accepted.tenant ? [["Tenant", accepted.tenant]] : []),
    ...(accepted.time ? [["Recorded at", accepted.time]] : []),
  ] : [];
  if (!verdict) {
    const none = {
      allowed: "No guardrail finding recorded for this call",
      blocked: "No matching guardrail line found yet",
      denied: "No refusal line found for this call yet",
    }[outcome];
    return { rows: [[RECORD_ROW, none], ...acceptedRows] };
  }
  return {
    verdict,
    rows: [
      [RECORD_ROW, `${verdict.event} · ${verdict.category}`],
      ["Caller, as the gateway names it", verdict.client],
      ...(verdict.keyType ? [["Key type", verdict.keyType]] : []),
      ...(typeof verdict.elapsedMs === "number" ? [["Guardrail time", `${verdict.elapsedMs} ms`]] : []),
      ...(verdict.rules.length ? [["Rules that fired", verdict.rules.join(", ")]] : []),
      ...verdict.frameworks.map((framework) => [framework.label, framework.identifiers.join(", ")]),
      ...(verdict.time ? [["Recorded at", verdict.time]] : []),
      ...acceptedRows,
    ],
  };
}

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
  const record = (Array.isArray(tokenEvents) ? tokenEvents : []).find((event) => event?.id === GATEWAY_RECORD_ID);
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
    // Display names: the event's labels (vertical-aware), else today's generic names.
    // Lane KEYS (chainLane) always come from the generic names so the views keep their columns.
    const from = event.fromLabel || chainActor(event.from);
    const to = event.toLabel || chainActor(event.to);
    const laneNames = { [chainLane(event.from)]: event.fromLabel, [chainLane(event.to)]: event.toLabel };
    const refused = event.status === "error";
    const origin = refused ? announced(event, index) : event;
    // What was said on this hop: the message of a call, or the text of a reply.
    const said = (event.kind === "card" ? "" : (refused ? origin?.detail : event.detail)) || "";
    const saidRow = (label) => (said ? [[label, said]] : []);
    const timing = typeof event.elapsedMs === "number" ? [["Round trip", `${event.elapsedMs} ms`]] : [];
    // Protocol facts the agent reported for this exchange, and when it reported them.
    const wire = event.wire || {};
    const row = (label, value) => (value || value === 0 ? [[label, String(value)]] : []);
    const atRow = row("Reported at, into the run", event.at);
    const registryRow = (name) => row("Agent Registry name", GATEWAY_CLIENT[name]);
    const routeRow = (name) => row("Route (Agentic App)", GATEWAY_APP[name]);
    const facts = [
      `${from} → ${to}`,
      ...(said ? [quote(said.length > 60 ? `${said.slice(0, 57)}…` : said)] : []),
      ...timing.map(([, value]) => value),
    ];
    const step = (suffix, title, lane, status, detail) => ({
      id: `${event.id}${suffix}`,
      title,
      lane,
      // The gateway lane reads "AI Gateway" on these steps (the shared lane key stays GATEWAY).
      laneLabel: lane === PRIVILEGE_GATEWAY_LANE ? "AI Gateway" : laneNames[lane],
      status,
      detail: { facts, rfcs: A2A_REFS, tokenEvent: event, ...detail },
    });

    // Discovery: the caller read the callee's A2A Agent Card before calling it.
    if (event.kind === "card") {
      const card = event.card;
      const skills = Array.isArray(card?.skills) ? card.skills : [];
      const ask = step("-discover", `Asks for ${to}'s A2A Agent Card`, chainLane(event.from), "done", {
        narrative: `Before calling, ${from} asked the Privilege gateway for ${to}'s A2A Agent Card, with its own agent key. The card is how one agent learns what another is, what it can do and how to talk to it, without that being hard-coded.`,
        kv: [
          ["From", from],
          ["About", to],
          ["Asked", "Privilege gateway"],
          ["Credential", `${from}'s own agent key (Bearer)`],
          ...row("Key presented", event.credential),
          ...registryRow(event.from),
          ["Path", "/.well-known/agent-card.json under the agent's route"],
          ...atRow,
        ],
        spec: SPEC.card,
        ...(event.request ? { request: { title: `A2A Agent Card request · ${from} → Privilege gateway`, text: event.request } } : {}),
      });
      if (!card) {
        return [ask, step("-card", "No A2A Agent Card returned", PRIVILEGE_GATEWAY_LANE, "done", {
          facts: ["A2A Agent Card", "not returned"],
          narrative: `${event.detail || "No Agent Card was returned"}. ${from} carries on: it calls the gateway's route for ${to} either way.`,
          kv: [["A2A Agent Card", "Not returned"], ...row("HTTP status", wire.status)],
          spec: SPEC.card,
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
          ...row("Agent version", card.version),
          ...((card.capabilities || []).length ? [["Capabilities", card.capabilities.join(", ")]] : []),
          ...((card.inputModes || []).length ? [["Accepts", card.inputModes.join(", ")]] : []),
          ...((card.outputModes || []).length ? [["Returns", card.outputModes.join(", ")]] : []),
          ...((card.skillDetails || []).length
            ? card.skillDetails.map((skill) => [`Skill: ${skill.name}`, [skill.description, skill.tags.length ? `tags: ${skill.tags.join(", ")}` : ""].filter(Boolean).join(" · ") || "no description"])
            : [["Skills", skills.length ? skills.join(", ") : "none listed"]]),
          ...((card.security || []).length ? [["Security the card declares", card.security.join("; ")]] : []),
          ...((card.security || []).length ? [["How this caller gets in instead", "With its agent key at the gateway; the gateway presents the credential set on the app"]] : []),
          ...(card.url ? [["Endpoint named in the card", card.url]] : []),
          ["Endpoint the caller uses", "The Privilege gateway's route for this agent"],
          ...row("HTTP status", wire.status),
        ],
        spec: SPEC.card,
        ...(event.response ? { response: { title: `A2A Agent Card · ${to}`, text: event.response } } : {}),
      })];
    }

    // Analyst <-> MCP tools (UC46): a tool call and its result.
    if (event.kind === "mcp-call" || event.kind === "mcp-result") {
      const isCall = event.kind === "mcp-call";
      const body = { title: `MCP tool ${isCall ? "call" : "result"} · ${from} → ${to}`, text: event.detail || "(empty)" };
      return [step(isCall ? "-mcp-call" : "-mcp-result", event.label || `${from} → ${to}`, chainLane(event.from), "done", {
        narrative: `${from} ${isCall ? "called a tool on" : "received a result from"} ${isCall ? to : from}${saying(event.detail)}`,
        kv: [["From", from], ["To", to], ["Protocol", "MCP tools/call"]],
        ...(isCall ? { request: body } : { response: body }),
      })];
    }

    if (event.kind === "result") {
      const response = { title: `A2A reply · ${from} → ${to}`, text: event.response || replyBody(said) };
      return [
        step("-reply", `Replies to ${to}`, chainLane(event.from), "done", {
          narrative: `${from} answered the A2A call${saying(said)} It sends the reply to the gateway, not to ${to}: it has no direct route to ${to}, so the gateway sees both halves of the conversation.`,
          kv: [
            ["From", from],
            ["To", to],
            ["Protocol", "A2A message, as a JSON-RPC 2.0 result"],
            ...row("Result kind and role", [wire.kind, wire.role].filter(Boolean).join(" / ")),
            ...row("A2A message id", wire.messageId),
            ...row("Handed on to", wire.delegatedTo && `${wire.delegatedTo}, by ${wire.delegatedBy || "the callee"}`),
            ...saidRow("Reply"),
          ],
          spec: SPEC.reply,
          response,
        }),
        step("-relay", "Relays the reply", PRIVILEGE_GATEWAY_LANE, "done", {
          narrative: `The reply from ${from} returned through the Privilege gateway on its way to ${to}. The gateway is the only path between the two agents, in both directions. We have confirmed it screens the call; we have not seen it inspect a reply.`,
          kv: [["Path", `${from} → Privilege gateway → ${to}`], ["Reply inspection", "Not observed in our tests of this gateway"], ...routeRow(event.from), ...timing],
          spec: SPEC.reply,
        }),
        step("-return", `Receives the reply from ${from}`, chainLane(event.to), "done", {
          narrative: `${to} received ${from}'s answer${saying(said)} ${to} can now use it: pass it up the chain, or return it to the person who asked.`,
          kv: [
            ["Received from", "Privilege gateway"],
            ["Originally from", from],
            ...row("HTTP status", wire.status),
            ...row("JSON-RPC id echoed", wire.rpcId),
            ...saidRow("Reply"),
            ...atRow,
          ],
          spec: SPEC.reply,
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
        ...row("Key presented", origin?.credential),
        ...registryRow(event.from),
        ...row("JSON-RPC request id", origin?.wire?.rpcId),
        ...row("A2A message id", origin?.wire?.messageId),
        ...row("Instruction to the callee", origin?.wire?.delegateTo && `delegateTo: ${origin.wire.delegateTo}`),
        ...(cardRead ? [["Described by", `A2A Agent Card “${cardRead.name}”, read before this call`]] : []),
        ...saidRow("Message"),
        ...row("Reported at, into the run", origin?.at),
      ],
      spec: SPEC.call,
      request: { title: `A2A message/send · ${from} → Privilege gateway`, text: origin?.request || sendBody(from, said) },
    });
    if (refused) {
      const reason = event.detail || "no reason given";
      const logged = gatewayRecord(record, event.from, /blocked by security policy/i.test(reason) ? "blocked" : "denied", event.to);
      return [call, step("-gateway", "Refuses the call", PRIVILEGE_GATEWAY_LANE, "error", {
        ...(logged.verdict ? { facts: [...facts, logged.verdict.category] } : {}),
        narrative: `The gateway or the agent behind it refused this call: ${reason}. The hand-off stopped here: ${to} did no work for this call, and ${from} received the refusal instead of an answer.${logged.verdict ? ` The gateway's own log records it as ${logged.verdict.category}.` : ""}`,
        kv: [
          ["Outcome", "Refused"],
          ["Reason", reason],
          ["Reached the next agent", "No"],
          ...row("HTTP status", wire.status),
          ...row("JSON-RPC error code", wire.errorCode),
          ...registryRow(event.from).map(([, value]) => ["Caller's Agent Registry name", value]),
          ...routeRow(event.to),
          ...timing,
          ...logged.rows,
          ...atRow,
        ],
        spec: SPEC.refused,
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
          ...registryRow(event.from).map(([, value]) => ["Caller's Agent Registry name", value]),
          ...routeRow(event.to),
          ...timing,
          ...gatewayRecord(record, event.from, "allowed", event.to).rows,
        ],
        spec: SPEC.gateway,
      }),
      step("-forward", `Receives the call from ${from}`, chainLane(event.to), "done", {
        narrative: `${to} received the call from the gateway, not from ${from} directly${saying(said)} It never sees ${from}'s agent key: a caller's key is never passed on, so a leaked key works at the gateway only.`,
        kv: [
          ["Received from", "Privilege gateway"],
          ["Originally from", from],
          ["Credential presented", `Whatever the gateway is set to present for ${to}; never ${from}'s key`],
          ...routeRow(event.to),
          ...saidRow("Message"),
        ],
        spec: SPEC.forward,
      }),
    ];
  });
}
