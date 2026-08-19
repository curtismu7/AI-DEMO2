// Pure derivation: merged trace evidence -> ordered step model for the
// TokenChainTraceRail. No I/O, no store access — unit-testable in isolation.

import { EDU } from "../../components/education/educationIds";
import { isPause } from "./pauseObligation";

const LANES = {
  website: "BROWSER", signin: "PINGONE", prompt: "CHAT", agent: "AGENT",
  "tools-list-challenge": "MCP", "tools-list": "MCP", llm: "LLM",
  "agent-token": "BFF", "exchange-1": "BFF", exchange: "BFF", authorize: "AUTHZ", stepup: "AUTHZ",
  "intent-binding": "AUTHZ",
  gateway: "GATEWAY", "api-key-swap": "GATEWAY",
  "tools-call-challenge": "MCP", mcp: "MCP", api: "API",
  database: "DATA", reply: "LLM",
};

// The delegation-to-MCP portion of the pipeline, in order. Not derivable from
// LANES (exchange shares the BFF lane with agent-token), so declared explicitly
// here alongside the rest of the step-model vocabulary — the MCP tab and the
// rail's MCP-step badge both consume it, so a step-id rename stays a one-file fix.
// The MCP route as a viewer means it: the hops that carry or serve the tool
// call. `exchange` was in this list because the RFC 8693 exchange mints the
// MCP-audience token — true, but it made the MCP view open with a token
// exchange rather than a tool call, which is not what "MCP" says on the tab.
// The exchange still has its own step, its own card and its own place in the
// chain; it is just not counted as an MCP call.
// `tools-list-challenge` is discovery, not invocation, so it stays out of this
// list for the same reason `exchange` did — the MCP tab must open on the tool
// call. `tools-call-challenge` IS part of the call: it is the first of the two
// requests that invocation actually makes.
// Hops that belong to the TOOL CALL. The MCP lifecycle handshake is not one of
// them: traced live 2026-08-18, the gateway opens a session, lists tools and
// closes it, all before a tool call exists — so initialize /
// notifications/initialized sit with discovery on the spine, not on the
// tool-call branch. TokenTopologyPanel partitions spine vs branch off this
// list, so leaving them here drew the session as part of the invocation.
export const MCP_STEP_IDS = ["gateway", "api-key-swap", "tools-call-challenge", "mcp", "api", "database"];

const TITLES = {
  website: "Website — browser / UI app",
  signin: "Sign-in — User Token acquired",
  prompt: "Chatbot — prompt sent",
  agent: "Agent service receives request",
  // The node label is the part before the em dash, so the challenge legs read
  // as their own hop ("tools/list 401") while the authorized legs keep the
  // labels the topology diagram already used.
  "tools-list-challenge": "tools/list 401 — no token, gateway challenges",
  "tools-list": "tools/list — tool discovery, token accepted",
  llm: "LLM — reasoning & tool choice",
  "agent-token": "Agent identity token",
  // Named, not numbered: "Token exchange" is the node label the topology
  // diagram and its tests have always used for the delegated exchange, so the
  // NEW hop gets the distinct name rather than renumbering the existing one.
  "exchange-1": "Agent token narrowing — exchange #1",
  exchange: "Token exchange — delegation",
  authorize: "PingOne Authorize — policy decision",
  stepup: "Step-up required — HITL / MFA",
  "intent-binding": "Intent Binding Check",
  gateway: "Agent Gateway — token validated",
  "api-key-swap": "API-key path — credential swap",
  "tools-call-challenge": "tools/call 401 — no token, gateway challenges",
  mcp: "MCP server — tool executes, token accepted",
  api: "Resource server — backend app",
  database: "Database — data query",
  reply: "LLM composes reply → chat",
};

// What each hop does — always shown when a step is expanded, even before its
// live evidence arrives, so no step ever opens to a blank body. The live
// request / response / claims are layered on top by buildTraceSteps whenever
// the matching trace evidence exists.
const NARRATIVES = {
  website: "The browser hosts the UI and never holds a bearer token. It relies on the secure, HttpOnly session cookie from the BFF.",
  signin: "User authenticated via OIDC Authorization Code + PKCE. The BFF holds the User Token server-side — it never reaches the browser.",
  prompt: "The browser sends only the message — no tokens; the session cookie identifies the user to the BFF.",
  agent: "BFF forwards to the agent. The agent loads conversation history and the gateway tool catalog (with required scopes), then prepares the LLM call.",
  "tools-list-challenge": "The first tools/list goes out with NO Authorization header. The gateway refuses it with 401 and a WWW-Authenticate challenge that names its realm and points at its RFC 9728 metadata — that pointer is how a client that arrives holding nothing learns which authorization server to go to.",
  "tools-list": "The second tools/list carries the agent token. PingOne Authorize filters the catalog per vertical and scope, so the model is only ever shown tools this caller may actually invoke.",
  llm: "The agent sends the conversation to the LLM. The model returns a tool call — it never sees or holds any OAuth token.",
  "agent-token": "BFF obtains a client-credentials token — the agent's own identity, separate from the user's.",
  "exchange-1": "Two-exchange mode only. The first RFC 8693 call narrows the agent's OWN token before any user delegation happens, so the second exchange starts from least privilege rather than from the agent's full client-credentials scope.",
  exchange: "The delegated exchange. BFF exchanges subject (user) + actor (agent) for one delegated token: proof the agent acts FOR this user. Scope narrows to what the tool needs; audience binds to the gateway.",
  authorize: "Before any tool runs, the BFF asks PingOne Authorize whether THIS user + agent may perform THIS action.",
  stepup: "The policy demanded step-up: the human must approve (HITL/CIBA/MFA) before the tool call proceeds.",
  "intent-binding": "Verifies the requested transfer against the declared RFC 9396 authorization_details cap.",
  gateway: "Ping Agent Gateway checks the delegated token before anything reaches the MCP server: introspection, audience binding, scope, delegation chain.",
  "api-key-swap": "Path A (api_key): the gateway drops the OAuth bearer and attaches a service API key (X-API-Key + X-User-Sub). The user's bearer never reaches the downstream service.",
  "tools-call-challenge": "The same handshake on invocation: the first tools/call carries no credential, and the gateway answers 401 with the WWW-Authenticate challenge rather than passing an anonymous call through to the MCP server. Nothing executes on this leg.",
  mcp: "The second tools/call carries the delegated token. Gateway forwards the JSON-RPC call; the MCP server re-validates the token, resolves the user from sub, and invokes the banking API with the delegated identity.",
  api: "The actual resource-server call made with the delegated bearer token.",
  database: "The backend application queries its data store. This hop appears as completed only when the tool result identifies a real SQL data source.",
  reply: "The tool result goes back to the LLM, which writes the reply the user sees in the chat.",
};

// Static RFC references per hop — teaching content, shown regardless of evidence.
// Deliberately short: these render as chips on the collapsed step card, where
// only a couple fit. The long-form citations live in STEP_SPEC below and are
// shown only in the pop-out window — keep the two independent so adding a
// citation to the pop-out never changes the rail's visual density.
const STEP_RFCS = {
  signin: ["RFC 6749", "RFC 7636"],
  "tools-list-challenge": ["RFC 6750 §3", "RFC 9728"],
  "tools-list": ["MCP tools/list"],
  "tools-call-challenge": ["RFC 6750 §3", "RFC 9728"],
  "exchange-1": ["RFC 8693"],
  exchange: ["RFC 8693", "RFC 8707"],
};

