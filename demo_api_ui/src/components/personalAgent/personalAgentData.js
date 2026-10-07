// personalAgentData.js — content for the three Personal Agent pages under Diagrams:
//   /personal-agent-design        target design, Agent Gateway only
//   /personal-agent-dual-gateway  target design, Privilege first and Agent Gateway for the gaps
//   /personal-agent-review        why the original design was wrong, finding by finding
//
// The worked example is an airline loyalty assistant: a traveller chats with an AI that
// searches flights, builds the booking and hands it to the airline's own checkout to pay.
// It is a review of a diagram, not of code. Each finding says what the picture shows or omits.

export const GROUPS = {
  traveller: { label: "Traveller", bg: "var(--th-text-muted)" },
  llm: { label: "LLM", bg: "var(--th-text-muted)" },
  team: { label: "Built by the team", bg: "var(--th-status-success)" },
  ping: { label: "Ping identity and policy", bg: "var(--th-status-warning)" },
  priv: { label: "Privilege AI Gateway", bg: "var(--th-status-error)" },
  ag: { label: "Agent Gateway (PingGateway)", bg: "var(--th-status-info)" },
  existing: { label: "Existing airline systems", bg: "var(--th-border-strong)" },
};

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DOWN = { vertical: true };

// ---------------------------------------------------------------------------------------------
// Step write-ups. Each design lists its steps in order and points at the arrows (indexes into its
// edges array) that the step draws, so the Play bar and the write-up stay in sync.
// ---------------------------------------------------------------------------------------------
const TEXT = {
  ask: {
    title: "The traveller asks",
    what: "The traveller types a request in plain English in the web chat. Only text moves between the browser and the hosted chat agent.",
    why: "This is the one hop where no credential should travel. Keeping it text only means the browser never holds a token that the model could be tricked into using.",
    security:
      "The model only sees what the traveller typed and what tools return. With no credential on this hop, a hostile page or prompt has nothing to ask the model to reveal.",
    today: "Same as the original design.",
  },
  signin: {
    title: "Sign in and consent, with the token kept at home",
    what: "The traveller signs in at Ping with a passkey or MFA and sees a consent screen that names the assistant and the tool families it may use. Ping returns tokens to the chat agent's server side (the BFF), never to the browser page and never to the model.",
    why: "The agent needs proof of who the member is, and the member needs to know what they are handing over. Authorization code with PKCE and a pushed request (PAR) stop an attacker from swapping the request or stealing the code in transit.",
    security:
      "The member's token is issued to the chat agent and stays in the server session store, outside model context. A prompt-injected model cannot read it, forward it or embed it in a link.",
    today: "The sign-in token is good for about an hour and is forwarded to the MCP server as it is.",
  },
  model: {
    title: "Ask the model, with nothing to steal",
    what: "The chat agent sends the conversation and the list of available tools to Claude on Amazon Bedrock through the company LLM gateway. Claude replies with the tool it wants to call and the arguments.",
    why: "The model decides what to try, but it must not decide whether the attempt is allowed. Keeping credentials out of the prompt means the model can propose actions and nothing more.",
    security:
      "Tokens and capability links in tool results are redacted before the model sees them. That closes the main route for indirect prompt injection to steal authority: an instruction hidden in a web page or a fare rule has no credential to leak.",
    today: "The diagram says nothing about what the model sees. Tool results that carry tokens or links would flow straight back into context.",
  },
  exchange1: {
    title: "Exchange: the member, via this agent, for this tool",
    what: "For each capability the chat agent asks Ping for a fresh token. It presents the member's token as the subject and its own key-signed assertion as the actor (RFC 8693 token exchange). Ping returns a token for the MCP server only, narrowed to one tool family, valid for minutes, and naming both the member and the agent.",
    why: "A token that says who the member is and which agent is acting lets every later hop decide, log and revoke correctly. A short life, one audience and a narrow scope cap what a stolen token can do.",
    security:
      "Delegation, not impersonation: the agent never becomes the member. A hijacked agent holds a five minute, single-tool token instead of the member's whole session, and switching off the agent's identity stops it without signing the member out.",
    today: "No exchange and no agent identity. One sign-in token serves all 16 tools.",
  },
  entryTarget: {
    title: "Every AI client enters through the Agent Gateway",
    what: "The chat agent calls the tool through the Agent Gateway with its per-tool token and a proof signed by the agent's key. Desktop AI apps use the same door with their own registered identity. The MCP server accepts traffic from nowhere else.",
    why: "One enforcement point means a new tool or a new client never adds a new place to get security right. Checking audience, scope and the key proof in one place stops a token meant for one service being replayed at another.",
    security:
      "A stolen token is useless without the agent's key, and a token for the wrong audience is rejected before it reaches a tool. A malicious desktop plugin has to present its own identity, which can be allowed only the tools it needs.",
    today: "The chat agent and any other MCP-capable app call the MCP server directly with the same member token.",
  },
  entryDual: {
    title: "Every AI client enters through Privilege",
    what: "Privilege AI Gateway is the single front door. It validates the token, recognises the member and the agent as a non-human identity and allows or denies on token claims such as client id, actor, scope and audience. It applies the tool allowlist for that client, adds just-in-time approval and AI guardrails, and records the session. The token passes through untouched so the actor chain survives.",
    why: "Desktop agents and hosted agents both need one governed entry point that knows which human is behind each session and can pause a sensitive tool for approval. Passing the token through keeps the evidence of who delegated what intact for every later hop.",
    security:
      "Guardrails look for prompt injection, poisoned tool descriptions and data leaving in tool results before they reach the model or a tool. Per-client allowlists mean a compromised plugin only reaches the tools its identity was granted.",
    today: "No front door. Every client calls the MCP server directly.",
  },
  gatewayGap: {
    title: "Agent Gateway fills what Privilege does not do yet",
    what: "PingGateway's Agent Gateway module sits behind Privilege only for the gaps. It validates the token's signature and audience as the resource server, publishes protected-resource metadata so MCP clients can discover the right authorization server, and checks sender constraint with certificate-bound tokens today.",
    why: "Privilege passes the token through, so something must still prove the token is genuine, meant for this server and bound to the caller. Keeping this duty in a gateway that already does it avoids waiting on a roadmap item.",
    security:
      "Verification happens before any tool code runs, and it fails closed: a bad signature, wrong audience or missing key proof is a denial, not a warning. As Privilege takes over each duty, this box is removed one duty at a time.",
    today: "No resource-server checks in front of the MCP server.",
  },
  policy: {
    title: "Policy decides each call, not the prompt",
    what: "The gateway sends the member, the agent, the client, the tool, its arguments and any authorization details to a policy engine (PingOne Authorize). Search and fares return permit. Adding insurance, redeeming miles or changing a profile returns step-up. Deny, timeout or an unreachable engine all fail closed.",
    why: "Knowing who is signed in does not say whether this action is allowed. Rules such as amount limits and consent thresholds belong in a policy engine the model cannot edit, where they can be changed without redeploying code.",
    security:
      "An instruction injected into a web page cannot talk its way past a rule. The decision depends on the arguments of the real call, so \"add insurance\" is judged on what is being bought and for how much.",
    today: "\"Checks the sign-in\" answers who, not whether.",
  },
  mcp: {
    title: "The MCP server trusts only its own audience",
    what: "The MCP server accepts traffic only from the gateway, enforced at the network level, and still validates the token against its own audience and the scope of the tool. It never forwards the inbound token anywhere.",
    why: "Defence in depth: if a gateway is misconfigured or bypassed, the server itself still refuses tokens that were not issued for it. The MCP specification forbids a server from accepting or passing on tokens meant for something else.",
    security:
      "This stops the confused deputy attack, where a server holding broad authority is tricked into using it for a caller who should not have it. Tool poisoning cannot widen what a token allows.",
    today: "Any caller holding the sign-in token is accepted.",
  },
  exchange2: {
    title: "Exchange again: a nested actor chain toward the facade",
    what: "The MCP server, acting as its own client, exchanges the token it received for one meant for the facade. The actor chain nests: the MCP server acting for the chat agent acting for the member. Scope can only narrow at each hop.",
    why: "Each hop gets a token minted for it, so no hop can reuse a credential issued for another. The nested chain keeps the full history of who delegated to whom.",
    security:
      "A compromise of one hop yields a token that works at the next hop only for what that hop was allowed. Investigators can read the whole chain from one token.",
    today: "The session service turns the raw sign-in token into a website session.",
  },
  facade: {
    title: "A member session that knows an agent is acting",
    what: "The facade checks audience and the actor chain. The session service mints the member session from this delegated token, tags it with the actor chain and limits it to the tool family. The facade keeps its existing guards: no double-adds, price re-checks and result verification.",
    why: "The airline's own systems must be able to tell \"member X through agent Y\" from \"member X clicking\". Limiting the session to the tool family means search access cannot be turned into purchase access.",
    security:
      "Fraud and abuse controls can treat agent traffic differently from human traffic. A hijacked agent cannot reach cart or loyalty actions the session was never scoped for.",
    today: "The session is the same kind the website uses, with the member's full authority across all tools.",
  },
  ciba: {
    title: "Approval bound to the purchase",
    what: "When policy returns step-up, Ping pushes an approval request to the traveller's registered phone naming the product, the amount and the cart. Approval mints a single-use token that carries those details. No answer within the window counts as a denial and the agent stops.",
    why: "Money and loyalty actions need a human decision that cannot be reused for a different action. Showing the exact purchase on the approving device prevents tap-through approvals of something else.",
    security:
      "The model cannot approve its own request, and a captured approval cannot be replayed for a second purchase. The decision to ask lives in policy, so it cannot be skipped by rewording the prompt.",
    today: "Cart changes happen with no approval until checkout.",
  },
  checkout: {
    title: "Checkout on the airline site, with a link that is not a key",
    what: "The MCP server creates a cart reference with a five minute, single-use expiry. The checkout page completes only in a browser that already holds the member's session, or after a step-up at landing. Payment happens there and the model never sees a card.",
    why: "Payment is the highest-risk step and the airline already runs it well. A reference that carries no session cannot be misused if it leaks through chat history or logs.",
    security:
      "The link proves nothing by itself. Someone who intercepts it still has to be the signed-in member, so injection or log access does not turn into a purchase.",
    today: "A single-use link lands the traveller signed in, which makes the URL a session credential.",
  },
  auditTarget: {
    title: "One record per action, joinable end to end",
    what: "Policy verdicts, gateway calls, Ping exchanges and facade calls land in the security log keyed by token id. Every action reconstructs as member, agent, client, tool, arguments, verdict and approval. The agent has no write path to the log.",
    why: "Without attribution, fraud teams and incident responders cannot separate the agent from the human or prove what was approved. Logs written by the agent can be edited by a compromised agent.",
    security:
      "Detection and response depend on it: unusual tool sequences, mass redemptions and blocked injections are all visible as agent activity, and each can be traced to one member and one agent.",
    today: "The airline sees ordinary member traffic and cannot tell agent from human.",
  },
  auditDual: {
    title: "Two logs, one record",
    what: "Privilege records the session and tool activity. The Agent Gateway records verdicts and the actor chain. Both carry the token id, so every action reconstructs as member, agent, client, tool, arguments, verdict and approval. The agent has no write path to either store.",
    why: "Two gateways mean two evidence trails. Joining them on one identifier gives investigators a single timeline and keeps each gateway's own record independent.",
    security:
      "An attacker would have to tamper with two stores the agent cannot write to. Guardrail hits at Privilege and policy denials at the Agent Gateway line up on the same token id.",
    today: "The airline sees ordinary member traffic and cannot tell agent from human.",
  },
};

