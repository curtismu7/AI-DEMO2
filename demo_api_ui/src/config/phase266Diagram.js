// demo_api_ui/src/config/phase266Diagram.js
//
// Graph for /architecture/phase-266 (Phase266ArchitecturePage): the three credential paths through the gateway.
// Converted from the original Mermaid source; drawn by StaticFlowDiagram with pingStyle.
// Path A (api_key) and Path B/C (dual_token / oauth_bearer): `path` on a box or arrow lets the PathFilterBar dim the rest.
const TOKEN = { dashed: true }; // pingStyle: dashed blue = a token or a decision handed back

// Ping palette: red = PingOne, dark = what the team builds (BFF, gateway), grey = the resource server side.
export const P266_GROUPS = {
  bff: { label: "banking_api_server :3001 (BFF + traffic terminus)", bg: "#151a24" },
  rs: { label: "banking_resource_server (authenticateToken)", bg: "#5a5f69" },
  ping: { label: "PingOne", bg: "#b5231a" },
};

export const P266_NODES = [
  { id: "User", group: "bff", label: "User / browser", x: 1200, y: 0 },
  {
    id: "SPA", group: "bff", label: "SPA — banking_api_ui :4000",
    sub: ["3 result pages:", "ResourceServerPage (blue)", "ApiKeyPathPage (amber)", "AccessIdTokenPathPage (teal)"],
    x: 900, y: 0,
  },
  {
    id: "Session", group: "bff", label: "Express session",
    sub: ["oauthTokens.accessToken", "oauthTokens.idToken"],
    x: 600, y: 0,
  },
  { id: "InternalIdToken", group: "bff", label: "/internal/id-token", sub: ["secret-gated", "server-to-server"], path: "B", x: 300, y: 0 },
  { id: "PathInfo", group: "bff", label: "/api/path/apikey-info", sub: ["masked apiKey last4", "(Path A info marker)"], path: "A", x: 1500, y: 0 },

  { id: "Summary", group: "rs", label: "GET /summary", sub: ["existing — untouched"], x: 1200, y: 180 },
  { id: "Identity", group: "rs", label: "POST or GET /identity", sub: ["decodes access+id tokens", "act-chain audit log", "scrubRawJwts walker"], path: "B", x: 900, y: 360 },
  { id: "Accounts", group: "rs", label: "GET /accounts", sub: ["reads LMDB"], path: "C", x: 300, y: 180 },
  { id: "Transactions", group: "rs", label: "GET /transactions", sub: ["reads LMDB"], path: "C", x: 1200, y: 360 },

  { id: "BankingDb", group: "bff", label: "LMDB store", sub: ["data/persistent/lmdb/", "banking_accounts +", "banking_transactions"], path: "C", x: 300, y: 540 },

  {
    id: "Gateway", group: "bff", label: "banking_mcp_gateway :3005 — TRAFFIC COP",
    sub: ["routeTool(name) → credentialPath", "selectCredentialForBackend()", "synthesizes _meta.tokenEvents"],
    x: 600, y: 180,
  },
  { id: "PingOne", group: "ping", label: "PingOne AS", sub: ["RFC 8693 /token", "RFC 7662 /introspect", "RFC 7517 /jwks"], x: 300, y: 360 },
  {
    id: "ApiResourceServer", group: "bff", label: "banking_api_resource_server :8082",
    sub: ["X-API-Key gate", "GET /mortgage", "(no OAuth involved)"],
    path: "A", x: 600, y: 360,
  },
];

export const P266_EDGES = [
  ["User", "SPA", "1. OIDC login (OIDC Core)"], // 0
  ["SPA", "Session", "session cookie"], // 1
  ["SPA", "Gateway", "2. 'show my profile card' via bffAxios → BankingAgent"], // 2
  ["Gateway", "PingOne", "3. RFC 8693 token exchange — subject=user bearer, actor=gateway-client, aud=banking_resource_server"], // 3
  ["PingOne", "Gateway", "exchanged token — aud=banking_resource_server, act.client_id=gateway-client", TOKEN], // 4
  ["Gateway", "InternalIdToken", "fetches id_token (secret-gated)"], // 5
  ["InternalIdToken", "Session", null], // 6
  ["Gateway", "ApiResourceServer", "Path A: api_key — GET /mortgage, X-API-Key + X-User-Sub (no OAuth bearer)", { path: "A", vertical: true }], // 7
  ["ApiResourceServer", "Gateway", "mortgage record (JSON)", { path: "A", lane: -60 }], // 8
  ["Gateway", "SPA", "Path A response — credentialPath: api_key + masked last4", { path: "A" }], // 9
  ["SPA", "PathInfo", "navigate(/path/mortgage, state: mortgagePayload)", { path: "A" }], // 10
  ["Gateway", "Identity", "Path B: dual_token — POST /identity, Bearer EXCHANGED + idToken body", { path: "B" }], // 11
  ["Gateway", "Accounts", "Path C: oauth_bearer — GET /accounts, Bearer EXCHANGED", { path: "C" }], // 12
  ["Gateway", "Transactions", "GET /transactions, Bearer EXCHANGED", { path: "C" }], // 13
  ["Accounts", "BankingDb", "getAccountsByUserId (parameterized SQL)", { vertical: true }], // 14
  ["Transactions", "BankingDb", "getTransactionsByUserId (parameterized SQL)"], // 15
  ["Identity", "PingOne", "authenticateToken — RFC 7515 sig (JWKS), RFC 8707 aud, optional RFC 7662", TOKEN], // 16
  ["Accounts", "PingOne", "same validation", { dashed: true, vertical: true }], // 17
  ["Transactions", "PingOne", "same validation", TOKEN], // 18
  ["Identity", "Gateway", "claims only (sanitizeClaims + scrubRawJwts), NO raw JWT"], // 19
  ["Accounts", "Gateway", "LMDB rows"], // 20
  ["Transactions", "Gateway", "LMDB rows"], // 21
  ["Gateway", "SPA", "_meta.credentialPath + _meta.tokenEvents"], // 22
  ["SPA", "Summary", "existing (unchanged)"], // 23
];
