// Server Topology: per connection (edge id), the request on the wire, the MOCK tokens in play, and the standards
// behind the hop (published RFCs and specs, plus emerging work that could support it).
// Teaching values only: no real secrets. Draft status changes, so emerging names are for orientation; verify before quoting.
import { RFC, SERVER_EDGES, SPECS } from "../components/serverTopologyData";

export const KINDS = ["rfc", "spec", "emerging"];

const kindOf = (id) => (/RFC \d+/.test(id) ? "rfc" : "spec");
const fromData = (record) => ({ id: record.id, title: record.title, kind: kindOf(record.id), url: record.url });
const RFC_X = (id, title) => ({ id: `RFC ${id}`, title, kind: "rfc", url: `https://www.rfc-editor.org/rfc/rfc${id}` });
const SPEC_X = (id, title) => ({ id, title, kind: "spec" });
const DRAFT = (id, title) => ({ id, title, kind: "emerging" });

const OAUTH21 = DRAFT("OAuth 2.1 (draft-ietf-oauth-v2-1)", "Consolidates PKCE and current best practice into one OAuth spec");
const SIGN_IN = [SPEC_X("OpenID Connect Core 1.0", "Sign-in layer on top of OAuth 2.0"), RFC_X(9126, "Pushed Authorization Requests (PAR)"), OAUTH21];
const ISSUER = RFC_X(9207, "Authorization Server Issuer Identification (mix-up defence)");
const BEARER = [RFC_X(6750, "Bearer token usage"), RFC_X(9068, "JWT profile for OAuth access tokens"), RFC_X(9449, "DPoP: sender-constrained tokens")];
const EXCHANGE_NEXT = [
  DRAFT("draft-ietf-oauth-transaction-tokens", "Transaction Tokens: short-lived tokens carrying call context"),
  DRAFT("draft-ietf-oauth-identity-chaining", "Identity and authorization chaining across domains"),
  DRAFT("draft-ietf-oauth-identity-assertion-authz-grant", "ID-JAG: enterprise-managed cross-app access"),
];
const MCP_NEXT = [DRAFT("draft-ietf-oauth-client-id-metadata-document", "Client ID Metadata Documents (no pre-registration)")];
const WORKLOAD_NEXT = [DRAFT("draft-ietf-wimse-arch", "WIMSE: workload identity in multi-system environments")];
const A2A = [SPEC_X("A2A protocol", "Agent2Agent: agent cards and JSON-RPC messages")];

// Extra entries by edge id (the published ones named in the topology data come first, automatically).
const EXTRA = {
  "ingress-bff-login": SIGN_IN,
  "bff-browser-redirect": SIGN_IN,
  "browser-pingone-login": [...SIGN_IN, ISSUER],
  "pingone-browser-callback": [ISSUER, OAUTH21],
  "browser-ingress-callback": [ISSUER],
  "ingress-bff-callback": [ISSUER],
  "browser-pingfederate-login": [...SIGN_IN, ISSUER],
  "pingfederate-browser-callback": [ISSUER, OAUTH21],
  "bff-pingone": [BEARER[1], OAUTH21],
  "bff-pingone-token": [BEARER[1], SPEC_X("OpenID Connect Core 1.0", "ID token returned beside the access token"), OAUTH21],
  "bff-pingfederate-token": [BEARER[1], SPEC_X("OpenID Connect Core 1.0", "ID token returned beside the access token"), OAUTH21],
  "bff-pinggw": [...BEARER, ...MCP_NEXT],
  "bff-nodegw": [...BEARER, ...MCP_NEXT],
  "pinggw-authz": [RFC_X(9701, "JWT response for token introspection"), DRAFT("OpenID AuthZEN Authorization API", "Standard PEP-to-PDP decision API (status may have changed)")],
  "pinggw-mcpmcp": [BEARER[0], ...MCP_NEXT],
  "nodegw-mcpmcp": [BEARER[0], ...EXCHANGE_NEXT.slice(0, 1), ...WORKLOAD_NEXT],
  "nodegw-authz": [DRAFT("OpenID AuthZEN Authorization API", "Standard PEP-to-PDP decision API (status may have changed)"), RFC_X(7519, "JSON Web Token"), RFC_X(7517, "JSON Web Key (JWKS validation)")],
  "nodegw-pingone": [...EXCHANGE_NEXT],
  "mcpmcp-pingone-step9": [...EXCHANGE_NEXT],
  "mcpmcp-pingfederate-step9": [...EXCHANGE_NEXT],
  "mcpmcp-bff-api": [BEARER[0], BEARER[2]],
  "browser-mcpmcp-direct": [BEARER[0], ...MCP_NEXT],
  "mcpproxy-nodegw": [BEARER[0]],
  "spire-mcpmcp": WORKLOAD_NEXT,
  "spire-bff": WORKLOAD_NEXT,
  "spire-nodegw": WORKLOAD_NEXT,
  "bff-langchain": A2A,
  "a2amain-privgw": [...A2A, BEARER[0]],
  "privgw-a2aworker": A2A,
  "a2aworker-privgw": [BEARER[0]],
  "privgw-langchain": A2A,
  "langchain-privgw": [...A2A, BEARER[0]],
  "browser-privgw": [RFC_X(9728, "Protected Resource Metadata"), ...MCP_NEXT],
  "privgw-mcpmcp": [BEARER[0]],
  "nodegw-weather": [BEARER[0]],
  "nodegw-brave": [BEARER[0]],
};

