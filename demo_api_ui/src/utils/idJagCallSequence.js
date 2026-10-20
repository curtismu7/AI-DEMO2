// The ID-JAG demo, one entry per call, in order. Single source for the movie reel,
// the sequence diagram and the call-by-call list, so the three can never disagree.
//
// `traced: false` marks a hop read from the architecture rather than followed
// through the code; the UI says so instead of presenting it as confirmed.
// `evidence` names the token-chain event that records this call in a live run.

export const ACTORS = [
  { id: "browser", label: "Browser", node: "browser" },
  { id: "bff", label: "BFF", node: "bff" },
  { id: "agent", label: "Agent service", node: "bff" },
  { id: "pf", label: "PingFederate", node: "pf" },
  { id: "oauthmcp", label: "oauth-mcp (MCP AS)", node: "mcpas" },
  { id: "gateway", label: "MCP gateway", node: "gw" },
  { id: "mcp", label: "MCP server", node: "rs" },
  { id: "bank", label: "Banking API", node: "bank" },
];

export const PHASES = ["Sign in", "Ask", "PingFederate side", "oauth-mcp side", "Tool call", "Data"];

export const CALLS = [
  { n: 1, phase: "Sign in", from: "browser", to: "bff", label: "Start the live run", where: "POST run intent, then logout",
    does: "Asks the BFF to remember the run intent (live-id-jag) and sign out any current session, so the next login is PingFederate and not a leftover PingOne one.",
    source: "UC40-PF-IDJAG-SESSION-HANDOFF.md section 3" },
  { n: 2, phase: "Sign in", from: "browser", to: "pf", label: "Sign in", where: "GET /as/authorization.oauth2 (prompt=login)",
    does: "PingFederate shows its login form and the user signs in as demouser.",
    source: "UC40 handoff section 3" },
  { n: 3, phase: "Sign in", from: "pf", to: "bff", label: "Authorization code", where: "302 to the BFF callback",
    does: "PingFederate redirects back to the BFF with a short-lived authorization code.",
    source: "UC40 handoff section 3" },
  { n: 4, phase: "Sign in", from: "bff", to: "pf", label: "Swap code for tokens", where: "POST /as/token.oauth2 (authorization_code, PKCE)",
    does: "The BFF exchanges the code for ID, access and refresh tokens as client ai-demo-pf-user, and keeps them in its server-side session. The browser only gets a cookie.",
    source: "demo_api_server (PF login chain)" },
  { n: 5, phase: "Ask", from: "browser", to: "bff", label: "Run: show my balance", where: "POST /api/agent/run",
    does: "Starts the run with useCaseId=enterprise-managed-mcp-authorization. No token travels from the browser.",
    source: "agentMcpTokenService.js" },
  { n: 6, phase: "Ask", from: "bff", to: "agent", label: "Propose a tool", where: "POST /api/agent/reason (agent service :3006)",
    does: "The reasoning-only agent service proposes the tool get_my_accounts. It holds no tokens and calls nothing itself.",
    source: "PingFederateIdJagPage protocol details" },
  { n: 7, phase: "Ask", from: "bff", to: "bff", label: "Gate the run", where: "assertPfIdJagRunAllowed + group policy",
    does: "Requires a PingFederate session with a live run intent and the ID-JAG feature on, then checks the user is allowed to reach this MCP server. A failure is an error, never a fallback.",
    source: "agentMcpTokenService.js, enterpriseMcpPolicyService.js" },
  { n: 8, phase: "PingFederate side", from: "bff", to: "pf", label: "Ask for an ID-JAG", where: "POST /as/token.oauth2 (RFC 8693, requested_token_type=id-jag)",
    does: "Sends the BFF-held refresh token as the subject with the target audience, resource and scope. PingFederate checks it under policy aiDemoPfIdJagPolicy, builds the assertion from connection aiDemoPfIdJagSp, signs it, and returns a short-lived JWT of type oauth-id-jag+jwt.",
    source: "oauthService.js performIdJagExchange", evidence: "pf-id-jag-issued" },
  { n: 9, phase: "PingFederate side", from: "bff", to: "bff", label: "Check the ID-JAG", where: "type, sub, iss, aud, exp",
    does: "The BFF refuses an assertion with the wrong type, issuer, audience or expiry before using it.",
    source: "oauthService.js performIdJagExchange" },
  { n: 10, phase: "oauth-mcp side", from: "bff", to: "oauthmcp", label: "Redeem the ID-JAG", where: "POST /token (jwt-bearer, assertion=ID-JAG)",
    does: "Presents the ID-JAG to the MCP authorization server as a JWT bearer assertion, as client demo-bff-mcp-client, with resource and scope.",
    source: "oauthService.js redeemIdJag" },
  { n: 11, phase: "oauth-mcp side", from: "oauthmcp", to: "pf", label: "Fetch PingFederate keys", where: "GET /pf/JWKS",
    does: "Reads PingFederate's public keys (matching the key by x5t) to verify the signature. Nothing else is sent to PingFederate.",
    source: "OAuthRouter.ts idJagVerifyOpts" },
  { n: 12, phase: "oauth-mcp side", from: "oauthmcp", to: "oauthmcp", label: "Verify, then mint", where: "verifyIdJag, issueAuthorizationCode",
    does: "Checks RS256 signature, issuer, audience, type, expiry, accepted resource, that client_id matches the redeeming client, and that the single-use ID is new. Then it mints its own access token and returns it. The ID-JAG is spent.",
    source: "IdJagGrantHandler.ts, OAuthRouter.ts", evidence: "pf-id-jag-redeemed" },
  { n: 13, phase: "Tool call", from: "bff", to: "gateway", label: "Call the tool", where: "tools/call, Authorization: Bearer",
    does: "Sends the MCP request with the oauth-mcp access token. The ID-JAG goes no further than step 10.",
    source: "mcpGatewayClient.js" },
  { n: 14, phase: "Tool call", from: "gateway", to: "gateway", label: "Check and route", where: "tokenValidator, GatewayTokenPolicy, Step 3.7",
    does: "Verifies the token against oauth-mcp's keys, applies policy, and forwards unchanged when the audience already matches the backend. Otherwise it attempts an exchange and stops if that fails. The PingOne Authorize decision also happens around here.",
    source: "demo_mcp_gateway/src", traced: false },
  { n: 15, phase: "Tool call", from: "gateway", to: "mcp", label: "Forward the token", where: "to the OLB backend",
    does: "Passes the same token to the MCP server that owns get_my_accounts. The transport (WebSocket or HTTP) was not confirmed.",
    source: "router.ts (OLB_TOOLS)", traced: false },
  { n: 16, phase: "Tool call", from: "mcp", to: "mcp", label: "Resolve the token", where: "TokenResolver",
    does: "Sees a token issued by its own authorization server with no stashed PingOne token, so it skips the extra exchange and passes the token through.",
    source: "oauth-mcp/src/tools/TokenResolver.ts" },
  { n: 17, phase: "Data", from: "mcp", to: "bank", label: "Read the accounts", where: "GET /api/accounts/my, Bearer",
    does: "The MCP server calls the BFF banking API with the same token.",
    source: "oauth-mcp/src/banking/BankingAPIClient.ts" },
  { n: 18, phase: "Data", from: "bank", to: "bank", label: "Verify the token", where: "auth middleware",
    does: "Recognises oauth-mcp's issuer, verifies the signature against oauth-mcp's keys with an exact issuer check, then applies audience, scope and role checks.",
    source: "demo_api_server/middleware/auth.js" },
  { n: 19, phase: "Data", from: "bank", to: "browser", label: "Answer flows back", where: "banking API, MCP server, gateway, BFF, browser",
    does: "The balance travels back up the same chain. The BFF records token-chain events along the way for the trace display. Nobody calls PingFederate again.",
    source: "tokenChainTraceStore.js" },
];

export const actorById = (id) => ACTORS.find((a) => a.id === id);
// Diagram node ids touched by a call (ACTORS[].node), de-duplicated.
export const nodesForCall = (call) => [...new Set([actorById(call.from)?.node, actorById(call.to)?.node].filter(Boolean))];
