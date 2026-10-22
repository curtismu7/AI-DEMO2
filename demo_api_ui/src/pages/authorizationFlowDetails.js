// What is really happening at each arrow of the Authorization Flow: a plain-English account, the HTTP request and
// response, the token in play with every claim explained, and what the boundary checks. Values are illustrative
// (this page is scripted) but the shapes are the real ones: PingOne's /as/authorize, /as/token (RFC 8693 token
// exchange), /as/bc-authorize (CIBA) and the PingOne Authorize decision endpoint.

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ENV = "ENV_ID";
const AS = `https://auth.pingone.com/${ENV}/as`;
const CLIENT = "assistant-connector";
const SUB = "usr_8f3a21c4";
const NOW = 1792600000;

const json = (o) => JSON.stringify(o, null, 2);
const http = (method, url, headers, body) => {
  const u = new URL(url);
  const head = [`${method} ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`, ...Object.entries(headers || {}).map(([k, v]) => `${k}: ${v}`)];
  return `${head.join("\n")}${body ? `\n\n${body}` : ""}`;
};
const reply = (status, headers, body) => `HTTP/1.1 ${status}${Object.entries(headers || {}).map(([k, v]) => `\n${k}: ${v}`).join("")}${body ? `\n\n${body}` : ""}`;
const form = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join("\n&");

function ctxFor(profile, n) {
  const org = slug(profile.org.replace(/^the /, ""));
  const readScope = `${slug(profile.read.noun)}.read`;
  const payScope = `${slug(profile.pay.noun)}.execute`;
  return {
    p: profile,
    n,
    org,
    readScope,
    payScope,
    connectAud: `https://connect.${org}.example`,
    gatewayAud: `https://gateway.${org}.example`,
    coreAud: `https://core.${org}.example`,
    asPrefix: "assistant:",
  };
}

// A decoded token: rows of [claim, value, meaning, important].
const claims = (rows) => rows.map(([claim, value, meaning, key]) => ({ claim, value, meaning, key: Boolean(key) }));

function connectToken(c) {
  return {
    name: "Connect token", idx: 1, summary: "Proves the customer connected the assistant. Useless against the business: wrong audience, exchange input only.",
    claims: claims([
      ["iss", `${AS}`, "PingOne issued it."],
      ["sub", SUB, "The customer who consented.", true],
      ["aud", c.connectAud, "The exchange edge only. The business API will refuse this audience.", true],
      ["scope", `${c.readScope} ${c.payScope}`, "What the customer agreed the assistant may ask for. The $50 limit is not in the token: it is policy."],
      ["client_id", CLIENT, "The assistant's connector app."],
      ["exp", `${NOW + 3600}`, "One hour. A refresh can extend the session, never the authority."],
    ]),
  };
}
function delegatedToken(c, pay) {
  return {
    name: "Delegated token", idx: 2, summary: "Minted at Exchange 1 only after PingOne confirms the delegation is still live. Names the customer AND the assistant.",
    claims: claims([
      ["iss", `${AS}`, "PingOne issued it."],
      ["sub", SUB, "Still the customer: the assistant never becomes the subject.", true],
      ["act", json({ sub: CLIENT }).replace(/\n\s*/g, " "), "The actor: who is acting on the customer's behalf (RFC 8693).", true],
      ["aud", c.gatewayAud, "The gateway for this call, not the business API.", true],
      ["scope", pay ? `${c.asPrefix}pay` : `${c.asPrefix}read`, "Narrowed to this one kind of call.", true],
      ["exp", `${NOW + 300}`, "Five minutes."],
      ["jti", "9b1d5e02-3c1a-4f7e", "Unique id, so the token can be audited and not replayed."],
    ]),
  };
}
function audienceToken(c, pay, approval) {
  const rows = [
    ["iss", `${AS}`, "PingOne issued it."],
    ["sub", SUB, "The customer. The system of record serves only this person.", true],
    ["aud", c.coreAud, `Only the ${c.p.core.label} accepts it. It cannot be passed on.`, true],
    ["scope", pay ? c.payScope : c.readScope, `The business's own vocabulary: ${c.asPrefix}${pay ? "pay" : "read"} became ${pay ? c.payScope : c.readScope}.`, true],
    ["exp", `${NOW + 300}`, "Five minutes. No onward delegation."],
  ];
  if (approval) {
    rows.push(["amr", json(["bc", "mfa"]).replace(/\n\s*/g, " "), "Fresh out-of-band approval (CIBA) with a second factor.", true]);
    rows.push(["approval", json({ proposal: "prop_7c20", terms: "sha256:e3b0…52b8" }).replace(/\n\s*/g, " "), "Binds the approval to this proposal and these exact terms.", true]);
  }
  return { name: "Audience token", idx: 3, summary: "Minted at Exchange 2 for the final hop, in the business's own vocabulary and audience.", claims: claims(rows) };
}