// Long-form teaching content per hop, rendered ONLY by the pop-out window
// (openStepTeachingWindow). Four fields, in the order a learner needs them:
//   refs    — the normative citations, deep-linked to the section that applies
//   mandate — what the specification actually requires on this hop
//   why     — why THIS demo is built the way it is (design rationale, not spec)
//   failure — the mistake that makes this hop look correct while being broken
// Every step id in TITLES has an entry; hops that no specification governs say
// so explicitly rather than being omitted, because "no spec here" is itself the
// teaching point (the LLM hop, the credential swap).
const STEP_SPEC = {
  website: {
    refs: [],
    mandate: "No specification governs the browser itself. But OIDC Core §3.1.3 and RFC 7636 PKCE mandate that confidential clients (the BFF) hold tokens server-side, never in the browser.",
    why: "The UI is a public client and deliberately holds no bearer token. Every request carries only the session cookie; the BFF re-establishes identity from it and manages all tokens server-side.",
    failure: "Handing the browser a bearer token makes it an exfiltration target. Any XSS foothold then leaks the user's token to an attacker, bypassing the entire delegation chain below.",
  },
  signin: {
    refs: [
      { label: "RFC 6749 §4.1", title: "Authorization Code Grant", href: "https://www.rfc-editor.org/rfc/rfc6749#section-4.1" },
      { label: "RFC 7636 §4", title: "PKCE — code_challenge / code_verifier", href: "https://www.rfc-editor.org/rfc/rfc7636#section-4" },
      { label: "OIDC Core 1.0 §3.1.3.7", title: "ID Token validation", href: "https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation" },
    ],
    mandate: "OAuth 2.0 §4.1 splits login into two legs: the browser receives a single-use authorization code over the front channel, and that code is redeemed for tokens over the back channel. RFC 7636 requires the client to bind the two legs with a code_verifier / code_challenge pair, so a code intercepted in the browser cannot be redeemed by anyone else.",
    why: "The BFF is a confidential client and keeps the User Token server-side; the browser only ever holds a session cookie. That is why no access token appears in devtools, and why every later hop in this chain has to be initiated by the BFF rather than by page JavaScript.",
    failure: "If the User Token reaches the browser, every delegation proof downstream is worthless — anyone with an XSS foothold holds the subject token itself. The second common break is origin drift: the passkey rp.id, the redirect_uri and the session cookie host must all be the same origin, which is why sign-in here only works on local.ping-devops.com:4000.",
  },
  prompt: {
    refs: [],
    mandate: "No OAuth message travels on this hop. The browser posts the message text only; the session cookie is what identifies the user to the BFF.",
    why: "Deliberate: the page holds no bearer token, so it has none to send. Identity is re-established server-side from the session on every request, which means the agent cannot be driven by a token the page could leak or an attacker could lift and replay.",
    failure: "Handing the browser a bearer to forward makes the chat page a token-exfiltration target, and lets a prompt-injected page mint requests carrying the user's own authority.",
  },
  agent: {
    refs: [
      { label: "MCP 2025-11-25", title: "tools/list — tool discovery", href: "https://modelcontextprotocol.io/specification/2025-11-25/server/tools" },
    ],
    mandate: "MCP defines tools/list as the discovery call: the server advertises each tool's name, JSON Schema, and — in this demo — the OAuth scopes that tool requires.",
    why: "The catalog is loaded with its required scopes BEFORE the model reasons, so the delegated token minted two hops later can ask for exactly the scope the chosen tool needs. Discovering scope after the model picks a tool would force either an over-broad token or a second round-trip to the authorization server.",
    failure: "A stale catalog is the classic silent break: the model picks a tool the gateway no longer routes, and the failure surfaces as a 502 at the gateway rather than as an obvious discovery error.",
  },
  "tools-list-challenge": {
    refs: [
      { label: "RFC 6750 §3", title: "The WWW-Authenticate response header field", href: "https://www.rfc-editor.org/rfc/rfc6750#section-3" },
      { label: "RFC 9728 §5.1", title: "resource_metadata in the challenge", href: "https://www.rfc-editor.org/rfc/rfc9728#section-5.1" },
      { label: "MCP Authorization", title: "MCP server as an OAuth 2.1 resource server", href: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization" },
    ],
    mandate: "RFC 6750 §3 requires a protected resource to answer a credential-less request with 401 and a WWW-Authenticate challenge. RFC 9728 §5.1 adds the resource_metadata parameter to that challenge, and the MCP authorization spec makes it mandatory for MCP servers: the 401 must tell the client where to find the metadata document naming this resource's authorization server.",
    why: "This is the bootstrap the whole MCP dance rests on. A client that arrives holding nothing has no configured issuer, no audience and no scope — the challenge is where it learns all three. The demo issues this request deliberately, without a token, so the chain shows the mechanism rather than only its result: two requests, one refused and one served, against the same endpoint.",
    failure: "Answering with a bare 401 and no resource_metadata. The refusal is correct and the client is still stuck — it knows it needs a token but not who issues one, so discovery ends in a hardcoded issuer or a support ticket.",
  },
  "tools-list": {
    refs: [
      { label: "MCP 2025-11-25", title: "tools/list — tool discovery", href: "https://modelcontextprotocol.io/specification/2025-11-25/server/tools" },
      { label: "MCP 2025-11-25", title: "Lifecycle — initialize / initialized", href: "https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle" },
      { label: "RFC 9728", title: "Protected Resource Metadata", href: "https://www.rfc-editor.org/rfc/rfc9728" },
    ],
    mandate: "MCP's tools/list returns each tool's name, JSON Schema and — in this demo — the OAuth scopes it requires. The call is itself protected: the gateway answers an unauthenticated or mis-scoped request with 401 plus a WWW-Authenticate header pointing at its RFC 9728 metadata.",
    why: "Discovery is routed through the gateway rather than straight at the MCP server so PingOne Authorize can filter the catalog by vertical and scope before the model ever sees it. Filtering at discovery, not at invocation, is what makes 'the model proposed a tool it may not call' a rare case instead of the normal case. This is the second of the two requests: the first was refused, and this one carries the agent token the challenge asked for.",
    failure: "Trusting the catalog as an authorization decision. A filtered tools/list is a usability control, not a security boundary — the gateway still re-checks scope on tools/call, because a client is free to invoke a tool that discovery never advertised.",
    // The MCP lifecycle is taught here because this is the hop that performs it.
    // MCP is stateful: the client must send initialize, receive the server's
    // chosen protocolVersion and capabilities, and send notifications/initialized
    // before issuing anything else. On this stack the Agent Gateway is that
    // client and it does all three to answer THIS request, then closes the
    // session — so the negotiated version shows up in this hop's detail rather
    // than on a tool call that reuses nothing. Treating MCP as a stateless HTTP
    // API is the classic error: firing a request before the initialized
    // notification fails in a way that looks like auth and is protocol state.
  },
  llm: {
    refs: [],
    mandate: "No specification governs this hop. The model receives conversation text plus tool schemas and returns a proposed tool call.",
    why: "The LLM sits deliberately outside the trust boundary — it never sees, holds, or mints a token. It proposes an action; every question of authority is settled after it, at Authorize and at the gateway.",
    failure: "Treating model output as authorization. If a tool ran because the model asked for it, prompt injection becomes privilege escalation. Here the model's choice is only one input to a policy decision made elsewhere.",
  },
  "agent-token": {
    refs: [
      { label: "RFC 6749 §4.4", title: "Client Credentials Grant", href: "https://www.rfc-editor.org/rfc/rfc6749#section-4.4" },
      { label: "RFC 9068 §2.2", title: "JWT access token — data structure", href: "https://www.rfc-editor.org/rfc/rfc9068#section-2.2" },
    ],
    mandate: "OAuth 2.0 §4.4 mints a token for the client itself, with no user involved. RFC 9068 defines the JWT access-token profile whose client_id and sub identify that machine principal.",
    why: "The agent needs its own verifiable identity so the exchange on the next hop has something real to put in actor_token. Without a separate agent identity there is nothing to prove WHO acted for the user — only that a call arrived.",
    failure: "Reusing the user's token as the agent identity collapses the two parties into one, and the act claim produced by the next hop becomes decorative rather than evidential.",
  },
  "exchange-1": {
    refs: [
      { label: "RFC 8693 §2.1", title: "Token exchange request", href: "https://www.rfc-editor.org/rfc/rfc8693#section-2.1" },
      { label: "RFC 8707 §2", title: "Resource indicators — audience narrowing", href: "https://www.rfc-editor.org/rfc/rfc8707#section-2" },
    ],
    mandate: "Nothing requires two exchanges. RFC 8693 permits chaining them, and each call is an ordinary exchange in its own right: this one presents the agent's client-credentials token as the subject and asks for a narrower scope and audience back.",
    why: "Two-exchange mode narrows the AGENT before it borrows the USER's authority. Starting the delegated exchange from an already-reduced agent token means the token minted next cannot inherit scope the agent never needed, so a mistake in the second call fails closed rather than issuing something over-broad.",
    failure: "Reading this hop as the delegation. No user is involved yet and there is no act claim — a token from this step alone proves nothing about acting for anyone. The delegation is the NEXT exchange.",
  },
  exchange: {
    refs: [
      { label: "RFC 8693 §2.1", title: "Token exchange request", href: "https://www.rfc-editor.org/rfc/rfc8693#section-2.1" },
      { label: "RFC 8693 §4.1", title: "The act (actor) claim", href: "https://www.rfc-editor.org/rfc/rfc8693#section-4.1" },
      { label: "RFC 8707 §2", title: "Resource indicators — audience narrowing", href: "https://www.rfc-editor.org/rfc/rfc8707#section-2" },
    ],
    mandate: "RFC 8693 §2.1 posts grant_type=urn:ietf:params:oauth:grant-type:token-exchange carrying subject_token (the user) and actor_token (the agent). §4.1 defines the act claim the authorization server embeds: sub stays the user, act.sub is the agent, and a nested act records a chain of actors with the most recent outermost. RFC 8707 resource pins the audience of the issued token.",
    why: "One token now carries both parties, so the resource server can see who is being acted for AND who is acting. Scope is narrowed to what the chosen tool needs and audience is pinned to the gateway, which makes the token useless anywhere else. This is what makes an agent action attributable to a human without impersonating them.",
    failure: "Two classic breaks. First, requesting the same broad scope the user already holds — the delegation is genuine but least privilege is gone. Second, omitting resource so the issued token is accepted by any resource server that trusts the issuer, which is a confused deputy waiting to be exploited.",
  },
  authorize: {
    refs: [
      { label: "XACML 3.0 §2", title: "PDP / PEP separation and the PERMIT / DENY / INDETERMINATE vocabulary", href: "http://docs.oasis-open.org/xacml/3.0/xacml-3.0-core-spec-os-en.html" },
      { label: "RFC 8693 §4.1", title: "act chain — the attribute policy evaluates here", href: "https://www.rfc-editor.org/rfc/rfc8693#section-4.1" },
    ],
    mandate: "No IETF RFC governs the decision itself; this is attribute-based access control, whose model XACML 3.0 formalizes. The enforcement point never decides — it submits attributes (subject, actor, action, resource, context) to a decision point and obeys the verdict, which is PERMIT, DENY or INDETERMINATE, optionally carrying obligations.",
    why: "Policy runs before the tool, not inside it. Amount caps, actor checks and step-up demands live in one place a security team can change without redeploying the agent or the MCP server — and the decision id makes each verdict individually auditable.",
    failure: "Evaluating the wrong policy is invisible from the outside: a DENY proves the engine answered, not that YOUR rule fired. Always reconcile decisionContext and the decision id against the rule you expected to trigger.",
  },
  stepup: {
    refs: [
      { label: "OIDC CIBA Core 1.0", title: "Client-Initiated Backchannel Authentication", href: "https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html" },
      { label: "RFC 8176", title: "Authentication Method Reference (amr) values", href: "https://www.rfc-editor.org/rfc/rfc8176" },
    ],
    mandate: "CIBA defines a decoupled flow: the client initiates, the human approves on a separate authenticated device, and the client polls the token endpoint until the decision lands. RFC 8176 defines the amr values that record HOW that human authenticated, so the approval is provable after the fact.",
    why: "The human is pulled back into the loop at the moment of risk rather than only at login. The agent's request pauses with HTTP 428 instead of failing outright, and resumes only after a real human decision that is recorded in the resulting token's amr and acr.",
    failure: "Treating advice as enforcement. An approval gate returned with obligatory:false is guidance — if the caller is free to skip it, the gate does not exist. Verify the call actually blocked, not merely that a challenge was mentioned.",
  },
  "intent-binding": {
    refs: [
      { label: "RFC 9396 §2", title: "authorization_details — rich authorization requests", href: "https://www.rfc-editor.org/rfc/rfc9396#section-2" },
      { label: "RFC 9126 §2", title: "Pushed Authorization Requests", href: "https://www.rfc-editor.org/rfc/rfc9126#section-2" },
    ],
    mandate: "RFC 9396 replaces coarse scope with a structured authorization_details array — a type, the permitted actions, and limits such as a maximum amount or a specific target account. RFC 9126 (PAR) lets the client push those details to the authorization server over the back channel first, so the browser never carries them and cannot tamper with them.",
    why: "Scope says 'may transfer'. RAR says 'may transfer up to $2,000 to account X'. Binding the intent at authorization time means the check no longer depends on the agent honestly restating the amount at call time.",
    failure: "In this demo PAR does NOT validate the amount — the cap is enforced in the route. Assuming the authorization server enforces a RAR limit it never parsed is exactly how an over-cap transfer sails through while the flow still looks compliant.",
  },
  gateway: {
    refs: [
      { label: "RFC 6750 §3", title: "WWW-Authenticate challenge on an invalid token", href: "https://www.rfc-editor.org/rfc/rfc6750#section-3" },
      { label: "RFC 7662 §2", title: "Token introspection", href: "https://www.rfc-editor.org/rfc/rfc7662#section-2" },
      { label: "RFC 9068 §4", title: "Validating a JWT access token (aud, exp, scope)", href: "https://www.rfc-editor.org/rfc/rfc9068#section-4" },
    ],
    mandate: "RFC 6750 §3 requires a protected resource to reject an invalid token with 401 and a WWW-Authenticate challenge naming the error. RFC 7662 defines introspection for opaque tokens; RFC 9068 §4 lists what a JWT access token must be checked for locally — audience, expiry, scope and client_id.",
    why: "The gateway is the enforcement point in front of MCP: it re-validates audience, expiry, scope and the act chain so the MCP server is never the only thing between a forged token and the data. Introspection is issuer-scoped — it can only see tokens the introspecting client issued — which is why A2A specialist tokens are validated locally against JWKS instead.",
    failure: "Checking the signature but not the audience. A correctly signed token minted for a different resource server is still a valid JWT; only the aud check stops it from being replayed here.",
  },
  "api-key-swap": {
    refs: [
      { label: "RFC 6750 §1", title: "Bearer tokens must not be disclosed beyond their audience", href: "https://www.rfc-editor.org/rfc/rfc6750#section-1" },
    ],
    mandate: "No specification covers this hop — it is the deliberate boundary where OAuth ends. The gateway strips the Authorization: Bearer header entirely and attaches a service credential plus the already-resolved user identity (X-API-Key and X-User-Sub).",
    why: "Legacy services that cannot validate OAuth still must not receive the user's bearer. Terminating the token at the gateway means a compromised downstream service holds a rotatable service key scoped to the gateway, never a delegated user token it could replay elsewhere.",
    failure: "Forwarding both the bearer and the API key. The downstream now holds a token it has no reason to have, and the audience restriction that made that token safe has been bypassed by hand.",
  },
  "tools-call-challenge": {
    refs: [
      { label: "RFC 6750 §3", title: "The WWW-Authenticate response header field", href: "https://www.rfc-editor.org/rfc/rfc6750#section-3" },
      { label: "RFC 9728 §5.1", title: "resource_metadata in the challenge", href: "https://www.rfc-editor.org/rfc/rfc9728#section-5.1" },
    ],
    mandate: "The same RFC 6750 §3 rule applies to every protected method, not only discovery. An unauthenticated tools/call must be refused with 401 and the same WWW-Authenticate challenge — the resource does not get to be lenient because the client already listed its tools.",
    why: "Invocation is challenged separately to make the boundary visible: the gateway refuses the anonymous call at its own edge, so nothing reaches the MCP server and no tool code runs. Showing it as its own hop is what distinguishes 'the call was rejected' from 'the tool ran and returned an error'.",
    failure: "Treating a successful tools/list as a session. If listing a tool implicitly authorized calling it, discovery would become an authentication bypass — which is why this leg is refused on its own terms even though the previous one already was.",
  },
  mcp: {
    refs: [
      { label: "MCP 2025-11-25", title: "tools/call over JSON-RPC 2.0", href: "https://modelcontextprotocol.io/specification/2025-11-25/server/tools" },
      { label: "MCP Authorization", title: "MCP server as an OAuth 2.1 resource server", href: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization" },
      { label: "RFC 9728", title: "Protected Resource Metadata", href: "https://www.rfc-editor.org/rfc/rfc9728" },
    ],
    mandate: "MCP tools/call carries the tool name and a JSON-Schema-validated arguments object over JSON-RPC 2.0. The MCP authorization spec makes the server an OAuth 2.1 resource server in its own right: it validates the bearer itself and advertises its authorization server through RFC 9728 protected-resource metadata.",
    why: "The MCP server re-validates rather than trusting the gateway, resolves the user from sub, and calls the banking API under the delegated identity. Defense in depth: a bug or a bypass at the gateway does not turn into unauthenticated data access.",
    failure: "Trusting the gateway's word. If the MCP server accepts a header-asserted user id without re-checking the token, anything that can reach it directly can impersonate any user.",
  },
  api: {
    refs: [
      { label: "RFC 6750 §2.1", title: "Authorization request header field", href: "https://www.rfc-editor.org/rfc/rfc6750#section-2.1" },
      { label: "RFC 6750 §3.1", title: "insufficient_scope", href: "https://www.rfc-editor.org/rfc/rfc6750#section-3.1" },
    ],
    mandate: "RFC 6750 §2.1 puts the delegated token in the Authorization: Bearer header of the resource request. The resource server enforces scope itself and returns 403 with error=\"insufficient_scope\" when the required scope is absent.",
    why: "This is where the narrowing done at the exchange hop actually pays off: the same call made with the user's original broad token would succeed against far more endpoints. The delegated token can only do the one thing the chosen tool needed.",
    failure: "Reading an expected DENY here as an outage. A blocked out-of-scope call is the control working, and in the deny-track use cases it is the whole demonstration.",
  },
  database: {
    refs: [],
    mandate: "No OAuth specification governs the database query. OAuth authorization has already been enforced by the resource server before application code reads or writes data.",
    why: "Keeping the database behind the resource-server boundary makes the trust transition explicit: the MCP call reaches backend application code, and only that application queries its private data store. United Airlines tools use the resource server's real SQLite database.",
    failure: "Showing a database hop without runtime evidence makes a proxy, mock, or denied request look like a real data access. This card completes only when the result reports a SQL source.",
  },
  reply: {
    refs: [],
    mandate: "No specification governs this hop. The tool result goes back to the model, which writes the user-facing text.",
    why: "The model composes prose from data it did not fetch and could not have fetched on its own authority. Everything security-relevant already happened upstream, which is why the reply can be wrong without the enforcement being wrong.",
    failure: "Letting the model's summary stand as the audit record. The reply is presentation; the token chain and the decision id are the evidence.",
  },
};

// PingOne Authorize's DecisionContext is an internal Trust Framework parameter
// name — surface what it actually gates instead of the raw code.
const DECISION_CONTEXT_LABELS = {
  McpFirstTool: "MCP tool-call check",
  TransactionAmount: "Amount / transaction policy check",
};
const friendlyDecisionContext = (ctx) => (ctx && DECISION_CONTEXT_LABELS[ctx]) || ctx;

const asJson = (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };
const splitScopes = (s) =>
  Array.isArray(s) ? s : typeof s === "string" ? s.split(" ").filter(Boolean) : [];
// Accepts multiple ids: the BFF emits a different event vocabulary per exchange
// mode — 1-exchange ("agent-actor-token", "exchanged-token") vs 2-exchange
// ("two-ex-agent-actor", "two-ex-final-token"). Both must light up the rail.
const findEvent = (events, ...ids) => events.find((e) => e && ids.includes(e.id)) || null;
// req.recordTokenEvent() (agentSessionMiddleware) stamps `type`, not `id`, so
// events it produces — the tools/list family among them — are invisible to
// findEvent. Match those by type instead of widening findEvent, which would
// change how every existing id-keyed lookup resolves.
const findEventByType = (events, ...types) =>
  (Array.isArray(events) ? events : []).find((e) => e && types.includes(e.type)) || null;
// The challenge probe runs twice per turn — once before tools/list, once before
// tools/call — and both legs emit the SAME event types, distinguished only by
// `phase`. Matching on type alone would put the discovery challenge's evidence
// on the tool-call card as well.
const findEventByTypeAndPhase = (events, phase, ...types) =>
  (Array.isArray(events) ? events : [])
    .find((e) => e && types.includes(e.type) && e.phase === phase) || null;
const hasPhase = (phases, name) => phases.some((p) => p && p.phase === name);
const findPhase = (phases, name) => phases.find((p) => p && p.phase === name) || null;
const claimsBlock = (title, claims) =>
  claims && Object.keys(claims).length ? { title, text: asJson(claims) } : undefined;

// Resolve a human-readable backend service label from tool name + _meta.
const TOOL_BACKEND_MAP = {
  show_mortgage: { label: "API Resource Server", lane: "MORTGAGE" },
  show_investment: { label: "API Resource Server", lane: "INVEST" },
  get_investment_balance: { label: "MCP Resource Server", lane: "INVEST" },
  get_investment_accounts: { label: "MCP Resource Server", lane: "INVEST" },
  get_investment_transactions: { label: "MCP Resource Server", lane: "INVEST" },
  get_portfolio_summary: { label: "MCP Resource Server", lane: "INVEST" },
};
const UNITED_SQL_TOOLS = new Set([
  "pay_airline_fee",
  "cancel_airline_reservation",
  "sensitive_airline_bookings",
  "get_airline_bookings",
  "get_flight_status",
  "check_seat_availability",
  "sensitive_passenger_record",
]);
function resolveBackendLabel(toolName, meta) {
  if (UNITED_SQL_TOOLS.has(toolName)) {
    return { label: "United Airlines backend app", lane: "AIRLINES" };
  }
  const mapped = toolName && TOOL_BACKEND_MAP[toolName];
  if (mapped) return mapped;
  if (meta?.backend) return { label: meta.backend, lane: "API" };
  return null;
}

const SQL_SOURCE_LABELS = {
  sqlite: "SQLite",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  sqlserver: "SQL Server",
};

function resolveDatabaseInfo(result, toolName) {
  const source = typeof result?.source === "string" ? result.source.toLowerCase() : "";
  const engine = SQL_SOURCE_LABELS[source];
  return engine ? { engine, source, isUnited: UNITED_SQL_TOOLS.has(toolName) } : null;
}

// --- replay payloads -------------------------------------------------------
// A step can carry a `replay` descriptor: enough of THIS run's actual request
// to re-issue it in the matching inspector page. Consumed by TraceStepCard,
// handed off via services/inspectorReplay.js. Null when the run produced no
// re-issuable request (nothing to replay -> no button).

/** P1AZ decision request -> Evaluate console (custom preset rows). */
function buildAuthorizeReplay(azEval, azRequestPayload) {
  const params = azRequestPayload
    || azEval?.request?.parameters || azEval?.request?.body || null;
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  if (!Object.keys(params).length) return null;
  return {
    target: "p1az",
    href: "/pingone-authorize",
    label: "Replay in P1AZ Evaluate",
    parameters: params,
    endpointId: azEval?.endpointId || null,
  };
}

/** Build the why/request/response/decision/kv/replay detail for ONE authorize
 * card from a resolved evaluation object (`{decision, decisionId, engine,
 * decisionContext, request, response, source}`). Shared by the single-decision
 * path (fed the rich `azEval`) and the multi-decision path (fed each raw entry
 * off `trace.authorizeEvaluations`) so both render identically. */
function buildAuthorizeDetail(evalObj) {
  const decision = evalObj.decision != null ? String(evalObj.decision).toUpperCase() : "";
  // Obligation-first (phase 3c). Phase 4 shipped: a pause is PERMIT carrying
  // an unfulfilled obligation, matching live cloud PingOne Authorize (a
  // DENY-carrying-obligation would be silently dropped by both existing
  // engine consumers — see routes/decision.js's pausePermit() doc comment for
  // why). isPause() reads the obligation regardless of the decision value, so
  // this line is correct either way — but `isDeny` still needs the pause
  // consulted BEFORE the decision, since after the flip a pause and a genuine
  // DENY can no longer be told apart by decision value alone in the OTHER
  // direction: a real DENY never carries a pause obligation, so gating isDeny
  // on !isChallenge costs nothing when decision is honestly DENY.
  const isChallenge = isPause(decision, evalObj);
  const isDeny = decision === "DENY" && !isChallenge;
  const requestPayload = evalObj.request
    ? ((evalObj.request.body && evalObj.request.body.parameters)
        || evalObj.request.parameters
        || evalObj.request.body
        || evalObj.request)
    : null;
  const responseBody = evalObj.response || evalObj.raw || null;
  const why = isChallenge
    ? `Authorize returned ${evalObj.decision || "INDETERMINATE"} — the human must approve before the tool proceeds.`
    : isDeny
      ? `Authorize denied this action (${evalObj.engine || "policy"}) — the tool call is blocked.`
      : `Authorize returned ${evalObj.decision || "PERMIT"}`
        + (evalObj.decisionContext ? ` for the ${friendlyDecisionContext(evalObj.decisionContext)}` : "")
        + (evalObj.source === "gw-authorize" ? " at the Agent Gateway hop." : " before the tool ran.");
  return {
    why,
    request: requestPayload
      ? { title: "Decision request (actual)",
          text: `${(evalObj.request && evalObj.request.method) || "POST"} ${(evalObj.request && evalObj.request.url) || ""}\n${asJson(requestPayload)}` }
      : undefined,
    response: responseBody
      ? { title: "Decision response (raw)", text: asJson(responseBody) } : undefined,
    // No decision on the evaluation = nothing was recorded, NOT a P1AZ
    // INDETERMINATE (that is a real verdict: "could not evaluate", fail-closed).
    decision: { outcome: evalObj.decision || "NOT_RECORDED",
      label: `${evalObj.decision || "no decision recorded"} — ${evalObj.engine || "?"}${evalObj.decisionContext ? ` (${friendlyDecisionContext(evalObj.decisionContext)})` : ""}` },
    kv: [
      ["engine", String(evalObj.engine || "")],
      ["decision id", String(evalObj.decisionId || "")],
      evalObj.source === "gw-authorize" ? ["evidence", "from gw-authorize (gateway hop)"] : null,
    ].filter((row) => row && row[1]),
    moreDetail: { edu: EDU.PINGONE_AUTHORIZE, label: "Learn: PingOne Authorize" },
    replay: buildAuthorizeReplay(evalObj, requestPayload),
  };
}

/** MCP JSON-RPC call -> Agent Gateway Tester (tool + arguments). Falls back to
 * the attempted tool recorded on a sim-gateway-deny event when the call never
 * reached the MCP server (nothing to replay from a real result otherwise). */
function buildGatewayReplay(mcpResult, gwAz, simGwDeny) {
  const req = mcpResult?.requestJson || null;
  const tool = req?.name || req?.params?.name
    || mcpResult?.tool || mcpResult?.toolName
    || gwAz?.tool
    || simGwDeny?.tool
    || null;
  if (!tool) return null;
  const args = req?.arguments || req?.params?.arguments || mcpResult?.arguments
    || simGwDeny?.arguments || {};
  return {
    target: "gateway",
    // Direct route, not /pinggateway-inspector — that path redirects via
    // <Navigate to="/agent-gateway-inspector" replace/> which drops the query
    // string, losing both ?subtab=tester and the staged ?replay=<id>.
    href: "/agent-gateway-inspector?subtab=tester",
    label: "Replay in Gateway Tester",
    tool: String(tool),
    arguments: args && typeof args === "object" ? args : {},
  };
}

/** MCP JSON-RPC call -> MCP Inspector (tool + arguments), same shape as the
 * gateway replay above but targeting the banking MCP server's own tester. */
function buildMcpReplay(mcpResult) {
  const req = mcpResult?.requestJson || null;
  const tool = req?.name || req?.params?.name || mcpResult?.tool || mcpResult?.toolName || null;
  if (!tool) return null;
  const args = req?.arguments || req?.params?.arguments || mcpResult?.arguments || {};
  return {
    target: "mcp",
    href: "/pingone-mcp-inspector?source=banking",
    label: "Replay in MCP Inspector",
    tool: String(tool),
    arguments: args && typeof args === "object" ? args : {},
  };
}

function makeStep(id, status, detail) {
  const base = { narrative: NARRATIVES[id] };
  if (STEP_RFCS[id]) base.rfcs = STEP_RFCS[id];
  // Pop-out-only long form. Not part of hasPopoutWorthyDetail: spec is static
  // teaching text present on every step, so counting it would put a "Pop out"
  // button on steps that have not run yet.
  if (STEP_SPEC[id]) base.spec = STEP_SPEC[id];
  // base first so live evidence in `detail` overrides/extends it; base narrative
  // guarantees the expanded body is never blank even for not-yet-run steps.
  return { id, title: TITLES[id], lane: LANES[id], status, detail: { ...base, ...(detail || {}) } };
}

/**
 * L0 run story for the TraceRail header — plain English, no JSON.
 * @param {object} trace
 * @param {Array} steps from buildTraceSteps
 * @returns {{ headline: string, outcome: string, bits: string[] } | null}
 */
export function buildRunStory(trace, steps) {
  if (!trace) return null;
  const hasActivity = Boolean(
    trace.startedAt || trace.prompt || (trace.tokenEvents && trace.tokenEvents.length) ||
    (trace.phases && trace.phases.length) || trace.mcpResult || trace.authorize ||
    trace.llmDetail || trace.llmReply || trace.outcome || trace.routingMode,
  );
  if (!hasActivity) return null;

  const list = Array.isArray(steps) ? steps : [];
  const errStep = list.find((s) => s && s.status === "error");
  const az = list.find((s) => s && s.id === "authorize");
  // Only claim a decision the engine actually returned — NOT_RECORDED is the
  // display default for an evaluation with no decision field, not a verdict.
  const rawDecision = az?.detail?.decision?.outcome;
  const decision = rawDecision && rawDecision !== "NOT_RECORDED" ? rawDecision : null;
  const prompt = trace.prompt?.message;
  // An expected DENY (an expectedOutcome:'DENY' use case whose gateway block fired)
  // is the control working — present it as a successful run, not an error.
  const expectedDeny = Boolean(trace.mcpResult?.denied && trace.mcpResult?.expected);
  let outcome = trace.outcome || (errStep ? "error" : "active");
  let headline;
  if (expectedDeny) {
    outcome = "ok";
    headline = "Expected DENY — the control worked: the gateway blocked the out-of-scope call, exactly as this use case is meant to demonstrate.";
  } else if (outcome === "error" || errStep) {
    outcome = "error";
    headline = errStep
      ? `This run stopped with an error at “${errStep.title}”.`
      : "This run ended with an error.";
  } else if (outcome === "ok") {
    headline = decision
      ? `This run completed successfully — Authorize returned ${decision}.`
      : "This run completed successfully.";
  } else if (prompt) {
    headline = `In progress: “${String(prompt).slice(0, 80)}${String(prompt).length > 80 ? "…" : ""}”`;
  } else {
    headline = "Trace started — waiting for pipeline evidence.";
  }

  const bits = list
    .filter((s) => s && (s.status === "done" || s.status === "error") && s.detail?.why)
    .slice(0, 3)
    .map((s) => s.detail.why);

  return { headline, outcome, bits };
}

/**
 * One leg of the MCP authorization handshake: the credential-less request the
 * gateway refuses, plus the RFC 9728 metadata its challenge pointed at. Shared
 * by the tools/list and tools/call legs, which emit identical event types and
 * differ only by `phase`.
 *
 * A 401 here is the step SUCCEEDING — it is the control answering correctly, so
 * it paints done, not error. The error state is reserved for a gateway that let
 * an anonymous call through (any non-401 status) or that could not be reached.
 *
 * @param {string} id      step id ("tools-list-challenge" | "tools-call-challenge")
 * @param {string} phase   event phase to match ("tools/list" | "tools/call")
 * @param {Array}  events  trace tokenEvents
 * @param {boolean} traceComplete
 */
// Human-readable names + one-line purpose for the gateway's filter stages, so
// the chain says what each one DID rather than echoing a Java class name. Any
// stage the gateway adds later still renders — it just falls back to its raw
// name with no blurb, which is better than being dropped.
const GW_STAGE_META = {
  TokenIntrospection: { label: "Token introspection", note: "RFC 7662 call to PingOne — is this token still live?" },
  GatewayTokenPolicy: { label: "Gateway token policy", note: "Local check: audience, scope and the act delegation chain." },
  P1AZDecision: { label: "PingOne Authorize decision", note: "The gateway's OWN policy call — separate from the BFF's earlier one." },
  mTLS: { label: "mTLS to MCP server", note: "Client-certificate hop; skipped unless MCP_MTLS_ON." },
  BackendExchange: { label: "Backend token exchange", note: "RFC 8693 again — re-mints the token for the upstream audience." },
  // The PingGateway (IG) route emits a DIFFERENT chain from the Node gateway's,
  // and these three are what a live IG run actually reports — confirmed on the
  // focus-mode dashboard, where they were rendering under their raw Java class
  // names via the unknown-stage fallback. The fallback did its job; these give
  // them the same teaching value the Node gateway's stages already had.
  McpValidationFilter: { label: "MCP protocol validation", note: "Checks the JSON-RPC envelope and buffers the body so later filters can re-read it." },
  McpAuditFilter: { label: "Audit trail", note: "Records the hop — this is what stamps X-Gw-Audit-Trail, the header this chain is built from." },
  McpProtectionFilter: { label: "MCP resource protection", note: "IG's OAuth guard for the MCP endpoint: validates the bearer against the route's resourceId and issues the RFC 9728 challenge on failure." },
};

// The gateway reports 'passed' | 'forwarded' | 'blocked' | 'skipped'. Map onto
// the same vocabulary the rail already uses for step status so one legend
// covers both. 'skipped' stays distinct from 'blocked': a stage that never ran
// is not a stage that refused.
const GW_STAGE_STATUS = {
  passed: "done", forwarded: "done", blocked: "error", skipped: "notinpath",
};

/** Shape the gateway's filterChain into the ordered stage list the card renders. */
export function buildGatewayStages(filterChain, denyingFilter) {
  if (!Array.isArray(filterChain) || !filterChain.length) return undefined;
  return filterChain.map((s) => {
    const meta = GW_STAGE_META[s.filter] || {};
    return {
      name: meta.label || s.filter,
      raw: s.filter,
      note: meta.note,
      result: s.result,
      status: GW_STAGE_STATUS[s.result] || "notinpath",
      decision: s.decision || undefined,
      blockedHere: !!denyingFilter && denyingFilter === s.filter,
    };
  });
}

function buildChallengeStep(id, phase, events, traceComplete) {
  const challenge = findEventByTypeAndPhase(events, phase, "mcp_challenge");
  const metadata = findEventByTypeAndPhase(events, phase, "mcp_resource_metadata");
  const metadataErr = findEventByTypeAndPhase(events, phase, "mcp_resource_metadata_error");
  const probeErr = findEventByTypeAndPhase(events, phase, "mcp_challenge_error");
  const skipped = findEventByTypeAndPhase(events, phase, "mcp_challenge_skipped");

  const status = challenge
    ? (challenge.challenged ? "done" : "error")
    : probeErr
      ? "error"
      : (skipped || traceComplete) ? "notinpath" : "pending";

  if (!challenge && !probeErr && !skipped) {
    return makeStep(id, status, {});
  }

  const authServers = Array.isArray(metadata?.authorizationServers) ? metadata.authorizationServers : [];
  return makeStep(id, status, {
    why: challenge
      ? (challenge.challenged
        ? `The gateway refused the credential-less ${challenge.method || phase} with HTTP 401`
          + (challenge.resourceMetadataUrl ? " and pointed at its RFC 9728 metadata." : ", but published no resource_metadata pointer.")
        : `The gateway answered a credential-less ${challenge.method || phase} with HTTP ${challenge.status} instead of a 401 challenge — an unauthenticated caller was not refused.`)
      : probeErr
        ? `The challenge leg could not be issued (${probeErr.reason || "probe failed"}) — no 401 evidence for this run.`
        : "No MCP gateway was configured for this run, so there was no protected resource to challenge.",
    request: challenge
      ? { title: "Unauthenticated request (actual)",
          text: `POST ${challenge.url || ""}\n(no Authorization header)\n${asJson({ jsonrpc: "2.0", method: challenge.method || phase })}` }
      : undefined,
    response: challenge
      ? { title: `Challenge response — HTTP ${challenge.status}`,
          text: `WWW-Authenticate: ${challenge.wwwAuthenticate || "(none)"}\n${asJson(challenge.responseBody ?? {})}` }
      : undefined,
    kv: [
      challenge ? ["status", String(challenge.status)] : null,
      challenge?.realm ? ["realm", String(challenge.realm)] : null,
      challenge?.error ? ["error", String(challenge.error)] : null,
      challenge?.scope ? ["scope demanded", String(challenge.scope)] : null,
      challenge?.resourceMetadataUrl ? ["resource metadata", String(challenge.resourceMetadataUrl)] : null,
      metadata?.resource ? ["resource", String(metadata.resource)] : null,
      authServers.length ? ["authorization server", authServers.join(", ")] : null,
      metadata?.scopesSupported?.length ? ["scopes supported", metadata.scopesSupported.join(" ")] : null,
      metadataErr ? ["metadata fetch", String(metadataErr.reason || "failed")] : null,
      probeErr ? ["probe error", String(probeErr.message || probeErr.reason)] : null,
    ].filter(Boolean),
    // DENY is what actually happened and it is the control working, so the step
    // STATUS stays "done" (no ✗ on the rail) while the decision drives the
    // topology badge red — the hop completed by refusing, same rule the gateway
    // hop already follows. The label carries that reading so the pill is not
    // mistaken for a broken run.
    decision: challenge?.challenged
      ? { outcome: "DENY", label: "401 — anonymous caller refused (the control working)" }
      : undefined,
    beforeAfter: metadata
      ? { before: { title: "Challenge (WWW-Authenticate)", text: String(challenge?.wwwAuthenticate || "") },
          after: { title: "RFC 9728 metadata document", text: asJson(metadata.document || {}) } }
      : undefined,
    moreDetail: { edu: EDU.MCP_PROTOCOL, label: "Learn: MCP Protocol" },
  });
}

export function buildTraceSteps(trace) {
  const { prompt, routingMode, routingDetail, llmDetail, llmReply, phases, tokenEvents, mcpResult, authorize, authorizeEvaluations, outcome } = trace;
  const isHeuristic = routingMode === "heuristic";
  // Once the trace has a terminal outcome, any step that's still evidence-free
  // is no longer "still coming" — it was genuinely never part of this run's
  // path (mTLS off, gateway not in route, OAuth-bearer path with no API-key
  // swap, no step-up demanded). Mirrors TokenChainDisplay's notinpath bucket.
  const traceComplete = outcome === "ok" || outcome === "error";
  const steps = [];

  // 0. Website (Browser) — always considered active/done
  steps.push(makeStep("website", "done", { narrative: "Browser securely sending requests over HTTP-only session cookie API." }));

  // 1. signin — evidence: user-token / session-token-introspection events
  const userTok = findEvent(tokenEvents, "user-token") ||
    findEvent(tokenEvents, "session-token-introspection");
  steps.push(makeStep("signin", userTok ? "done" : "pending", userTok ? {
    kv: Object.entries(userTok.claims || {}).slice(0, 6).map(([k, v]) => [k, asJson(v)]),
    response: claimsBlock("User token claims (full)", userTok.claims),
    inspectToken: "user",
    tokenEvent: userTok,
  } : {}));

  // 2. prompt
  steps.push(makeStep("prompt", prompt ? "done" : "pending", prompt ? {
    request: { title: "Request (actual)",
      text: `POST /api/agent/run\n${asJson({ message: prompt.message })}` },
  } : {}));

  // 3. agent — evidence: request_accepted phase, LLM activity, or heuristic routing
  const agentSeen = isHeuristic || hasPhase(phases, "request_accepted") || !!llmDetail;
  steps.push(makeStep("agent", agentSeen ? "done" : traceComplete ? "notinpath" : "pending", isHeuristic ? {
    kv: [
      ["routing", "Heuristic intent match"],
      routingDetail?.action ? ["matched action", String(routingDetail.action)] : null,
    ].filter(Boolean),
  } : {}));

  // 3b. tools/list #1 — the credential-less discovery request the gateway
  // refuses with 401 + WWW-Authenticate. Its own hop, because it is a real
  // round trip to the gateway and the first half of the MCP handshake.
  steps.push(buildChallengeStep("tools-list-challenge", "tools/list", tokenEvents, traceComplete));

  // 3c. tools/list #2 — MCP tool discovery through the gateway, before the model
  // reasons. The BFF merges these events into the run (routes/agentRun.js), but
  // they carry `type` rather than `id`, so they need findEventByType.
  // Emitted by agentGatewayClient off the gateway's tools/list _meta (#2049).
  const mcpInitEvent = findEvent(tokenEvents, "mcp-initialize");
  const mcpInitializedEvent = findEvent(tokenEvents, "mcp-initialized");
  const toolsOk = findEventByType(tokenEvents, "tools_list_success");
  const toolsFallback = findEventByType(tokenEvents, "tools_list_fallback");
  const toolsErr = findEventByType(tokenEvents, "tools_list_error", "tools_list_failed");
  const toolsStarted = findEventByType(tokenEvents, "tools_list_request_started");
  const toolsEvent = toolsOk || toolsFallback || toolsErr || toolsStarted;
  const toolsStatus = toolsOk || toolsFallback
    ? "done"
    : toolsErr
      ? "error"
      : traceComplete
        ? "notinpath"
        : toolsStarted ? "active" : "pending";
  steps.push(makeStep("tools-list", toolsStatus, toolsEvent ? {
    kv: [
      toolsOk && toolsOk.permittedCount != null ? ["tools permitted", String(toolsOk.permittedCount)] : null,
      toolsOk && toolsOk.deniedCount != null ? ["filtered by policy", String(toolsOk.deniedCount)] : null,
      toolsOk?.vertical ? ["vertical", String(toolsOk.vertical)] : null,
      toolsFallback ? ["catalog source", `local fallback — ${toolsFallback.reason || "gateway unreachable"}`] : null,
      toolsErr ? ["error", String(toolsErr.message || toolsErr.code || "tools/list failed")] : null,
      // The MCP session this discovery opened. The Agent Gateway is the MCP
      // client on this path and runs initialize -> notifications/initialized ->
      // tools/list -> close, per call (traced live 2026-08-18; the tool-call leg
      // produces no tools/call on the MCP server at all).
      //
      // Shown HERE rather than as two hops of its own. As separate cards between
      // the gateway and the MCP call they claimed a session is negotiated per
      // tool invocation, which is false; moved next to discovery they were
      // honest but sat empty on any chain built from a single invoke response,
      // because the session belongs to the earlier request. Attaching the
      // evidence to the hop that caused it says the true thing without adding a
      // card that is blank most of the time.
      mcpInitEvent?.negotiatedVersion
        ? ["MCP session", `initialize -> ${mcpInitEvent.negotiatedVersion}`
            + (mcpInitializedEvent ? " -> notifications/initialized" : "")]
        : null,
      mcpInitEvent?.serverInfo?.name
        ? ["MCP server", `${mcpInitEvent.serverInfo.name}`
            + (mcpInitEvent.serverInfo.version ? ` ${mcpInitEvent.serverInfo.version}` : "")]
        : null,
      mcpInitEvent?.performedBy
        ? ["session opened by", String(mcpInitEvent.performedBy)]
        : null,
    ].filter(Boolean),
    response: toolsEvent ? { title: "tools/list event", text: asJson(toolsEvent) } : undefined,
    handshake: mcpInitEvent
      ? { initialize: mcpInitEvent, initialized: mcpInitializedEvent || null }
      : undefined,
  } : {}));

  // 4. llm — heuristic runs skip the model; label/lane become HEURISTICS and mark done
  if (isHeuristic) {
    const llmStep = makeStep("llm", "done", {
      narrative: "Heuristics matched the prompt to a known intent and chose the tool — the LLM was not invoked.",
      // STEP_SPEC.llm teaches "the model proposes, policy decides"; on this path
      // there is no model at all, so replace it rather than teach the wrong hop.
      spec: {
        refs: [],
        mandate: "No specification governs this hop, and on this run no model was called at all — a deterministic phrase match chose the tool.",
        why: "Heuristic routing exists so the demo can prove the security chain with the model removed from the picture. Identical tokens, identical policy decision, identical gateway checks: what changes is only who picked the tool.",
        failure: "Reading a heuristic run as proof the LLM path works. If a chip succeeds and free-typed text fails, the defect is in routing, not in enforcement — the token chain below will look the same either way.",
      },
      kv: [["routing", "Heuristic match — LLM not invoked"]],
      response: {
        title: "Heuristic routing",
        text: routingDetail?.action
          ? `Matched "${routingDetail.action}" from the prompt without calling the LLM.`
          : "The BFF matched this prompt to a known intent and called the tool directly without LLM reasoning.",
      },
    });
    llmStep.title = "Heuristics — intent match & tool choice";
    llmStep.lane = "HEURISTICS";
    steps.push(llmStep);
  } else {
    steps.push(makeStep("llm", llmDetail ? "done" : traceComplete ? "notinpath" : "pending", llmDetail ? {
      request: { title: "LLM request (actual)",
        text: `model: ${llmDetail.model || "?"}\n${asJson(llmDetail.request || {})}` },
      response: { title: "LLM response — tool call", text: asJson(llmDetail.toolCalls || []) },
      kv: llmDetail.usage
        ? [["tokens used", `prompt ${llmDetail.usage.inputTokens} · completion ${llmDetail.usage.outputTokens}`]]
        : [],
    } : {}));
  }

  // 5. agent-token
  const agentTok = findEvent(tokenEvents, "agent-actor-token", "two-ex-agent-actor");
  steps.push(makeStep("agent-token", agentTok ? "done" : traceComplete ? "notinpath" : "pending", agentTok ? {
    kv: Object.entries(agentTok.claims || {}).slice(0, 6).map(([k, v]) => [k, asJson(v)]),
    response: claimsBlock("Agent actor token claims (full)", agentTok.claims),
    inspectToken: "agent",
    tokenEvent: agentTok,
  } : {}));

  // 6. exchange — "exchanged-token" (1-exchange) or "two-ex-final-token"
  // (2-exchange: the final delegated MCP token with the nested act chain).
  // Attack sims (attackSimulatorService) emit their own exchange vocabulary:
  // "sim-exchange-ok" carries the deliberately-deficient delegated token.
  const exTok = findEvent(tokenEvents, "exchanged-token", "two-ex-final-token", "sim-exchange-ok");
  const exFailed = findEvent(tokenEvents, "exchange-failed", "sim-exchange-error");
  // `|| traceComplete`: the BFF emits the exchanged-token event with status
  // "waiting" and never supersedes it, so exDone stayed false forever. On a
  // finished run that left the Exchange hop reading "in flight" while every
  // downstream hop — gateway, MCP, resource server, reply — was already done,
  // and it also blanked the card's evidence, since the detail block below is
  // gated on the same flag. Observed live 2026-08-17: node 9 stuck on
  // tcnr-node--active with nodes 10-15 all tcnr-node--done.
  //
  // A completed run cannot still be exchanging, and it cannot have got past the
  // gateway without a delegated token. A genuine failure sets exFailed, which is
  // checked before this, so nothing masks a real error.
  // Anything downstream having evidence PROVES the exchange completed: the
  // gateway cannot have introspected or authorized a delegated token, and MCP
  // cannot have returned a result, without one. That is a stronger signal than
  // traceComplete, which live runs frequently never set — the reply streams and
  // the rail shows Reply done while `outcome` stays null, so an earlier fix
  // keyed on traceComplete alone still left the hop stuck (verified live: it
  // passed a unit test that SET outcome:"ok" and changed nothing on screen).
  const exchangeProvenDownstream = !!(
    mcpResult
    || findEvent(tokenEvents, "gw-authorize")
    || findEvent(tokenEvents, "gw-introspection")
    || findEvent(tokenEvents, "gw-filter-chain")
  );
  const exDone = exTok && (exTok.status !== "waiting" || traceComplete || exchangeProvenDownstream);
  // The model answered from context without calling a tool. No tool call means
  // no delegated token was ever needed, and none of the evidence exDone waits on
  // will EVER arrive — so "active" left a finished run reading as though it were
  // still exchanging, indefinitely. Observed live 2026-08-18 on the typed-chat
  // path: node 9 rendered Reply while node 8 still said "in flight".
  //
  // Deliberately narrow. It requires a reply to exist (the run really did
  // finish) and requires the absence of every downstream signal, so it cannot
  // mask a run that is genuinely mid-exchange — that run has no reply yet — nor
  // a failure, which sets exFailed and is checked first.
  const exchangeNotRequired = !exDone && !exFailed
    && Boolean(llmReply) && !exchangeProvenDownstream;
  const ex1Tok = findEvent(tokenEvents, "two-ex-exchange1");
  const beforeScopes = splitScopes((userTok && userTok.claims && userTok.claims.scope) || []);
  const afterScopes = splitScopes((exTok && exTok.claims && exTok.claims.scope) || []);
  const exchangeWhy = exDone
    ? (afterScopes.length
      ? `This run issued a delegated token with scope “${afterScopes.join(" ")}”`
        + (exTok.audActual != null ? ` and audience ${asJson(exTok.audActual)}` : "")
        + (exTok.claims?.act ? "; the act claim proves the agent acts for this user." : ".")
      : `This run completed token exchange (${exTok.exchangeMethod || "RFC 8693"}).`)
    : exFailed
      ? `Token exchange failed — without a delegated token the MCP hop cannot run.`
      : undefined;
  const exchangeBeforeAfter = exDone && userTok && exTok ? {
    before: { title: "Before exchange", text: asJson(userTok.claims || {}) },
    after: { title: "After exchange", text: asJson(exTok.claims || {}) },
  } : undefined;
  // 2-exchange mode makes TWO RFC 8693 calls, and the chain used to show one
  // card with exchange #1 demoted to a kv row. They are separate round trips to
  // PingOne producing separate tokens — the first narrows the agent's own
  // identity, the second mints the delegated MCP token whose nested act chain
  // records both actors — so the first gets its own hop, immediately before the
  // one it feeds. 1-exchange runs emit no two-ex-exchange1 and are unchanged:
  // no extra card appears.
  if (ex1Tok) {
    const ex1Scopes = splitScopes((ex1Tok.claims && ex1Tok.claims.scope) || []);
    steps.push(makeStep("exchange-1", ex1Tok.status === "waiting" ? "active" : "done", {
      why: ex1Scopes.length
        ? `Exchange #1 issued the agent's own narrowed token with scope “${ex1Scopes.join(" ")}”.`
        : "Exchange #1 narrowed the agent's own token before the delegated exchange.",
      request: ex1Tok.exchangeRequest
        ? { title: "Exchange #1 request (actual)", text: asJson(ex1Tok.exchangeRequest) }
        : undefined,
      response: { title: "Exchange #1 token claims", text: asJson(ex1Tok.claims || {}) },
      kv: [
        ex1Tok.claims?.aud != null ? ["audience", asJson(ex1Tok.claims.aud)] : null,
        ex1Scopes.length ? ["scope", ex1Scopes.join(" ")] : null,
      ].filter(Boolean),
      tokenEvent: ex1Tok,
    }));
  }

  steps.push(makeStep("exchange",
    exFailed ? "error" : exDone ? "done" : exchangeNotRequired ? "notinpath"
      : (exTok || ex1Tok) ? "active" : "pending",
    exDone || exFailed ? {
      why: exchangeWhy,
      request: exTok?.exchangeRequest
        ? { title: "Exchange request (actual)", text: asJson(exTok.exchangeRequest) }
        : undefined,
      response: exTok
        ? { title: "Delegated token claims", text: asJson(exTok.claims || {}) }
        : undefined,
      beforeAfter: exchangeBeforeAfter,
      scopeDiff: exDone && (beforeScopes.length || afterScopes.length)
        ? { before: beforeScopes, after: afterScopes } : undefined,
      kv: exTok ? [
        exTok.claims && exTok.claims.act ? ["act chain", asJson(exTok.claims.act)] : null,
        exTok.exchangeMethod ? ["exchange method", String(exTok.exchangeMethod)] : null,
        exTok.audExpected != null
          ? ["audience", `expected ${exTok.audExpected} · actual ${exTok.audActual}${exTok.audMatches === false ? " (MISMATCH)" : ""}`]
          : null,
      ].filter(Boolean) : [],
      inspectToken: exTok ? "mcp" : undefined,
      tokenEvent: exTok || undefined,
    } : exchangeNotRequired ? {
      // Reuses the `notinpath` STATUS so every surface that already buckets
      // statuses keeps working (TokenFlowDetailModal, TokenTopologyPanel,
      // TraceStepCard, the presenter — roughly fifteen of them). A new status
      // string would render unlabelled or unstyled on all of them: right code,
      // wrong surface, which is the failure this chain work keeps hitting.
      // Only the node rail's one-line fact is overridden, and only here.
      notRequired: true,
      // Say WHY the hop did not run rather than leaving it silent. A viewer must
      // be able to tell "never happened" from "still working".
      why: "No token exchange was needed — the agent answered from context "
        + "without calling a tool, so no delegated MCP token was ever requested.",
    } : {}));

  // 7. authorize — prefer live ingestAuthorize evaluation; fall back to the
  // synthesize authorize-decision token event; finally gw-authorize (gateway
  // often holds the only P1AZ request/response on the agent/invoke path).
  //
  // Pipeline always emits phase "authorize_denied" on a gate *block*, including
  // HTTP 428 step-up / HITL. That is a challenge, not a hard DENY — paint
  // "active" (or done after PERMIT) so TraceRail does not show a false ✗.
  const azDeniedPhase = findPhase(phases, "authorize_denied");
  const azDenied = !!azDeniedPhase;
  const azBegun = hasPhase(phases, "authorize_gate_begin");
  const azUnavailable = hasPhase(phases, "authorize_unavailable");
  const azEvent = findEvent(tokenEvents, "authorize-decision");
  const azPermitted = hasPhase(phases, "authorize_permitted")
    || (authorize && authorize.decision === "PERMIT");
  const azEval = authorize || (azEvent ? {
    engine: azEvent.authorizeEngine,
    decision: azEvent.authorizeDecision || azEvent.decision,
    decisionId: azEvent.authorizeDecisionId || azEvent.decisionId,
    decisionContext: azEvent.decisionContext,
    path: azEvent.authorizePath || azEvent.path,
    request: azEvent.authorizeRequest || azEvent.request,
    response: azEvent.authorizeResponse || azEvent.response || azEvent.rawResponse,
    publicCatalog: azEvent.publicCatalog === true,
  } : null);
  const azDecision = azEval && azEval.decision != null
    ? String(azEval.decision).toUpperCase()
    : "";
  const azIsSkipped = azDecision === "SKIPPED"
    || azEval?.engine === "not-called"
    || azEval?.publicCatalog === true;
  // 428 block or a pause obligation = step-up / HITL challenge path. status
  // may arrive as a number on the phase, or only in detail ("HTTP 428") from
  // older SSE rows that did not preserve payload.status.
  let azDeniedHttp = azDeniedPhase ? Number(azDeniedPhase.status) || 0 : 0;
  if (!azDeniedHttp && azDeniedPhase && typeof azDeniedPhase.detail === "string") {
    const m = /HTTP\s+(\d+)/i.exec(azDeniedPhase.detail);
    if (m) azDeniedHttp = Number(m[1]) || 0;
  }
  // Obligation-first (phase 3c) — computed BEFORE azIsPermit/azIsDeny below,
  // and both of those now exclude it. Phase 4 shipped: a pause is PERMIT +
  // unfulfilled obligation (cloud parity — see routes/decision.js's
  // pausePermit()). Without the exclusion, `azIsPermit` (`azDecision ===
  // "PERMIT"`, decision-value-only) would have matched a phase-4 pause and won
  // the ternary below BEFORE azIsChallenge was ever consulted — the exact
  // "hard hides a pause" bug this migration exists to prevent, one level
  // deeper than the isChallenge/isDeny fix above in buildAuthorizeDetail().
  const azIsChallenge = isPause(azDecision, azEval) || azDeniedHttp === 428;
  const azIsPermit = (azPermitted || azDecision === "PERMIT") && !azIsChallenge;
  const azIsDeny = azDecision === "DENY" && !azIsChallenge;
  const azStatus = azIsSkipped ? "notinpath"
    : azIsPermit ? "done"
    : azIsDeny || azUnavailable || (azDenied && !azIsChallenge) ? "error"
    : azIsChallenge || azBegun || azEval ? "active"
    // Gateway-level denies (UC5/UC11/UC12 sims) block BEFORE Authorize is
    // consulted — once the trace completes with no evaluation, it was never
    // in this run's path.
    : traceComplete ? "notinpath"
    : "pending";
  const authorizeFailed = azStatus === "error";
  const azRequestPayload = azEval && azEval.request
    ? ((azEval.request.body && azEval.request.body.parameters)
        || azEval.request.parameters
        || azEval.request.body
        || azEval.request)
    : null;
  const authorizeWhy = azEval
    ? (azIsSkipped
      ? "PingOne Authorize was not called because this run used public catalog data."
      : azIsChallenge
      ? `Authorize returned ${azEval.decision || "INDETERMINATE"} — the human must approve before the tool proceeds.`
      : azIsDeny
        ? `Authorize denied this action (${azEval.engine || "policy"}) — the tool call is blocked.`
        : azEval.decision == null
          ? "No Authorize decision was recorded on this trace."
          : `Authorize returned ${azEval.decision}`
            + (azEval.decisionContext ? ` for the ${friendlyDecisionContext(azEval.decisionContext)}` : "")
            + (azEval.source === "gw-authorize" ? " at the Agent Gateway hop." : " before the tool ran."))
    : undefined;
  if (Array.isArray(authorizeEvaluations) && authorizeEvaluations.length) {
    // Multi-decision run (e.g. McpFirstTool gate PERMIT + Transaction/Amount
    // policy DENY) — one card per decision, in execution order.
    authorizeEvaluations.forEach((evalObj, idx) => {
      const decision = evalObj && evalObj.decision != null ? String(evalObj.decision).toUpperCase() : "";
      // A challenge-type decision (STEP_UP/HITL_REQUIRED/INDETERMINATE) is only
      // "active" (awaiting human approval) while the run is still in flight.
      // Once the trace has completed (outcome 'ok'/'error'), the challenge was
      // already satisfied earlier in the session (stepUpAlreadyVerified /
      // hitlAlreadyVerified) — render it as done, same as the single-decision
      // path already does via `traceComplete`, so a finished run never shows a
      // stale "must approve" card.
      // Obligation-first (phase 3c) — and the pause test must come BEFORE the
      // DENY test, because a phase-4 pause IS a DENY carrying an unfulfilled
      // obligation. Order reversed here for exactly that reason.
      const isChallengeRow = isPause(decision, evalObj);
      const status = isChallengeRow ? (traceComplete ? "done" : "active")
        : decision === "DENY" ? "error"
        : "done";
      const step = makeStep("authorize", status, evalObj ? buildAuthorizeDetail(evalObj) : {});
      step.id = idx === 0 ? "authorize" : `authorize:${idx + 1}`;
      step.baseId = "authorize";
      steps.push(step);
    });
  } else {
    const step = makeStep("authorize", azStatus,
      azEval ? {
        why: authorizeWhy,
        request: azRequestPayload || azEval.request
          ? { title: "Decision request (actual)",
              text: `${(azEval.request && azEval.request.method) || "POST"} ${(azEval.request && azEval.request.url) || ""}\n${asJson(azRequestPayload || azEval.request)}` }
          : undefined,
        response: azEval.response
          ? { title: "Decision response (raw)", text: asJson(azEval.response) } : undefined,
        // Missing decision = nothing recorded, never claim a P1AZ verdict.
        decision: { outcome: azEval.decision || "NOT_RECORDED",
          label: azIsSkipped
            ? "SKIPPED — public catalog path"
            : `${azEval.decision || "no decision recorded"} — ${azEval.engine || "?"}${azEval.decisionContext ? ` (${friendlyDecisionContext(azEval.decisionContext)})` : ""}` },
        kv: [
          ["engine", String(azEval.engine || "")],
          ["decision id", String(azEval.decisionId || "")],
          azEval.source === "gw-authorize" ? ["evidence", "from gw-authorize (gateway hop)"] : null,
        ].filter((row) => row && row[1]),
        moreDetail: { edu: EDU.PINGONE_AUTHORIZE, label: "Learn: PingOne Authorize" },
        replay: buildAuthorizeReplay(azEval, azRequestPayload),
      } : {});
    step.baseId = "authorize";
    steps.push(step);
  }

  // 7a. step-up (conditional) — omitted mid-flight so it doesn't sit "pending"
  // for runs that will never need it; once the trace completes without a
  // challenge, show it as notinpath rather than silently disappearing.
  const stepUpStarted = hasPhase(phases, "mfa_challenge_initiated");
  const stepUpDone = hasPhase(phases, "mfa_challenge_completed");
  const stepUpFailed = hasPhase(phases, "mfa_challenge_failed");
  if (stepUpStarted || stepUpDone || stepUpFailed) {
    steps.push(makeStep("stepup",
      stepUpFailed ? "error" : stepUpDone ? "done" : "active", {
        kv: phases.filter((p) => p.phase && p.phase.startsWith("mfa_challenge"))
          .map((p) => [p.phase, p.label || ""]),
      }));
  } else if (traceComplete) {
    steps.push(makeStep("stepup", "notinpath", {
      narrative: "PingOne Authorize did not demand step-up for this action — no HITL/CIBA/MFA challenge was required.",
    }));
  }

  // 7b. intent-binding — RAR (RFC 9396) intent verification. Same gating as
  // step-up: omit mid-flight (not part of the default BFF→gateway chain;
  // only the Intent Binding learning demo / UC14 emit evidence). Once the
  // trace completes without evidence, mark notinpath rather than pending.
  const intentVerifiedEvent = (tokenEvents || []).find((e) => e.id === "intent-binding-verified");
  const intentDeniedEvent = (tokenEvents || []).find(
    (e) => e.id === "sim-gateway-deny" && (e.error === "rar_amount_exceeded" || e.error === "rar_unexpected_deny"),
  );
  if (intentVerifiedEvent || intentDeniedEvent) {
    // Permit carries its own request/response (the real create_transfer call
    // + gateway result). Deny never reaches a backend response, so "request"
    // comes from the sibling sim-rar-grant event (the attempted over-cap
    // call) and "response" is reconstructed from the deny event's own
    // error/httpStatus/explanation — both already present on these events,
    // no change to the protected _denyFromGateway needed. buildSimRailEvents
    // (attack-sim path) renames sim-rar-grant -> rar-authorization, so match
    // both ids.
    const rarGrantEvent = findEvent(tokenEvents, "sim-rar-grant", "rar-authorization");
    const request = intentVerifiedEvent?.request || rarGrantEvent?.request || null;
    const response = intentVerifiedEvent
      ? intentVerifiedEvent.response
      : intentDeniedEvent
        ? { status: intentDeniedEvent.httpStatus, errorCode: intentDeniedEvent.error, reason: intentDeniedEvent.explanation }
        : null;
    steps.push(makeStep("intent-binding", intentVerifiedEvent ? "done" : "error", {
      tokenEvent: intentVerifiedEvent || intentDeniedEvent || null,
      request: request ? { title: "Request", text: asJson(request) } : undefined,
      response: response ? { title: "Response", text: asJson(response) } : undefined,
    }));
  } else if (traceComplete) {
    steps.push(makeStep("intent-binding", "notinpath", {
      narrative: "RFC 9396 RAR intent binding was not armed for this run (ff_rar off / no authorization_details attest) — not required on the default token path.",
    }));
  }

  // 8. gateway — gw-introspection/gw-mtls can arrive with status "skipped"
  // (the BFF's own signal that this leg was never part of the run: mTLS off,
  // introspection not enabled). That alone must not count as "seen" — only
  // real activity does.
  const gwAz = findEvent(tokenEvents, "gw-authorize");
  // The gateway is not one hop. It runs an ordered filter chain and publishes it
  // in X-Gw-Authorize-Trail, which mcpToolPipeline forwards on gw-filter-chain
  // (dedicated event) or as an extra on gw-authorize. Three of those stages are
  // real outbound calls — RFC 7662 introspection, the gateway's OWN PingOne
  // Authorize decision (distinct from the BFF's), and its OWN RFC 8693 exchange
  // for the upstream audience — so collapsing them into a single "Gateway" box
  // hid both the work and the second PDP call entirely. The evidence was already
  // on the wire; nothing read it.
  const gwFilterChainEvent = findEvent(tokenEvents, "gw-filter-chain");
  const gwStages = (Array.isArray(gwFilterChainEvent?.filterChain) && gwFilterChainEvent.filterChain)
    || (Array.isArray(gwAz?.filterChain) && gwAz.filterChain)
    || null;
  const gwDenyingFilter = gwFilterChainEvent?.denyingFilter || gwAz?.denyingFilter || null;
  const gwLastFilter = gwFilterChainEvent?.lastFilter || gwAz?.lastFilter || null;
  const gwIntroRaw = findEvent(tokenEvents, "gw-introspection");
  const gwIntro = gwIntroRaw && gwIntroRaw.status !== "skipped" ? gwIntroRaw : null;
  const gwMtls = findEvent(tokenEvents, "gw-mtls");
  const gwInbound = findEvent(tokenEvents, "evt-inbound");
  const gwScope = findEvent(tokenEvents, "evt-scope");
  const gwDeniedPhase = findPhase(phases, "gateway_policy_denied");
  // Attack sims emit "sim-gateway-deny" instead of a phase. RAR denies
  // (rar_amount_exceeded / rar_unexpected_deny) already feed the
  // intent-binding step above and must not double-report here.
  const simGwDeny = (tokenEvents || []).find(
    (e) => e && e.id === "sim-gateway-deny"
      && e.error !== "rar_amount_exceeded" && e.error !== "rar_unexpected_deny",
  );
  const gwDenied = !!gwDeniedPhase || !!simGwDeny;
  const gwSeen = !!(gwAz || gwIntro || gwInbound || gwScope);
  const gwSkipEvidence = [gwIntroRaw, gwMtls].filter((e) => e && e.status === "skipped");
  steps.push(makeStep("gateway",
    authorizeFailed ? "notinpath" : gwDenied ? "error" : gwSeen ? "done" : traceComplete ? "notinpath" : "pending",
    (gwSeen || gwDenied) ? {
      stages: buildGatewayStages(gwStages, gwDenyingFilter),
      why: gwDenied
        ? "The Agent Gateway blocked this call before it reached the MCP server."
          + (gwDenyingFilter ? ` The chain stopped at ${GW_STAGE_META[gwDenyingFilter]?.label || gwDenyingFilter}.` : "")
        : (gwAz
          ? `Gateway validated the delegated token`
            + (gwAz.tool ? ` and authorized tool “${gwAz.tool}”` : "")
            + (gwAz.decision ? ` (${gwAz.decision}).` : ".")
            + (gwLastFilter ? ` It ran its filter chain through ${GW_STAGE_META[gwLastFilter]?.label || gwLastFilter}.` : "")
          : "Gateway processed the inbound delegated bearer on this hop."),
      decision: gwDenied
        ? { outcome: "DENY",
            // serverEvents rows use "—" as the empty-detail placeholder
            label: `DENY — ${(gwDeniedPhase
              ? (gwDeniedPhase.detail && gwDeniedPhase.detail !== "—" ? gwDeniedPhase.detail : gwDeniedPhase.label)
              : (simGwDeny.label || simGwDeny.explanation)) || "gateway policy"}` }
        : undefined,
      kv: [
        gwIntro ? ["introspection", gwIntro.status === "active" ? "✓ active" : String(gwIntro.status)] : null,
        gwAz ? ["authorize", `${gwAz.decision || "?"}${gwAz.url ? ` — ${gwAz.url}` : ""}`] : null,
        gwAz && gwAz.statements ? ["statements", gwAz.statements] : null,
        gwInbound ? ["inbound", gwInbound.label || "user bearer received"] : null,
        gwScope ? ["scope gate", gwScope.label || "scope checked before swap"] : null,
        // invalid_aud teaching: show both sides of the mismatch (token vs gateway).
        (() => {
          const tokenAud = simGwDeny?.triedAudience || simGwDeny?.tokenAud
            || gwDeniedPhase?.triedAudience || gwDeniedPhase?.tokenAud
            || null;
          const expectedAud = simGwDeny?.allowedAudience || simGwDeny?.expectedAud
            || gwDeniedPhase?.allowedAudience || gwDeniedPhase?.expectedAud
            || null;
          if (tokenAud == null && expectedAud == null) return null;
          const actual = tokenAud != null
            ? (Array.isArray(tokenAud) ? tokenAud.join(", ") : String(tokenAud))
            : "(unknown)";
          const expected = expectedAud != null
            ? (Array.isArray(expectedAud) ? expectedAud.join(", ") : String(expectedAud))
            : "(unknown)";
          return ["audience", `token ${actual} · gateway expects ${expected} (MISMATCH)`];
        })(),
        simGwDeny ? ["attack sim", simGwDeny.explanation || simGwDeny.label] : null,
      ].filter(Boolean),
      request: (() => {
        if (!gwAz) return undefined;
        const params = gwAz.parameters
          || gwAz.authorizeRequest?.parameters
          || gwAz.authorizeRequest?.body?.parameters
          || gwAz.authorizeRequest
          || null;
        if (!params) return undefined;
        return {
          title: "Gateway → P1AZ request (actual)",
          text: `${gwAz.url ? `POST ${gwAz.url}\n` : ""}${asJson(params)}`,
        };
      })(),
      response: (() => {
        if (!gwAz) {
          return gwIntro && gwIntro.rawResponse
            ? { title: "Introspection response (RFC 7662)", text: asJson(gwIntro.rawResponse) }
            : undefined;
        }
        const body = gwAz.rawResponse || gwAz.authorizeResponse || null;
        return body
          ? { title: "Gateway authorize response", text: asJson(body) }
          : undefined;
      })(),
      // This is the Agent Gateway hop — its education topic is the Agent
      // Gateway (not P1AZ, which has its own step + education link above).
      moreDetail: { edu: EDU.AGENT_GATEWAY, label: "Learn: Agent Gateway" },
      replay: buildGatewayReplay(mcpResult, gwAz, simGwDeny),
    } : !gwSeen && !gwDenied && gwSkipEvidence.length ? {
      narrative: gwSkipEvidence.map((e) => e.explanation).filter(Boolean).join(" ") ||
        "The Agent Gateway was not in this run's path.",
    } : {}));

  // 8b. api-key-swap — Path A credential swap (evt-swap / evt-backend from gateway _meta)
  const evtSwap = findEvent(tokenEvents, "evt-swap");
  const evtBackend = findEvent(tokenEvents, "evt-backend");
  const apiMetaEarly = (mcpResult && mcpResult._meta) || {};
  const apiKeyPath =
    apiMetaEarly.credentialPath === "api_key" ||
    !!(evtSwap || evtBackend) ||
    tokenEvents.some((e) => e && e.credentialPath === "api_key");
  const apiKeySwapDone = apiKeyPath && (evtSwap || evtBackend || apiMetaEarly.credentialPath === "api_key");
  steps.push(makeStep("api-key-swap",
    authorizeFailed ? "notinpath" : apiKeySwapDone ? "done" : traceComplete ? "notinpath" : "pending",
    apiKeyPath ? {
      kv: [
        evtSwap ? ["swap", evtSwap.label || "OAuth bearer → service API key"] : null,
        evtSwap && evtSwap.maskedValue ? ["service key", evtSwap.maskedValue] : null,
        evtBackend ? ["outbound", evtBackend.label || "backend call with X-API-Key"] : null,
        apiMetaEarly.apiCall ? ["api call", apiMetaEarly.apiCall] : null,
        apiMetaEarly.apiKeyMaskedLast4 ? ["key last4", `••••${apiMetaEarly.apiKeyMaskedLast4}`] : null,
      ].filter(Boolean),
      response: evtSwap || evtBackend
        ? { title: "API-key path events", text: asJson([evtSwap, evtBackend].filter(Boolean)) }
        : undefined,
    } : !apiKeySwapDone && traceComplete ? {
      narrative: "This run used the delegated OAuth bearer path — no API-key credential swap occurred.",
    } : {}));

  // 8c. tools/call #1 — the same handshake on invocation: a credential-less
  // tools/call the gateway refuses at its own edge, so nothing reaches the MCP
  // server. Sits directly before the authorized call it precedes.
  steps.push(buildChallengeStep("tools-call-challenge", "tools/call", tokenEvents, traceComplete));

  // 8d. The MCP lifecycle handshake is NOT a hop here.
  // A tool call over an already-open session is one message, not three. The
  // session is opened by the Agent Gateway during tool DISCOVERY — traced live
  // 2026-08-18: the tool-call leg produces initialize /
  // notifications/initialized / tools/list on the MCP server and no tools/call
  // at all, on a connection opened and closed per discovery request.
  //
  // Two earlier shapes were both wrong. As cards between the gateway and the MCP
  // call they claimed a session is negotiated per invocation. Moved next to
  // discovery they were honest but blank on any chain built from a single invoke
  // response, because the session belongs to the earlier request. The evidence
  // now hangs off the `tools-list` hop that caused it (see `handshake` in its
  // detail), so the chain states the protocol correctly and carries no card that
  // is empty most of the time.

  // 9. mcp + 10. api + 11. database — a gateway denial means the call never reached the MCP
  // server; surface that as an error instead of leaving the step stuck "active".
  // A failed MCP tool call still carries a `result` (e.g. { error, message }
  // for TraceRail), so `mcpResult.result` alone can't distinguish success from
  // failure — check mcpResult.status explicitly.
  const mcpErrored = !!(mcpResult && mcpResult.status === "error");
  const mcpDone = !mcpErrored && (hasPhase(phases, "mcp_remote_done") || !!(mcpResult && mcpResult.result));
  const mcpBegun = hasPhase(phases, "mcp_remote_begin");
  steps.push(makeStep("mcp",
    authorizeFailed ? "notinpath" : mcpDone ? "done" : (gwDenied || mcpErrored) ? "error" : mcpBegun ? "active" : traceComplete ? "notinpath" : "pending",
    mcpResult ? {
      why: mcpErrored
        ? `MCP call failed for “${mcpResult.tool || mcpResult.toolName || "tool"}”${mcpResult.error ? ` (${mcpResult.error})` : ""}.`
        : `MCP executed “${mcpResult.tool || mcpResult.toolName || "tool"}”`
          + (mcpResult.durationMs != null ? ` in ${mcpResult.durationMs} ms` : "")
          + " under the delegated identity.",
      request: { title: "JSON-RPC call (actual)", text: asJson(mcpResult.requestJson || { name: mcpResult.tool }) },
      kv: mcpResult.durationMs != null ? [["duration", `${mcpResult.durationMs} ms`]] : [],
      moreDetail: { edu: EDU.MCP_PROTOCOL, label: "Learn: MCP Protocol" },
      replay: buildMcpReplay(mcpResult),
    } : gwDenied ? {
      why: "MCP never ran — the gateway denied the call upstream.",
    } : {}));
  const apiMeta = apiMetaEarly;
  const apiKeyCall = apiMeta.credentialPath === "api_key" || apiKeyPath;
  const backendInfo = resolveBackendLabel(mcpResult?.tool || mcpResult?.toolName, apiMeta);
  const apiStep = makeStep("api", authorizeFailed ? "notinpath" : (mcpDone && mcpResult) || apiKeyCall ? "done" : traceComplete ? "notinpath" : "pending",
    mcpResult && (mcpResult.result || apiKeyCall) ? {
      narrative: apiKeyCall
        ? "Backend call after credential swap — X-API-Key + X-User-Sub (no OAuth bearer on the wire)."
        : (mcpResult.denied && mcpResult.expected)
          ? "Expected DENY — the gateway blocked this out-of-scope call before the resource server ran. That block is the control working as designed, not a failure."
          : "The actual resource-server call made with the delegated bearer token.",
      response: mcpResult.result ? { title: "API result", text: asJson(mcpResult.result) } : undefined,
      kv: [
        backendInfo ? ["service", backendInfo.label] : null,
        apiKeyCall && apiMeta.apiCall ? ["api call", apiMeta.apiCall] : null,
        apiKeyCall && apiMeta.apiKeyMaskedLast4 ? ["service key", `••••${apiMeta.apiKeyMaskedLast4}`] : null,
        evtBackend ? ["backend", evtBackend.label] : null,
      ].filter(Boolean),
    } : {});
  if (backendInfo) {
    apiStep.title = `${backendInfo.label} — resource server`;
    apiStep.lane = backendInfo.lane;
  }
  steps.push(apiStep);

  const databaseInfo = resolveDatabaseInfo(
    mcpResult?.result,
    mcpResult?.tool || mcpResult?.toolName,
  );
  const databaseStep = makeStep("database",
    authorizeFailed ? "notinpath" : databaseInfo ? "done" : traceComplete ? "notinpath" : "pending",
    databaseInfo ? {
      narrative: databaseInfo.isUnited
        ? "The United Airlines resource server queried its real SQLite database and returned stored operational data."
        : `The resource server queried its ${databaseInfo.engine} database and returned stored data.`,
      kv: [
        ["engine", databaseInfo.engine],
        ["reported source", databaseInfo.source],
      ],
      response: { title: "Database-backed result", text: asJson(mcpResult.result) },
    } : {});
  if (databaseInfo?.isUnited) {
    databaseStep.title = "SQL Database — United Airlines data";
  }
  steps.push(databaseStep);

  // 12. reply — heuristics compose from the tool result (no LLM); chip paths
  // often have mcpResult but no llmReply, so either evidence marks the step done.
  const replyDone = Boolean(llmReply) || (isHeuristic && mcpDone);
  const replyStep = makeStep("reply", replyDone ? "done" : traceComplete ? "notinpath" : "pending",
    llmReply ? {
      response: { title: "Streamed reply", text: String(llmReply) },
    } : isHeuristic && mcpDone ? {
      narrative: "Heuristics formatted the tool result into the chat reply — no LLM composition.",
      response: mcpResult && mcpResult.result
        ? { title: "Composed reply (from tool result)", text: asJson(mcpResult.result) }
        : undefined,
    } : {});
  if (isHeuristic) {
    replyStep.title = "Heuristics composes reply → chat";
    replyStep.lane = "HEURISTICS";
  }
  steps.push(replyStep);

  return steps.map((s, i) => ({ ...s, num: i + 1 }));
}
