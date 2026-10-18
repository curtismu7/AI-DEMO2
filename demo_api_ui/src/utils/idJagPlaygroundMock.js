// Client-side fixtures for the ID-JAG playground's "Mock" mode. Same response shapes as
// demo_api_server/routes/idJagPlayground.js, so the page renders them unchanged. Nothing is sent.

const SPEC = "draft-ietf-oauth-identity-assertion-authz-grant";
const ID_JAG_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id-jag";
const JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ISSUER = "https://pingfederate.example.com";
const AS_ISSUER = "https://mcp-as.example.com";
const RESOURCE = "https://mcp.example.com/mcp";
const CLIENT_ID = "agent-mcp-client";
const SCOPE = "openid mcp:read mcp:write";

export const MOCK_CONFIG = {
  mode: "mock",
  provider: "pingfederate",
  enabled: true,
  signedIn: true,
  idp: { name: "PingFederate (sample)", issuer: ISSUER, tokenEndpoint: `${ISSUER}/as/token.oauth2`, jwksUrl: `${ISSUER}/pf/JWKS`, exchangeClientId: "agent-exchange-client" },
  resourceAs: { name: "MCP authorization server (sample)", issuer: AS_ISSUER, tokenEndpoint: `${AS_ISSUER}/token`, clientId: CLIENT_ID },
  request: { audience: AS_ISSUER, resource: RESOURCE, scope: SCOPE },
  publicEndpoints: {
    "oauth-mcp": { issuer: AS_ISSUER, tokenEndpoint: `${AS_ISSUER}/token` },
    pingfederate: { issuer: "https://pingfederate.local.example.com", tokenEndpoint: "https://pingfederate.local.example.com/as/token.oauth2" },
  },
};

// Trusted-IdP registry: one sample entry, edited in memory for this page load.
const SAMPLE_IDP = { id: "partner-okta", name: "Partner Okta (sample)", issuer: "https://partner.okta.example.com", jwksUrl: "https://partner.okta.example.com/oauth2/v1/keys", idJagClientId: "partner-agent", clientId: "demo-bff-mcp-client", pfClientId: "ai-demo-pf-idjag-redeemer", scopes: "mcp:read", targets: ["oauth-mcp", "pingfederate"], enabled: true };
let trustedIdps = [SAMPLE_IDP];

function trusted(method, path, body) {
  const id = decodeURIComponent(path.split("/")[2] || "");
  if (method === "get") return { idps: trustedIdps, canManage: true };
  if (method === "post") { trustedIdps = [...trustedIdps, { ...body }]; return body; }
  if (method === "put") { trustedIdps = trustedIdps.map((e) => (e.id === id ? { ...body, id } : e)); return body; }
  trustedIdps = trustedIdps.filter((e) => e.id !== id);
  return null;
}

const NEGATIVE_TESTS = [
  { id: "replay", label: "Replay a redeemed ID-JAG", expect: "invalid_grant", why: "The resource AS enforces single-use jti (a hardening beyond the draft, which lets clients resubmit).", error: "invalid_grant", error_description: "Assertion jti has already been used" },
  { id: "bad-signature", label: "Tampered signature", expect: "invalid_grant", why: "RFC 7523 §3: the AS MUST verify the signature.", error: "invalid_grant", error_description: "Assertion signature is invalid" },
  { id: "client-mismatch", label: "Redeemed by a different client", expect: "invalid_grant or invalid_client", why: `${SPEC} §4.4.1: client_id MUST identify the authenticating client.`, error: "invalid_client", error_description: "client_id does not match the assertion" },
  { id: "scope-not-granted", label: "Ask for a scope the IdP did not grant", expect: "invalid_scope", why: `${SPEC} §4.4.1: the AS grants at most what the ID-JAG grants.`, error: "invalid_scope", error_description: "Requested scope exceeds the ID-JAG grant" },
];

const TOOLS = [
  { name: "search_records", description: "Search records the signed-in user can see.", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string", description: "Free-text search" }, limit: { type: "integer", description: "Max results" } } } },
  { name: "get_record", description: "Fetch one record by id.", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, include_history: { type: "boolean" } } } },
  { name: "create_note", description: "Attach a note to a record.", inputSchema: { type: "object", required: ["record_id", "text"], properties: { record_id: { type: "string" }, text: { type: "string" }, visibility: { type: "string", enum: ["private", "team"] } } } },
];