const step = (key, edges, overrides = {}) => ({ key, edges, ...TEXT[key], ...overrides });

// ---------------------------------------------------------------------------------------------
// Design 1: Agent Gateway only
// ---------------------------------------------------------------------------------------------
const TARGET_NODES = [
  N("signin", "ping", "Ping sign-in", ["OIDC code + PKCE + PAR", "passkey or MFA, consent screen"], 290, 0),
  N("other", "traveller", "Desktop AI apps", ["Claude Desktop, Claude Code", "each with its own identity"], 580, 0),
  N("token", "ping", "Ping token service", ["RFC 8693 token exchange", "adds the actor, binds the key", "CIBA approval"], 1160, 0),
  N("phone", "traveller", "Traveller's phone", ["registered MFA device", "push names the exact purchase"], 870, 0),
  N("traveller", "traveller", "Traveller", ["web browser, plain English"], 0, 200),
  N("chat", "team", "Hosted chat agent", ["registered agent identity", "BFF holds the session", "key kept in a vault"], 290, 200),
  N("agw", "ag", "Agent Gateway", ["PingGateway MCP module", "aud, scope, key proof", "tool allowlist per client", "audit on every call"], 580, 200),
  N("mcp", "team", "Loyalty MCP server", ["accepts only its own audience", "16 tools, its own client", "exchanges toward the facade"], 870, 200),
  N("facade", "team", "Facade", ["checks aud and actor chain", "session minted from the token", "price re-check, cart guards"], 1160, 200),
  N("checkout", "existing", "Airline checkout page", ["cart-bound link, 5 min, once", "needs the member session", "payment happens here only"], 0, 400),
  N("claude", "llm", "Claude on Bedrock", ["via the LLM gateway", "no credentials in context"], 290, 400),
  N("policy", "ping", "Policy engine", ["PingOne Authorize", "member, agent, tool, arguments", "permit, deny or step-up"], 580, 400),
  N("audit", "team", "Audit and SIEM", ["gateway audit + actor chain", "joined on token id"], 870, 400),
  N("services", "existing", "Airline services", ["shopping, cart, seats, bags", "loyalty, trip insurance"], 1160, 400),
];
const TARGET_EDGES = [
  E("traveller", "chat", "asks, replies"), // 0
  E("traveller", "signin", "signs in, consents"), // 1
  E("signin", "chat", "sign-in token, kept in the BFF", DOWN), // 2
  E("chat", "claude", "prompt and tool list, no tokens", DOWN), // 3
  E("token", "chat", "exchange: token for one tool", DOWN), // 4
  E("chat", "agw", "tool call"), // 5
  E("other", "agw", "own identity", { vertical: true, dashed: true }), // 6
  E("agw", "policy", "decide, with arguments", DOWN), // 7
  E("agw", "mcp", "permitted"), // 8
  E("token", "mcp", "exchange: token for the facade", DOWN), // 9
  E("mcp", "facade", "facade token"), // 10
  E("facade", "services", "member session + actor", DOWN), // 11
  E("token", "phone", "approval push"), // 12
  E("traveller", "checkout", "opens the cart-bound link", DOWN), // 13
  E("agw", "audit", "verdicts + actor chain"), // 14
];
const TARGET_STEPS = [
  step("ask", [0]),
  step("signin", [1, 2]),
  step("model", [3]),
  step("exchange1", [4]),
  step("entryTarget", [5, 6]),
  step("policy", [7]),
  step("mcp", [8]),
  step("exchange2", [9]),
  step("facade", [10, 11]),
  step("ciba", [12]),
  step("checkout", [13]),
  step("auditTarget", [14]),
];