const DETAILS = {
  "ask-read": (c) => ({
    what: `The customer asks their own assistant: "${c.p.read.ask}". The assistant is the customer's app, not ${c.p.org}'s.`,
    why: `${c.p.org} does not control the assistant, so nothing it says is trusted. Everything it does later has to be proven with tokens.`,
    request: `Customer → assistant (chat message)\n"${c.p.read.ask}"`,
    checks: ["Nothing is checked here: this is a conversation, not a call to the business."],
  }),
  "ask-pay": (c) => ({
    what: `The customer asks their own assistant: "${c.p.pay.ask(c.n)}". The assistant is the customer's app, not ${c.p.org}'s.`,
    why: `${c.p.org} does not control the assistant. It can ask for a ${c.p.pay.noun}; it can never complete one on its own.`,
    request: `Customer \u2192 assistant (chat message)\n"${c.p.pay.ask(c.n)}"`,
    checks: ["Nothing is checked here: this is a conversation, not a call to the business."],
  }),
  "ask-connect": (c) => ({
    what: `The customer tells the assistant to connect to ${c.p.org}.`,
    why: "Connecting is the moment the customer, not the assistant, decides what the assistant may do.",
    request: `Customer → assistant (chat message)\n"Connect to ${c.p.org}"`,
    checks: ["Nothing yet. The assistant now has to ask the customer to sign in and consent."],
  }),
  "call-tool-read": (c) => ({
    what: `The assistant picks the tool ${c.p.read.tool} from the connector ${c.p.org} published for this AI platform.`,
    why: "The business publishes one connector per AI platform, so there is no dynamic client registration to manage.",
    request: json({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: c.p.read.tool, arguments: {} } }),
    checks: ["The tool exists in the published connector."],
  }),
  "call-no-token": (c) => ({
    what: "The platform forwards the tool call. There is no Authorization header, because the customer never connected.",
    why: "No connection means there is nothing to prove delegation with.",
    request: http("POST", `${c.gatewayAud}/mcp`, { "Content-Type": "application/json" }, json({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: c.p.read.tool } })),
    checks: ["Is there a bearer token? No."],
  }),
  "refuse-401": (c) => ({
    what: `The edge refuses before anything reaches ${c.p.org}. The 401 points the assistant at where to start the connection.`,
    why: "Permission must come first. A refused call costs the business nothing and leaks nothing.",
    response: reply("401 Unauthorized", { "WWW-Authenticate": `Bearer resource_metadata="${c.gatewayAud}/.well-known/oauth-protected-resource"` }, json({ error: "unauthorized", error_description: "Connect required" })),
    checks: ["Bearer token present: no", "Result: refused at the edge, nothing forwarded"],
    refused: true,
  }),
  "connector-signin": (c) => ({
    what: "The assistant starts the connector's sign-in. This is a standard OAuth authorization-code flow with PKCE.",
    why: "PKCE means a stolen authorization code is useless without the assistant's secret verifier.",
    request: `Assistant opens the sign-in for ${c.p.org}`,
    checks: ["Redirect URI matches the connector's registered one."],
  }),
  "authorize-req": (c) => ({
    what: "The platform sends the customer to PingOne to sign in and approve the connection.",
    why: "Identity and consent live at PingOne, not in the assistant.",
    request: http("GET", `${AS}/authorize?response_type=code&client_id=${CLIENT}&redirect_uri=https%3A%2F%2Fplatform.example%2Fcallback&scope=${encodeURIComponent(`${c.readScope} ${c.payScope}`)}&resource=${encodeURIComponent(c.connectAud)}&code_challenge=E9Melhoa…&code_challenge_method=S256`, {}),
    checks: ["client_id is a registered connector", "code_challenge present (PKCE)", "resource is the exchange edge, not the business"],
  }),
  "sign-in": () => ({
    what: "PingOne signs the customer in on its own page, with whatever factors the policy requires.",
    why: "The assistant never sees the customer's password or factors.",
    response: reply("302 Found", { Location: "https://auth.pingone.com/ENV_ID/as/resume?flowId=…" }),
    checks: ["Credentials verified by PingOne", "Risk evaluated (pass, step up or refuse)"],
  }),
  consent: (c) => ({
    what: `The customer sees exactly what the assistant is asking for and approves it: read your ${c.p.read.noun}, and act for you up to $50.`,
    why: "Consent creates authority. The record of it is what every later exchange is checked against.",
    request: json({ subject: SUB, actor: CLIENT, scopes: [c.readScope, c.payScope], limit: "$50 per action, approval required", expires: "30 days" }),
    checks: ["The customer, not the assistant, pressed Approve"],
  }),
  "record-delegation": (c) => ({
    what: "The consent service writes a live delegation record: who may act, for whom, for what, and until when.",
    why: "Exchange 1 re-reads this record every time. Revoke it and the next call loses its authority.",
    response: json({ delegation: { subject: SUB, actor: CLIENT, scopes: [c.readScope, c.payScope], status: "active" } }),
    checks: ["Record stored", "Subject and actor named separately"],
  }),
  "connect-token": (c) => ({
    what: "PingOne returns the connect token to the assistant's platform.",
    why: "The assistant now holds something it can present, but the token cannot call the business: its only job is to be exchanged.",
    request: http("POST", `${AS}/token`, { "Content-Type": "application/x-www-form-urlencoded" }, form({ grant_type: "authorization_code", code: "SplxlOBe…", code_verifier: "dBjftJeZ…", client_id: CLIENT })),
    response: reply("200 OK", { "Content-Type": "application/json" }, json({ access_token: "eyJhbGciOi…", token_type: "Bearer", expires_in: 3600, scope: `${c.readScope} ${c.payScope}` })),
    token: connectToken(c),
    checks: ["Authorization code and PKCE verifier match", "Audience is the exchange edge only"],
    ok: true,
  }),
  "call-with-token": (c) => ({
    what: `The assistant calls the tool again, this time presenting the connect token.`,
    why: "The edge treats this token as input only. It is never forwarded to the business.",
    request: http("POST", `${c.gatewayAud}/mcp`, { Authorization: "Bearer <connect token>", "Content-Type": "application/json" }, json({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: c.p.read.tool } })),
    token: connectToken(c),
    checks: ["Token signature valid (PingOne JWKS)", "Not expired", "Audience is this edge"],
  }),
  "call-prepare": (c) => ({
    what: `The assistant asks ${c.p.org} to prepare "${c.p.pay.what(c.n)}" with ${c.p.pay.tool}. Preparing is not paying.`,
    why: "The business writes the terms. The model cannot invent or change them.",
    request: http("POST", `${c.gatewayAud}/mcp`, { Authorization: "Bearer <connect token>", "Content-Type": "application/json" }, json({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: c.p.pay.tool, arguments: { amount: c.n, currency: "USD", step: "prepare" } } })),
    token: connectToken(c),
    checks: ["Token valid", "This is a PREPARE, which commits nothing"],
  }),
  "exchange1-req": (c) => ({
    what: "Exchange 1. The edge trades the connect token to PingOne for a delegated token, naming the audience and scope it needs.",
    why: "PingOne re-checks the live delegation record at this moment. This is where a revoked consent dies.",
    request: http("POST", `${AS}/token`, { "Content-Type": "application/x-www-form-urlencoded" }, form({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "<connect token>",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: c.gatewayAud,
      scope: `${c.asPrefix}${c.__pay ? "pay" : "read"}`,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    })),
    token: connectToken(c),
    checks: ["Connect token is valid", "A live delegation exists for this customer and this assistant", "Requested scope is within what was consented"],
  }),
  "exchange1-res": (c) => ({
    what: "PingOne mints the delegated token. It carries sub (the customer) and act (the assistant), narrowed to this call.",
    why: "From here on, every system can see both who the customer is and who is acting for them.",
    response: reply("200 OK", { "Content-Type": "application/json" }, json({ access_token: "eyJhbGciOi…", issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", expires_in: 300 })),
    token: delegatedToken(c, Boolean(c.__pay)),
    checks: ["Delegation confirmed live", "Authority narrowed to this call and five minutes"],
    ok: true,
  }),
  forward: (c) => ({
    what: "The edge forwards only the fresh delegated token. The assistant never sees it.",
    why: "The connect token stops at the edge. The assistant cannot reuse what it does not hold.",
    request: http("POST", `${c.gatewayAud}/mcp/internal`, { Authorization: "Bearer <delegated token>" }),
    token: delegatedToken(c, Boolean(c.__pay)),
    checks: ["Edge dropped the connect token", "Only the delegated token continues"],
  }),
  "decide-read": (c) => ({
    what: "PingGateway validates the token and asks PingOne Authorize whether this reading is allowed.",
    why: "Business rules live in policy, outside application code, so they can change without a deploy.",
    request: http("POST", `https://api.pingone.com/v1/environments/${ENV}/decisionEndpoints/DECISION_ID`, { Authorization: "Bearer <worker token>" }, json({ parameters: { DecisionContext: "McpToolCall", McpTool: c.p.read.tool, Subject: SUB, Actor: CLIENT, Scope: `${c.asPrefix}read` } })),
    token: delegatedToken(c, false),
    checks: ["Signature, audience and expiry", "Actor is a registered assistant", "Policy: reading is allowed"],
  }),
  "decide-pay": (c) => ({
    what: `PingGateway asks PingOne Authorize about this ${c.p.pay.noun} of $${c.n}.`,
    why: c.n > 50 ? "The $50 limit is a policy rule, not code. It is enforced before anything reaches the business or the customer's phone." : "$25 is within the $50 limit, so policy allows the preparation to continue.",
    request: http("POST", `https://api.pingone.com/v1/environments/${ENV}/decisionEndpoints/DECISION_ID`, { Authorization: "Bearer <worker token>" }, json({ parameters: { DecisionContext: "McpToolCall", McpTool: c.p.pay.tool, Subject: SUB, Actor: CLIENT, Amount: c.n, Currency: "USD" } })),
    token: delegatedToken(c, true),
    checks: ["Signature, audience and expiry", `Policy: amount $${c.n} versus the $50 limit`],
  }),
  permit: (c) => ({
    what: "PingOne Authorize answers PERMIT.",
    why: "The decision is final at the boundary: the tool layer never sees a denied call.",
    response: json({ decision: "PERMIT", statements: [], obligations: [] }),
    checks: ["Decision: PERMIT", c.__pay ? "Amount within the limit" : "Read allowed"],
    ok: true,
  }),
  deny: (c) => ({
    what: `PingOne Authorize answers DENY: $${c.n} is over the $50 limit.`,
    why: "The assistant cannot talk its way past this. No proposal is created and no push goes to the phone.",
    response: json({ decision: "DENY", statements: [{ code: "amount_over_limit", limit: 50, requested: c.n }] }),
    checks: ["Decision: DENY (amount_over_limit)", "Nothing forwarded to the tool layer", "No device push"],
    refused: true,
  }),
  "refused-gw": (c) => ({
    what: "The gateway returns the refusal to the assistant, which tells the customer.",
    why: "If the business says no, the assistant says no. There is no override.",
    response: reply("403 Forbidden", { "Content-Type": "application/json" }, json({ error: "policy_denied", reason: "amount_over_limit" })),
    checks: ["Refusal enforced independently of the assistant"],
    refused: true,
  }),
  "gw-to-ms": (c) => ({
    what: "The gateway forwards the permitted call to the tool layer with the delegated token.",
    why: "The tool layer does not trust the boundary: it re-validates the token itself.",
    request: http("POST", `https://mcp.${c.org}.example/mcp`, { Authorization: "Bearer <delegated token>", "Content-Type": "application/json" }, json({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: c.__pay ? c.p.pay.tool : c.p.read.tool, arguments: c.__pay ? { amount: c.n, step: "prepare" } : {} } })),
    token: delegatedToken(c, Boolean(c.__pay)),
    checks: ["Token re-validated independently", "Audience is the tool layer's own"],
  }),
  "exchange2-req": (c) => ({
    what: "Exchange 2. The tool layer trades the delegated token for one the system of record will accept.",
    why: `The ${c.p.core.label} only accepts tokens for its own audience, in its own scope vocabulary.`,
    request: http("POST", `${AS}/token`, { "Content-Type": "application/x-www-form-urlencoded" }, form({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "<delegated token>",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: c.coreAud,
      scope: c.__pay ? c.payScope : c.readScope,
    })),
    token: delegatedToken(c, Boolean(c.__pay)),
    checks: ["Live delegation checked again", `Scope ${c.asPrefix}${c.__pay ? "pay" : "read"} maps to ${c.__pay ? c.payScope : c.readScope}`],
  }),
  "exchange2-res": (c) => ({
    what: "PingOne mints the audience token: the end of the chain.",
    why: "It cannot be passed on. Even if it leaked, it only works at one system, for five minutes.",
    response: reply("200 OK", { "Content-Type": "application/json" }, json({ access_token: "eyJhbGciOi…", token_type: "Bearer", expires_in: 300 })),
    token: audienceToken(c, Boolean(c.__pay), false),
    checks: ["Audience is the system of record only", "No onward delegation"],
    ok: true,
  }),
  "core-read": (c) => ({
    what: `The tool layer reads from the ${c.p.core.label} with the audience token.`,
    why: "The system of record accepts only its own audience and serves only the customer the token names.",
    request: http("GET", `https://core.${c.org}.example/v1/${slug(c.p.read.noun)}`, { Authorization: "Bearer <audience token>" }),
    token: audienceToken(c, false, false),
    checks: ["Audience matches", "Scope is read-only", "Data returned is only this customer's"],
  }),
  "read-result": (c) => ({
    what: "The answer flows back to the assistant and on to the customer.",
    why: "Only this customer's own data crossed the boundary, and only because every hop re-proved authority.",
    response: reply("200 OK", { "Content-Type": "application/json" }, json({ [slug(c.p.read.noun)]: c.p.read.reply })),
    checks: ["Every hop re-checked authority"],
    ok: true,
  }),
  proposal: (c) => ({
    what: `${c.p.org} prepares the proposal: "${c.p.pay.what(c.n)}", locked with a terms digest.`,
    why: "The terms (what, how much, when) are the business's, locked by a digest. If anyone changes them, the commit fails.",
    response: json({ proposal_id: "prop_7c20", summary: c.p.pay.what(c.n), amount: c.n, currency: "USD", terms_digest: "sha256:e3b0…52b8", expires_in: 300 }),
    checks: ["Proposal created by the business, not the model", "Terms locked with a digest"],
    ok: true,
  }),
  "confirm-say": () => ({
    what: "The customer tells the assistant to go ahead.",
    why: "Saying \"confirm\" in chat is not approval. Approval happens on a separate device, outside the assistant.",
    request: 'Customer → assistant (chat message)\n"confirm"',
    checks: ["Chat confirmation only starts the approval. It authorizes nothing."],
  }),
  confirm: (c) => ({
    what: "The assistant asks the tool layer to confirm the same proposal.",
    why: "The tool layer re-checks the terms against the proposal before it asks the human.",
    request: http("POST", `https://mcp.${c.org}.example/mcp`, { Authorization: "Bearer <delegated token>" }, json({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: c.p.pay.tool, arguments: { proposal_id: "prop_7c20", step: "confirm" } } })),
    token: delegatedToken(c, true),
    checks: ["Terms digest matches the proposal", "Proposal not expired or used"],
  }),
  "ciba-req": (c) => ({
    what: "The tool layer asks PingOne to get the customer's fresh approval, out of band, with CIBA.",
    why: "Money never moves without the customer: a separate device, a separate channel, fresh approval for every payment.",
    request: http("POST", `${AS}/bc-authorize`, { "Content-Type": "application/x-www-form-urlencoded" }, form({ login_hint: SUB, scope: "openid", binding_message: `Approve $${c.n}`, client_id: "tool-layer" })),
    response: reply("200 OK", { "Content-Type": "application/json" }, json({ auth_req_id: "1c266114…", expires_in: 120, interval: 2 })),
    checks: ["Customer identified by login_hint", "Binding message shows the exact amount"],
  }),
  "ciba-push": (c) => ({
    what: `PingOne pushes "Approve ${c.p.pay.what(c.n)}?" to the customer's own phone.`,
    why: "The assistant can request. Only the human can approve. Deny it, ignore it or let it expire and nothing moves.",
    request: `Push to the customer's registered device\n"Approve ${c.p.pay.what(c.n)}?"`,
    checks: ["Delivered to the customer's enrolled device, not the assistant"],
  }),
  "ciba-approve": () => ({
    what: "The customer approves with a biometric on their phone.",
    why: "This is fresh human assurance that rides on the token the system of record will see.",
    response: reply("200 OK", { "Content-Type": "application/json" }, json({ access_token: "eyJhbGciOi…", token_type: "Bearer", expires_in: 300 })),
    checks: ["Biometric verified on the device", "Approval is single-use and tied to this request"],
    ok: true,
  }),
  "core-commit": (c) => ({
    what: `The tool layer performs Exchange 2 and sends the commit to the ${c.p.core.label} with a signed approval binding.`,
    why: "Before anything changes, the system of record verifies the binding against this proposal, this customer and these exact terms.",
    request: http("POST", `https://core.${c.org}.example/v1/${slug(c.p.pay.noun)}`, { Authorization: "Bearer <audience token>" }, json({ proposal_id: "prop_7c20", terms_digest: "sha256:e3b0…52b8", approval_binding: "eyJhbGciOi… (signed, single use)" })),
    token: audienceToken(c, true, true),
    checks: ["Audience and scope match", "Approval binding valid and unused", "Terms digest equals the proposal's", "Subject equals the customer"],
  }),
  committed: (c) => ({
    what: `${cap(c.p.core.label)} commits and the result goes back to the customer.`,
    why: "The system of record decided: the assistant requested, the business decided, the human authorised.",
    response: reply("200 OK", { "Content-Type": "application/json" }, json({ status: "committed", summary: c.p.pay.what(c.n) })),
    checks: ["Single-use approval consumed"],
    ok: true,
  }),
  revoke: () => ({
    what: "The customer revokes the assistant's permission.",
    why: "No waiting for token expiry. The record is what authority is derived from.",
    request: json({ delegation: "revoke", actor: CLIENT }),
    checks: ["Delegation record marked revoked"],
  }),
  "delegation-removed": () => ({
    what: "PingOne now has no live delegation for this customer and assistant.",
    why: "The existing connector session is still open, but the next exchange has nothing to derive authority from.",
    response: json({ delegation: { status: "revoked" } }),
    checks: ["Delegation: none"],
  }),
  "no-delegation": () => ({
    what: "Exchange 1 is refused: there is no live delegation.",
    why: "The session may outlive the consent. The authority may not.",
    response: reply("400 Bad Request", { "Content-Type": "application/json" }, json({ error: "access_denied", error_description: "No live delegation for this subject and actor" })),
    checks: ["Live delegation: none", "No delegated token minted"],
    refused: true,
  }),
  "refused-edge": () => ({
    what: "The edge returns the refusal and forwards nothing.",
    why: "No live permission means no delegated token, so there is nothing to forward.",
    response: reply("401 Unauthorized", { "WWW-Authenticate": 'Bearer error="invalid_token"' }, json({ error: "delegation_revoked" })),
    checks: ["Nothing forwarded to the gateway or the business"],
    refused: true,
  }),
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// pay is true for payment moments so shared steps (exchanges, forward) show the right scope.
export function detailFor(key, profile, amount, pay) {
  const build = DETAILS[key];
  if (!build) return null;
  const c = ctxFor(profile, amount);
  c.__pay = Boolean(pay);
  return build(c);
}

export const TOKEN_ORDER = ["Connect token", "Delegated token", "Audience token"];