const scopeList = (s) => String(s || "").split(/\s+/).filter(Boolean);
const now = () => Math.floor(Date.now() / 1000);

function idJag() {
  const iat = now();
  return {
    header: { typ: "oauth-id-jag+jwt", alg: "RS256", kid: "pf-signing-2026" },
    claims: { iss: ISSUER, sub: "user.0042", aud: AS_ISSUER, client_id: CLIENT_ID, jti: "b3f1c6e2-7a4d-4c1e-9f2a-5d8e0c3a1b77", iat, exp: iat + 300, resource: RESOURCE, scope: SCOPE },
  };
}

function inspect() {
  const { header: h, claims: c } = idJag();
  const checks = [];
  const add = (id, label, expected, actual, cite) => checks.push({ id, label, status: "pass", expected, actual, cite });
  add("typ", "Header typ", "oauth-id-jag+jwt", h.typ, `${SPEC} §3.1 (MUST)`);
  add("alg", "Signed, not alg:none", "RS256 (or another asymmetric alg)", h.alg, "RFC 8725 §3.1");
  for (const k of ["iss", "sub", "aud", "client_id", "jti", "exp", "iat"]) add(`claim-${k}`, `Required claim ${k}`, "present", c[k], `${SPEC} §3.1 (REQUIRED)`);
  add("iss", "Issuer is PingFederate", ISSUER, c.iss, "RFC 7523 §3");
  add("aud", "Audience is the resource AS issuer (single value)", AS_ISSUER, c.aud, `${SPEC} §4.4.1 (MUST)`);
  add("client_id", "client_id is the client at the resource AS", CLIENT_ID, c.client_id, `${SPEC} §4.4.1: client_id MUST identify the client authenticating at the resource AS (the IdP maps it)`);
  add("resource", "Resource is the requested MCP resource", RESOURCE, c.resource, "RFC 8707 / MCP profile");
  add("exp", "Not expired", `> ${c.iat}`, c.exp, "RFC 7519 §4.1.4");
  add("lifetime", "Short-lived (5 minutes or less)", "<= 300 s", `${c.exp - c.iat} s`, "Okta / Auth0 / WorkOS issue 300 s ID-JAGs");
  add("scope", "Scope names MCP permissions, not just login scopes", "the MCP scopes the IdP grants for this server", c.scope, `${SPEC} §4.3: the IdP reflects the granted scope; OIDC-only scope grants nothing at the MCP server`);
  add("signature", "Signature verifies against PingFederate JWKS", `valid against ${ISSUER}/pf/JWKS`, "valid", "RFC 7523 §3 item 9");
  return { header: h, claims: c, checks };
}

function redeem(scope) {
  const granted = scopeList(SCOPE);
  const asked = scope ? scopeList(scope) : granted;
  const scopes = asked.filter((x) => granted.includes(x));
  const request = { endpoint: `POST ${AS_ISSUER}/token`, body: { grant_type: JWT_BEARER, assertion: "[the ID-JAG]", client_id: CLIENT_ID, resource: RESOURCE, scope: scope || undefined } };
  if (!scopes.length) {
    return { request, status: 400, response: { error: "invalid_scope", error_description: "None of the requested scopes are in the ID-JAG" }, token: null };
  }
  const iat = now();
  return {
    request, status: 200,
    response: { access_token: "[access token, kept server-side]", token_type: "Bearer", expires_in: 3600, scope: scopes.join(" ") },
    token: { header: { typ: "at+jwt", alg: "RS256", kid: "as-signing-1" }, claims: { iss: AS_ISSUER, sub: "user.0042", aud: RESOURCE, client_id: CLIENT_ID, scope: scopes.join(" "), iat, exp: iat + 3600, jti: "8c2d4e1f-0b3a-4f6e-a1d2-9e7c5b3a2f10" } },
  };
}

function call(body) {
  const gw = { endpoint: "POST https://mcp-gateway.example.com/mcp", authorization: "Bearer [access token]" };
  if (!body?.tool) return { request: { ...gw, body: { jsonrpc: "2.0", method: "tools/list" } }, tools: TOOLS, deniedTools: ["delete_record"] };
  const args = body.arguments || {};
  return {
    request: { ...gw, body: { jsonrpc: "2.0", method: "tools/call", params: { name: body.tool, arguments: args } } },
    result: { content: [{ type: "text", text: `Sample result from ${body.tool}` }], structuredContent: { ok: true, tool: body.tool, echo: args }, isError: false },
  };
}