// ---------------------------------------------------------------------------------------------
// Design 2: Privilege first, Agent Gateway for the gaps
// ---------------------------------------------------------------------------------------------
const DUAL_NODES = [
  N("signin", "ping", "Ping sign-in", ["OIDC code + PKCE + PAR", "passkey or MFA, consent screen"], 290, 0),
  N("other", "traveller", "Desktop AI apps", ["Claude Desktop, Claude Code", "each with its own identity"], 580, 0),
  N("token", "ping", "Ping token service", ["RFC 8693 token exchange", "adds the actor, binds the key", "CIBA approval"], 1160, 0),
  N("phone", "traveller", "Traveller's phone", ["registered MFA device", "push names the exact purchase"], 870, 0),
  N("traveller", "traveller", "Traveller", ["web browser, plain English"], 0, 200),
  N("chat", "team", "Hosted chat agent", ["registered non-human identity", "BFF holds the session", "key kept in a vault"], 290, 200),
  N("priv", "priv", "Privilege AI Gateway", ["front door for every AI client", "claims-based allow per client", "JIT approval, guardrails, logs", "token passed through intact"], 580, 200),
  N("agw", "ag", "Agent Gateway", ["PingGateway MCP module", "aud, signature, metadata", "sender-constraint check", "removed as Privilege catches up"], 870, 200),
  N("mcp", "team", "Loyalty MCP server", ["accepts only its own audience", "16 tools, its own client", "exchanges toward the facade"], 1160, 200),
  N("facade", "team", "Facade", ["checks aud and actor chain", "session minted from the token", "price re-check, cart guards"], 1160, 400),
  N("checkout", "existing", "Airline checkout page", ["cart-bound link, 5 min, once", "needs the member session", "payment happens here only"], 0, 400),
  N("claude", "llm", "Claude on Bedrock", ["via the LLM gateway", "no credentials in context"], 290, 400),
  N("policy", "ping", "Policy engine", ["PingOne Authorize", "member, agent, tool, arguments", "permit, deny or step-up"], 870, 400),
  N("audit", "team", "Audit and SIEM", ["Privilege logs + gateway audit", "joined on token id"], 580, 400),
  N("services", "existing", "Airline services", ["shopping, cart, seats, bags", "loyalty, trip insurance"], 1160, 600),
];
const DUAL_EDGES = [
  E("traveller", "chat", "asks, replies"), // 0
  E("traveller", "signin", "signs in, consents"), // 1
  E("signin", "chat", "sign-in token, kept in the BFF", DOWN), // 2
  E("chat", "claude", "prompt and tool list, no tokens", DOWN), // 3
  E("token", "chat", "exchange: token for one tool", DOWN), // 4
  E("chat", "priv", "tool call"), // 5
  E("other", "priv", "own identity", { vertical: true, dashed: true }), // 6
  E("priv", "agw", "passthrough"), // 7
  E("agw", "policy", "decide, with arguments", DOWN), // 8
  E("agw", "mcp", "permitted"), // 9
  E("token", "mcp", "exchange: token for the facade", DOWN), // 10
  E("mcp", "facade", "facade token", DOWN), // 11
  E("facade", "services", "member session + actor", DOWN), // 12
  E("token", "phone", "approval push"), // 13
  E("traveller", "checkout", "opens the cart-bound link", DOWN), // 14
  E("agw", "audit", "verdicts + actor chain"), // 15
];
const DUAL_STEPS = [
  step("ask", [0]),
  step("signin", [1, 2]),
  step("model", [3]),
  step("exchange1", [4]),
  step("entryDual", [5, 6]),
  step("gatewayGap", [7]),
  step("policy", [8]),
  step("mcp", [9]),
  step("exchange2", [10]),
  step("facade", [11, 12]),
  step("ciba", [13]),
  step("checkout", [14]),
  step("auditDual", [15]),
];