/** Standards behind one connection: what the topology data names (RFCs, specs), then extras, then emerging. Deduped by id. */
export function refsFor(edgeId) {
  const edge = SERVER_EDGES.find((e) => e.id === edgeId);
  const named = edge ? [...(edge.data.rfcs || []).map((k) => RFC[k]), ...(edge.data.specs || []).map((k) => SPECS[k])].filter(Boolean).map(fromData) : [];
  const seen = new Set();
  return [...named, ...(EXTRA[edgeId] || [])].filter((r) => !seen.has(r.id) && seen.add(r.id)).sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

// ---- Request forms (HTTP / protocol calls) ----
const TOKEN_POST = (host, path, body) => `POST ${path} HTTP/1.1\nHost: ${host}\nContent-Type: application/x-www-form-urlencoded\n\n${body}`;
const EXCHANGE_BODY = (subject, resource) => `grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=${subject}\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&resource=${resource}`;
const AUTHORIZE_QS = "response_type=code&client_id=<app-id>\n  &redirect_uri=https://demo.example.com/api/auth/oauth/user/callback\n  &scope=openid profile&state=<random>\n  &code_challenge=<S256 hash>&code_challenge_method=S256";
const CALLBACK = "GET /api/auth/oauth/user/callback?code=<one-time code>&state=<random> HTTP/1.1\nHost: demo.example.com";
const MCP_CALL = (bearer) => `POST /mcp HTTP/1.1\nAuthorization: Bearer ${bearer}\nContent-Type: application/json\n\n{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "get_balance", "arguments": {} } }`;
const A2A_SEND = (key) => `POST / HTTP/1.1\nAuthorization: Bearer ${key}\nContent-Type: application/json\n\n{ "jsonrpc": "2.0", "id": 1, "method": "message/send",\n  "params": { "message": { "role": "user", "messageId": "m-1", "parts": [{ "kind": "text", "text": "Review access for team A" }] } } }`;
const SCRAPE = "GET /metrics HTTP/1.1\nAccept: text/plain\n(path and port per the connection label)";

const FORMS = {
  "browser-ingress": "GET /api/auth/oauth/user/login HTTP/1.1  (start sign-in)\nHost: demo.example.com\n\n or, once signed in:  POST /api/<route> HTTP/1.1\nCookie: sid=<session id>",
  "ingress-frontend": "GET /<page or asset> HTTP/1.1\nHost: demo.example.com\nX-Forwarded-Proto: https",
  "frontend-bff": "POST /api/<route> HTTP/1.1\nCookie: sid=<session id>\nContent-Type: application/json\n\n{ \"message\": \"What is my balance?\" }",
  "ingress-bff-login": "GET /api/auth/oauth/user/login HTTP/1.1\nHost: demo.example.com",
  "bff-browser-redirect": `HTTP/1.1 302 Found\nLocation: https://auth.pingone.com/<env-id>/as/authorize?${AUTHORIZE_QS}`,
  "browser-pingone-login": `GET /<env-id>/as/authorize?${AUTHORIZE_QS} HTTP/1.1\nHost: auth.pingone.com`,
  "pingone-browser-callback": "HTTP/1.1 302 Found\nLocation: https://demo.example.com/api/auth/oauth/user/callback?code=<one-time code>&state=<random>",
  "browser-ingress-callback": CALLBACK,
  "ingress-bff-callback": CALLBACK,
  "bff-pingone": TOKEN_POST("auth.pingone.com", "/<env-id>/as/token", "grant_type=client_credentials&scope=<gateway scope>\n(client authentication per app configuration; the user token came from the code exchange)"),
  "bff-pingone-token": TOKEN_POST("auth.pingone.com", "/<env-id>/as/token", "grant_type=authorization_code&code=<one-time code>\n&redirect_uri=https://demo.example.com/api/auth/oauth/user/callback\n&code_verifier=<PKCE secret>&client_id=<app-id>"),
  "bff-browser-session": "HTTP/1.1 302 Found\nSet-Cookie: sid=<session id>; HttpOnly; Secure; SameSite=Lax; Path=/\nLocation: /",
  "browser-pingfederate-login": `GET /as/authorization.oauth2?${AUTHORIZE_QS} HTTP/1.1\nHost: pf.example.com:9031`,
  "pingfederate-browser-callback": "HTTP/1.1 302 Found\nLocation: https://demo.example.com/api/auth/oauth/user/callback?code=<one-time code>&state=<random>",
  "bff-pingfederate-token": TOKEN_POST("pf.example.com:9031", "/as/token.oauth2", "grant_type=authorization_code&code=<one-time code>\n&redirect_uri=https://demo.example.com/api/auth/oauth/user/callback\n&code_verifier=<PKCE secret>&client_id=<app-id>"),
  "bff-pinggw": MCP_CALL("<user access token>"),
  "bff-nodegw": MCP_CALL("<user access token>"),
  "pinggw-authz": "POST <introspection endpoint> HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\ntoken=<access token>&token_type_hint=access_token",
  "pinggw-mcpmcp": MCP_CALL("<user access token>"),
  "nodegw-mcpmcp": MCP_CALL("<MCP-audience token>"),
  "browser-mcpmcp-direct": MCP_CALL("<access token>"),
  "nodegw-authz": "POST <PingOne Authorize decision endpoint> HTTP/1.1\nAuthorization: Bearer <worker token>\nContent-Type: application/json\n\n{ \"subject\": \"user1\", \"action\": \"tools/call\", \"resource\": \"get_balance\" }   (illustrative body)",
  "nodegw-pingone": TOKEN_POST("auth.pingone.com", "/<env-id>/as/token", EXCHANGE_BODY("<user access token>", "https://mcp.demo.example.com")),
  "mcpmcp-pingone-step9": TOKEN_POST("auth.pingone.com", "/<env-id>/as/token", EXCHANGE_BODY("<MCP-audience token>", "<BANKING_API_RESOURCE_URI>")),
  "mcpmcp-pingfederate-step9": TOKEN_POST("pf.example.com:9031", "/as/token.oauth2", EXCHANGE_BODY("<PF-issued bearer>", "<BANKING_API_RESOURCE_URI>")),
  "nodegw-apiresource-apikey": "GET /<resource> HTTP/1.1\nX-API-Key: <server-side API key>\n(no Authorization header: the OAuth bearer is dropped here)",
  "mcpmcp-bff-api": "GET /api/<route> HTTP/1.1\nAuthorization: Bearer <delegated user token>",
  "mcpmcp-mcpresource": "GET /<resource> HTTP/1.1\nAuthorization: Bearer <delegated token>",
  "bff-langchain": "POST /<agent run route> HTTP/1.1\nAccept: text/event-stream\nContent-Type: application/json\n\n{ \"message\": \"What is my balance?\" }",
  "nodegw-mcpaudit": "POST /<ingest route> HTTP/1.1\nContent-Type: application/json\n\n{ \"event\": \"tools/call\", \"subject\": \"user1\", \"tool\": \"get_balance\", \"decision\": \"permit\" }   (illustrative body)",
  "nodegw-weather": MCP_CALL("<MCP-audience token>").replace("get_balance", "get_weather"),
  "nodegw-brave": MCP_CALL("<MCP-audience token>").replace("get_balance", "news_search"),
  "mcpproxy-nodegw": "POST /mcp HTTP/1.1\nAuthorization: Bearer <forwarded token>\n(plain REST request converted to a JSON-RPC tools/call)",
  "prometheus-alertmanager": "POST /api/v2/alerts HTTP/1.1\nContent-Type: application/json\n\n[{ \"labels\": { \"alertname\": \"HighLatency\", \"service\": \"mcp-server\" } }]",
  "grafana-prometheus": "GET /api/v1/query?query=up HTTP/1.1",
  "alloy-loki": "POST /loki/api/v1/push HTTP/1.1\nContent-Type: application/json\n\n{ \"streams\": [{ \"stream\": { \"service\": \"bff\" }, \"values\": [[\"<unix ns>\", \"log line\"]] }] }",
  "a2amain-privgw": A2A_SEND("<main agent key>"),
  "privgw-a2aworker": A2A_SEND("<gateway credential for the worker>"),
  "a2aworker-privgw": MCP_CALL("<worker agent key>").replace("get_balance", "list_access"),
  "privgw-langchain": A2A_SEND("<app static token>"),
  "langchain-privgw": A2A_SEND("<middle agent key>"),
  "privgw-model": "POST <model route> HTTP/1.1\nAuthorization: Bearer <real provider key, held by the gateway>\nContent-Type: application/json\n\n{ \"model\": \"<allowed model>\", \"messages\": [{ \"role\": \"user\", \"content\": \"...\" }] }   (illustrative)",
  "privgw-mcpmcp": MCP_CALL("<gateway-authenticated call>"),
  "browser-privgw": MCP_CALL("<access token>"),
};
for (const id of ["pinggw", "nodegw", "mcpmcp", "mcpresource", "apiresource", "mcpproxy", "langchain", "llmproxy"]) FORMS[`prometheus-${id}`] = SCRAPE;

/** The request on the wire for this connection (teaching values), or null when it is not a single HTTP/protocol call. */
export const formFor = (edgeId) => FORMS[edgeId] || null;

// ---- Mock tokens (decoded claims, teaching values only) ----
const ISS = "https://auth.pingone.com/<env-id>/as";
const HEADER = { alg: "RS256", kid: "signing-key-1", typ: "at+jwt" };
const USER_TOKEN = {
  label: "User access token", header: HEADER,
  claims: { iss: ISS, sub: "user1", aud: ["https://agentgateway.demo.example.com"], scope: "openid profile mcp:invoke", client_id: "<app-id>", exp: 1788030829 },
};
const ID_TOKEN = {
  label: "ID token", header: { alg: "RS256", kid: "signing-key-1", typ: "JWT" },
  claims: { iss: ISS, sub: "user1", aud: "<app-id>", nonce: "<random>", acr: "Single_Factor", exp: 1788030829 },
};
const GATEWAY_TOKEN = {
  label: "Gateway client token (client_credentials)", header: HEADER,
  claims: { iss: ISS, sub: "<gateway client id>", aud: ["<PingOne Authorize audience>"], scope: "authorize:decide", exp: 1788030829 },
};
const MCP_TOKEN = {
  label: "MCP-audience token (result of the exchange)", header: HEADER,
  claims: { iss: ISS, sub: "user1", aud: ["https://mcp.demo.example.com"], scope: "mcp:balance:read", exp: 1788030829, note: "audience set and scope narrowed by the exchange" },
};
const API_TOKEN = {
  label: "Banking API token (result of Step 9)", header: HEADER,
  claims: { iss: ISS, sub: "user1", aud: ["<BANKING_API_RESOURCE_URI>"], scope: "banking:read", exp: 1788030829 },
};
const CODE = {
  label: "Authorization code (opaque, one time)",
  claims: { code: "<one-time code>", state: "<random>", bound_to: { client_id: "<app-id>", code_challenge: "<S256 hash>" }, lifetime: "seconds" },
};
const SESSION = {
  label: "Session cookie (opaque, not a JWT)",
  claims: { sid: "<session id>", flags: "HttpOnly; Secure; SameSite=Lax", tokens: "held server-side by the BFF, never in the browser" },
};
const INTROSPECTION = {
  label: "Introspection response (RFC 7662)",
  claims: { active: true, sub: "user1", aud: "https://agentgateway.demo.example.com", scope: "openid profile mcp:invoke", exp: 1788030829 },
};
const API_KEY = {
  label: "API key (not a JWT, server-side only)",
  claims: { type: "api_key", key_id: "<key id>", held_by: "Demo Agent Gateway", returned_to_client: false },
};
const AGENT_KEY = (who) => ({
  label: `Agent key: ${who} (opaque credential)`,
  claims: { type: "agent_key", key_id: `${who}-key-1`, scopes: ["llm", "mcp"], note: "checked by the gateway; never reaches the next agent" },
});

const TOKENS = {
  "pingone-browser-callback": [CODE], "pingfederate-browser-callback": [CODE], "browser-ingress-callback": [CODE], "ingress-bff-callback": [CODE],
  "bff-pingone-token": [USER_TOKEN, ID_TOKEN], "bff-pingfederate-token": [USER_TOKEN, ID_TOKEN],
  "bff-browser-session": [SESSION],
  "bff-pingone": [USER_TOKEN, GATEWAY_TOKEN],
  "bff-pinggw": [USER_TOKEN], "bff-nodegw": [USER_TOKEN],
  "pinggw-authz": [USER_TOKEN, INTROSPECTION], "pinggw-mcpmcp": [USER_TOKEN],
  "nodegw-authz": [USER_TOKEN],
  "nodegw-pingone": [USER_TOKEN, MCP_TOKEN],
  "nodegw-mcpmcp": [MCP_TOKEN],
  "mcpmcp-pingone-step9": [MCP_TOKEN, API_TOKEN], "mcpmcp-pingfederate-step9": [{ ...MCP_TOKEN, label: "PF-issued bearer (subject token)" }, API_TOKEN],
  "browser-mcpmcp-direct": [USER_TOKEN],
  "mcpmcp-bff-api": [API_TOKEN],
  "nodegw-apiresource-apikey": [API_KEY],
  "nodegw-weather": [MCP_TOKEN], "nodegw-brave": [MCP_TOKEN],
  "a2amain-privgw": [AGENT_KEY("main")], "a2aworker-privgw": [AGENT_KEY("worker")], "langchain-privgw": [AGENT_KEY("middle")],
  "privgw-langchain": [{ label: "App static token (opaque)", claims: { type: "static_token", note: "sent by the gateway; the caller's key is not forwarded" } }],
  "privgw-model": [{ label: "Real provider key (opaque, gateway only)", claims: { type: "provider_api_key", held_by: "gateway", held_by_agents: false } }],
};

/** MOCK tokens in play on this connection, in the order they appear (two when the step takes one in and issues another). */
export const tokensFor = (edgeId) => TOKENS[edgeId] || [];

/** Why no token is shown for a connection that has none. */
export function noTokenNote(edge) {
  if (!edge) return "";
  if (edge.data.kind === "telemetry") return "No user token: this is service telemetry between operators' tools.";
  if (edge.id === "browser-ingress" || edge.id === "ingress-bff-login" || edge.id === "bff-browser-redirect" || /-login$/.test(edge.id)) return "No token yet: the user is still signing in.";
  return "No OAuth token is shown for this hop: it is a plain service call inside the network.";
}