/** The resource server's protected page: accepted with the access token, refused without one or with the ID-JAG. */
function resource(variant) {
  const url = `${AS_ISSUER}/protected/profile`;
  const authorization = { token: "Bearer [access token]", "no-token": "none", "id-jag": "Bearer [the ID-JAG]" }[variant];
  const request = { method: "GET", url, authorization };
  const pass = (check, detail) => ({ check, ok: true, detail });
  if (variant === "no-token") {
    return { request, status: 401, wwwAuthenticate: 'Bearer realm="Protected profile"',
      body: { resource: url, error: "unauthorized", error_description: "A bearer access token is required.", verified: [{ check: "bearer", ok: false, detail: "No Authorization: Bearer header." }] } };
  }
  if (variant === "id-jag") {
    const detail = "This is an ID-JAG (typ oauth-id-jag+jwt): a grant for the authorization server to redeem, never an access token for a resource.";
    return { request, status: 401, wwwAuthenticate: 'Bearer realm="Protected profile", error="invalid_token"',
      body: { resource: url, error: "invalid_token", error_description: detail, verified: [pass("bearer", "Authorization: Bearer present."), { check: "token type", ok: false, detail }] } };
  }
  return { request, status: 200, wwwAuthenticate: null, body: {
    resource: url,
    verified: [pass("bearer", "Authorization: Bearer present."), pass("token type", "JWT (typ at+jwt), not an ID-JAG."), pass("expiry", "3599 s left."),
      pass("signature", "Verified against the issuer's published keys."), pass("audience", `aud "${RESOURCE}" is this resource server.`),
      pass("issuer", `iss ${AS_ISSUER} is trusted.`), pass("scope", "Has mcp:read.")],
    principal: { sub: "user.0042", client_id: CLIENT_ID, scope: "mcp:read mcp:write" },
    data: { profileId: "prf-5d8e0c3a", subject: "user.0042", status: "active", plan: "Standard", servedBy: "MCP resource server (sample)", servedAt: new Date().toISOString() },
  } };
}

function route(method, url, body) {
  const path = url.replace(/^.*\/api\/id-jag-playground/, "");
  if (method === "get" && path === "/config") return MOCK_CONFIG;
  if (path === "/trusted-idps" || path.startsWith("/trusted-idps/")) return trusted(method, path, body);
  if (method === "get" && path === "/negative") return NEGATIVE_TESTS.map(({ error, error_description, ...t }) => t);
  if (path === "/issue") {
    const s = MOCK_CONFIG.request;
    return {
      request: { endpoint: `POST ${MOCK_CONFIG.idp.tokenEndpoint}`, body: { grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", requested_token_type: ID_JAG_TOKEN_TYPE, subject_token: "[your session token, never sent to the browser]", subject_token_type: "urn:ietf:params:oauth:token-type:refresh_token", audience: s.audience, resource: s.resource, scope: s.scope, client_id: MOCK_CONFIG.idp.exchangeClientId } },
      response: { issued_token_type: ID_JAG_TOKEN_TYPE, token_type: "N_A", access_token: "[the ID-JAG, kept server-side]" },
      token: idJag(),
    };
  }
  if (path === "/inspect") return inspect();
  if (path === "/redeem") return redeem(body?.scope);
  if (path === "/call") return call(body);
  if (path === "/resource") return resource(body?.variant);
  const neg = NEGATIVE_TESTS.find((t) => path === `/negative/${t.id}`);
  if (neg) return { ...neg, pass: true, status: 400 };
  throw new Error(`Mock has no ${method.toUpperCase()} ${path}`);
}

/** Axios-shaped stand-in: resolves { data } after a short simulated delay. */
const reply = (method) => (url, body) => new Promise((ok, fail) => setTimeout(() => {
  try { ok({ data: route(method, url, body) }); } catch (e) { fail(e); }
}, 300));
export const mockApi = { get: reply("get"), post: reply("post"), put: reply("put"), delete: reply("delete") };