export const DESIGNS = {
  target: {
    path: "/personal-agent-design",
    eyebrow: "Personal agent · target design",
    title: "A personal AI agent, secured end to end",
    intro:
      "The same product shape as the original assistant, with one change in principle: every hop past the chat agent carries a token minted for that hop that names the member and the agent, instead of the member's own session. An Agent Gateway enforces it in front of the MCP server. Press Simulate to walk the arrows; the write-up below explains each step.",
    ariaLabel:
      "Target design for a personal AI agent. The traveller signs in at Ping, the hosted chat agent exchanges tokens at the Ping token service, calls tools through the Agent Gateway, which consults a policy engine and forwards to the MCP server. The MCP server exchanges again for the facade, which reaches the airline services. Sensitive actions trigger an approval push to the traveller's phone.",
    nodes: TARGET_NODES,
    edges: TARGET_EDGES,
    steps: TARGET_STEPS,
    height: 640,
    assumptions: [
      "Ping issues the delegated tokens. PingOne supports RFC 8693 delegation with the actor claim; PingFederate 13.1 adds per-client DPoP. DPoP on the PingOne authorization server is not documented, so the sender constraint shown relies on certificate-bound tokens (RFC 8705) through PingGateway until it is.",
      "The Agent Gateway is PingGateway's MCP module: it validates audience, serves protected-resource metadata and can call PingOne Authorize through its authorization filter. Its interface stability is marked as evolving, so plan for configuration changes on upgrade.",
      "Approval uses CIBA with a push to a registered device. The binding message and authorization details must name the exact purchase, otherwise the approval protects nothing.",
      "Desktop AI apps are treated as separate registered identities. If they cannot present a key-bound token, route them through Privilege as in the dual gateway design.",
    ],
  },
  dual: {
    path: "/personal-agent-dual-gateway",
    eyebrow: "Personal agent · Privilege first",
    title: "Privilege first, Agent Gateway for the gaps",
    intro:
      "Privilege AI Gateway is the single front door for every AI client. It identifies the agent as a non-human identity, allows or denies on token claims and passes the token through intact. PingGateway's Agent Gateway module sits behind it only for what Privilege does not do yet, and is removed duty by duty as Privilege catches up. Press Simulate to walk the arrows.",
    ariaLabel:
      "Dual gateway design for a personal AI agent. The hosted chat agent and desktop AI apps enter through the Privilege AI Gateway, which passes the token through to the Agent Gateway. The Agent Gateway consults a policy engine and forwards to the MCP server, which exchanges for the facade and reaches the airline services. Privilege logs and gateway audit both feed the security log.",
    nodes: DUAL_NODES,
    edges: DUAL_EDGES,
    steps: DUAL_STEPS,
    height: 640,
    assumptions: [
      "Privilege passthrough and claim-based policy are available through the non-human identity route today and native in the next release, as Ping told the team. Neither is in the public documentation, so treat them as assumptions to confirm.",
      "Retire the Agent Gateway one duty at a time. Check that Privilege can (1) make decisions on request arguments, (2) match authorization details to the call, (3) validate or forward the DPoP proof, (4) verify signature and audience and fail closed, and (5) publish protected-resource metadata. When all five pass, Privilege is the only gateway and the diagram loses a box.",
      "Privilege AIGuard guardrails, the agent registry and virtual keys are visible in the console but not yet in public documentation. Treat them as preview features.",
      "Everything after the gateways is unchanged from the first design: agent identity, exchange at each hop, an MCP server that trusts only its own audience, bound approval, a cart-bound checkout link and one audit record per action.",
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// The review: the original design, its holes, and where each is closed
// ---------------------------------------------------------------------------------------------
export const REVIEW_GROUPS = {
  risk: { label: "Carries a finding", bg: "var(--th-status-error)" },
  ok: { label: "Done well", bg: "var(--th-status-success)" },
  neutral: { label: "No finding", bg: "var(--th-border-strong)" },
};

export const ORIGINAL_NODES = [
  N("signin", "neutral", "Ping sign-in", ["issues a sign-in token", "good for about an hour (F7)"], 290, 0),
  N("other", "risk", "Other AI apps", ["same MCP, same tools", "no entry control (F1, F6)"], 580, 0),
  N("traveller", "neutral", "Traveller", ["web browser, plain English"], 0, 200),
  N("chat", "risk", "Hosted chat agent", ["no identity of its own (F1)", "runs on a laptop (F8)"], 290, 200),
  N("mcp", "risk", "Loyalty MCP server", ["checks the sign-in on every call", "no policy, no approval (F3, F4)"], 580, 200),
  N("facade", "ok", "Facade", ["no double-adds, price re-checks", "verifies every cart change"], 870, 200),
  N("services", "neutral", "Airline services", ["see ordinary member traffic", "no audit attribution (F9)"], 1160, 200),
  N("checkout", "risk", "Airline checkout page", ["payment stays here: done well", "link lands signed in (F5)"], 0, 400),
  N("claude", "risk", "Claude on Bedrock", ["through a central LLM gateway: good", "tool results unshown (F10)"], 290, 400),
  N("session", "risk", "Session service", ["token becomes a full member", "session across all tools (F2)"], 580, 400),
];
export const ORIGINAL_EDGES = [
  E("traveller", "chat", "asks, replies"),
  E("signin", "chat", "sign-in token", DOWN),
  E("chat", "claude", "what should I do next", DOWN),
  E("chat", "mcp", "tool calls + same token"),
  E("other", "mcp", "same tools, no gateway", { vertical: true, dashed: true }),
  E("mcp", "session", "token becomes a member session", DOWN),
  E("mcp", "facade", "calls with that session"),
  E("facade", "services", "existing systems", DOWN),
  E("traveller", "checkout", "opens the checkout link", DOWN),
];

export const SEVERITY = { critical: "Critical", high: "High", medium: "Medium" };

// fix: { label, path, steps }: where the new designs close the finding.
export const FINDINGS = [
  {
    id: "F1",
    severity: "critical",
    title: "The agent has no identity of its own",
    shows:
      "Only the traveller's sign-in token appears. The hosted chat agent, Claude Desktop, Claude Code and any other MCP-capable app present the same credential.",
    hole:
      "Every action looks like the member acting. Nothing can attribute, rate limit, restrict or revoke one agent without affecting the member or all agents.",
    attack:
      "A compromised plugin or a malicious desktop app reuses the member's token against the MCP server. The logs show the member. Incident response cannot tell which client did it, and the only remedy is signing the member out everywhere.",
    practice: [
      "RFC 8693 delegation with the act claim, not impersonation",
      "OWASP Top 10 for Agentic Applications: ASI03 Identity and Privilege Abuse",
      "IETF WIMSE AI Identity Management System draft: agents as workloads with their own identifiers",
      "Vendor guidance from Microsoft Entra Agent ID and Okta: a distinct identity per agent",
    ],
    fix: "Each agent is a registered identity. Exchange adds it as the actor.",
    steps: "Steps 4 and 5",
  },
  {
    id: "F2",
    severity: "critical",
    title: "The sign-in token becomes a full website session",
    shows:
      "Arrow 5 turns the sign-in token into a member session, \"the same kind of session the website uses\". The facade then acts with it across all 16 tools.",
    hole:
      "This is token passthrough and a confused deputy. The MCP server transits a credential that was not issued for it, and the session carries the member's whole authority whichever tool is running.",
    attack:
      "A prompt-injected agent calls \"add trip insurance\" in a conversation that only needed search. Nothing in the session limits it, because the session is the member.",
    practice: [
      "MCP Authorization 2026-07-28: servers must validate audience and must not accept or pass on tokens issued for other resources",
      "RFC 8707 resource indicators: one audience per token",
      "RFC 9700 OAuth 2.0 Security Best Current Practice",
      "OWASP LLM Top 10 2026: LLM03 Excessive Agency",
    ],
    fix: "The MCP server exchanges for a facade-only token. The session service mints a scoped session from it.",
    steps: "Steps 9 and 10",
  },
  {
    id: "F3",
    severity: "high",
    title: "Authentication without authorization",
    shows:
      "\"Checks the sign-in on every call\" is the only gate between the model and 16 tools, including cart, insurance and miles.",
    hole:
      "Authentication says who. Nothing decides per call whether this agent may do this action with these arguments, so there is nowhere to put amount limits, consent thresholds or per-client tool rules.",
    attack:
      "A hidden instruction in a fare rule says to redeem miles for an upgrade. The call passes because the member is signed in.",
    practice: [
      "A policy decision point outside the model that fails closed, such as PingOne Authorize",
      "OWASP Agentic ASI02 Tool Misuse and Exploitation",
      "Least privilege per action, not per agent",
    ],
    fix: "A policy engine sees member, agent, tool and arguments on every call.",
    steps: "Step 7",
  },
  {
    id: "F4",
    severity: "high",
    title: "Human approval happens only at checkout",
    shows:
      "Payment is confirmed on the airline site. Cart changes, insurance and miles use before that point need no approval.",
    hole:
      "Consequential, sometimes irreversible changes are committed by the agent with no human decision bound to them. Payment is a strong control but it covers only the last step.",
    attack:
      "The agent adds trip insurance and paid seats to the cart. The traveller reviews a crowded cart at checkout and approves out of habit. A miles redemption made earlier cannot be undone.",
    practice: [
      "OpenID CIBA for out-of-band approval on the user's own device",
      "RFC 9396 rich authorization requests: approval names the exact transaction",
      "RFC 9470 step-up authentication challenge",
      "OWASP Agentic ASI09 Human-Agent Trust Exploitation",
    ],
    fix: "Policy returns step-up. The traveller approves the specific purchase on their phone.",
    steps: "Step 11",
  },
  {
    id: "F5",
    severity: "high",
    title: "The checkout link is a bearer credential",
    shows: "A single-use link \"lands the traveller signed in\".",
    hole:
      "A URL that creates a session is a credential. It passes through the model's context, Bedrock logs, chat history and browser history.",
    attack:
      "The link leaks through an injected prompt or a log. Whoever opens it first is the member. Single use only helps when the attacker is second.",
    practice: [
      "RFC 9700: keep credentials out of URLs",
      "Bind the link to a cart and require an existing session or a step-up on landing",
      "Short expiry measured in minutes",
    ],
    fix: "The link carries a cart reference, not a session. It completes only for the signed-in member.",
    steps: "Step 12",
  },
  {
    id: "F6",
    severity: "high",
    title: "Other AI apps reach the tools with no controlled entry",
    shows: "A dashed arrow runs from \"Other AI apps\" straight to the MCP server, using the same tools.",
    hole:
      "No gateway, no client registration, no per-client tool allowlist and no published resource metadata. Any MCP-capable client holding a member token reaches all 16 tools.",
    attack:
      "A malicious desktop plugin enumerates the tools and calls the destructive ones. It can also feed poisoned tool descriptions back into the model.",
    practice: [
      "MCP Authorization 2026-07-28: protected resource metadata (RFC 9728) and audience validation",
      "One gateway as the single enforcement point",
      "OWASP Agentic ASI04 Agentic Supply Chain",
    ],
    fix: "Every client enters through a gateway with its own identity and allowlist.",
    steps: "Steps 5 and 6",
  },
  {
    id: "F7",
    severity: "medium",
    title: "Hour-long bearer token with no sender constraint",
    shows: "The sign-in token is \"good for about an hour\" and is a plain bearer.",
    hole:
      "A token copied from memory, a log or a laptop works from anywhere for an hour, and nothing proves who is presenting it.",
    attack: "Malware on the laptop lifts the token from the chat agent's session and replays it from another machine.",
    practice: [
      "RFC 9449 DPoP or RFC 8705 certificate-bound tokens",
      "Access token lifetime of five to fifteen minutes",
    ],
    fix: "Per-call tokens last minutes and are bound to the agent's key.",
    steps: "Steps 4 and 6",
  },
  {
    id: "F8",
    severity: "medium",
    title: "The host is a laptop",
    shows: "\"Runs on a laptop today\", with an honest note that hosting is undecided.",
    hole:
      "The laptop holds every traveller's token and, later, the agent's credentials. There is no vault, no isolation and no network boundary around the tool calls.",
    attack: "Anyone with access to the machine or its backups reads every active member's session.",
    practice: [
      "Secrets in a vault and the agent's private key never in model context",
      "Host and gateway as separate trust boundaries",
    ],
    fix: "A server-side host keeps the session. The key lives in a vault.",
    steps: "Steps 2 and 4",
  },
  {
    id: "F9",
    severity: "medium",
    title: "No audit trail that separates agent from human",
    shows: "No audit or security log appears. The airline's services see ordinary member traffic.",
    hole:
      "Fraud, analytics and incident response cannot tell an agent from the member, and cannot reconstruct who delegated what.",
    attack:
      "A burst of miles redemptions looks like a member behaving unusually. Nobody can see that one agent session made them.",
    practice: [
      "Nested actor chain and token id correlation across hops",
      "Logs written by the gateways and the authorization server, never by the agent",
      "OWASP Agent Control Standard hooks for tool-call inspection",
    ],
    fix: "Every hop logs member, agent, tool, verdict and approval against one token id.",
    steps: "Step 13",
  },
  {
    id: "F10",
    severity: "medium",
    title: "Nothing shows what the model can see",
    shows: "Claude \"decides which tools to use\". The diagram does not show what tool results contain.",
    hole:
      "If tool results can carry tokens or links, an indirect prompt injection has something to exfiltrate. The picture gives no assurance that it cannot.",
    attack: "A hostile fare note instructs the model to repeat the checkout link into an external form. The link was in context.",
    practice: [
      "Redact secrets and capability links before anything reaches the model",
      "Treat every tool result as untrusted input",
      "OWASP LLM Top 10 2026: LLM01 Prompt Injection; Agentic ASI01 Agent Goal Hijack",
    ],
    fix: "Tokens and links are redacted from model context.",
    steps: "Step 3",
  },
];

// The five controls the architecture review treats as non-negotiable.
export const SCORECARD = [
  {
    control: "Two identities, one chain",
    original: "fail",
    note: "One member token. No agent identity and no actor claim.",
    findings: "F1, F2",
  },
  {
    control: "Least privilege per action",
    original: "fail",
    note: "One token and one session cover all 16 tools.",
    findings: "F2, F3, F6",
  },
  {
    control: "Short-lived, sender-constrained tokens",
    original: "fail",
    note: "About an hour, plain bearer.",
    findings: "F7, F8",
  },
  {
    control: "Human approval bound to the transaction",
    original: "partial",
    note: "Payment is approved on the airline site, but earlier cart and loyalty changes are not.",
    findings: "F4, F5",
  },
  {
    control: "Policy and enforcement outside the model",
    original: "partial",
    note: "The facade guards cart changes, but there is no policy decision and no gateway.",
    findings: "F3, F6, F9, F10",
  },
];

export const DONE_WELL = [
  "Payment stays on the airline's own checkout, so the model never sees a card number.",
  "The member session is checked on every tool call rather than once at sign-in.",
  "The facade re-checks prices, refuses double-adds and verifies each cart change, which is real defence against a model that repeats itself.",
  "A central LLM gateway sits between the application and the LLM provider.",
  "The diagram is honest about its limits: dev environment, test accounts, laptop hosting and the one-hour token are all stated.",
];
