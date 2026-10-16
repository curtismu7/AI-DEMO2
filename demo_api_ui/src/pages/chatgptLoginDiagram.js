/**
 * How ChatGPT requests user login — same config shape as the use-case diagrams
 * (NODES / EDGES / walk), so StaticFlowDiagram + the shared stepper draw it, as on /use-case-diagrams/UC45.
 * One edge per pair of participants; the 12 numbered steps are the walk, each naming the edge(s) it runs along.
 */
import { PARTICIPANT_GROUPS as GROUPS } from "../config/useCaseDiagrams/palette";

export { GROUPS };

export const NODES = [
  { id: "user", group: "user", label: "User", sub: ["in ChatGPT"], x: 40, y: 150, detail: "Signs in once, in the browser, at the identity service. ChatGPT never sees the password." },
  { id: "chatgpt", group: "agent", label: "ChatGPT", sub: ["MCP client"], x: 480, y: 150, detail: "Calls the MCP tool, shows the sign-in link, runs the OAuth code + PKCE exchange and holds the resulting token." },
  { id: "gateway", group: "gateway", label: "MCP Gateway", sub: ["MCP server", "validates token + policy"], x: 920, y: 150, detail: "Signals the login requirement, then checks the token, scopes, consent and persona on every protected call." },
  { id: "idp", group: "pingone", label: "Identity Service", sub: ["e.g. PingOne"], x: 480, y: 300, detail: "Authenticates the user, collects consent and issues an access token bound to the MCP resource." },
];

export const EDGES = [
  ["user", "chatgpt", "1 ask · 4 sign-in link", { detail: "The user's prompt goes to ChatGPT; when a tool needs login, ChatGPT hands back a sign-in link." }],
  ["chatgpt", "gateway", "2 call · 3 challenge · 10 retry · 12 result", { detail: "The protected tool call, the authentication challenge, the retry with a bearer token, and the authorized result all travel this hop." }],
  ["user", "idp", "5 authorize · 6 sign in", { detail: "The user's browser opens the authorization endpoint directly. Credentials and consent stay between the user and the identity service." }],
  ["chatgpt", "idp", "7 code · 8 exchange · 9 token", { detail: "ChatGPT receives the authorization code via the browser redirect, exchanges it with the PKCE verifier and gets the resource-bound token.", vertical: true }],
];

const E = { ask: 0, mcp: 1, authz: 2, token: 3 };

export const walk = [
  {
    title: "Show my benefits", label: "step 1 · User → ChatGPT",
    nodes: ["user", "chatgpt"], edges: [E.ask],
    lines: [{ who: "User", text: "Asks a question that needs a protected MCP tool." }],
    tech: [{ t: "API", c: "natural-language prompt in ChatGPT" }],
  },
  {
    title: "Call protected MCP tool", label: "step 2 · ChatGPT → Gateway",
    nodes: ["chatgpt", "gateway"], edges: [E.mcp],
    lines: [{ who: "ChatGPT", text: "Calls the tool with no access token yet." }],
    tech: [{ t: "API", c: 'POST /mcp  {"method":"tools/call","params":{"_meta":{"openai/locale":"en-US"}}}' }],
  },
  {
    title: "Authentication required", label: "step 3 · Gateway → ChatGPT",
    nodes: ["gateway", "chatgpt"], edges: [E.mcp],
    lines: [{ who: "Gateway", text: "Signals the requirement: an HTTP 401 challenge or, for ChatGPT callers, a tool error carrying the same challenge. Both point at the RFC 9728 protected-resource metadata." }],
    tech: [
      { t: "API", c: 'HTTP 401  WWW-Authenticate: Bearer resource_metadata="https://…/.well-known/oauth-protected-resource"' },
      { t: "API", c: 'or result._meta["mcp/www_authenticate"] = ["Bearer resource_metadata=…"]' },
    ],
  },
  {
    title: "Connect / sign in", label: "step 4 · ChatGPT → User",
    nodes: ["chatgpt", "user"], edges: [E.ask],
    lines: [{ who: "ChatGPT", text: "Shows a sign-in link. The user's browser opens to the identity service." }],
    tech: [{ t: "POLICY", c: "link shown because tools/list declared securitySchemes: oauth2" }],
  },
  {
    title: "Open /oauth/authorize", label: "step 5 · User → Identity Service",
    nodes: ["user", "idp"], edges: [E.authz],
    lines: [{ who: "Browser", text: "Goes to the authorization endpoint from the metadata, with a PKCE challenge and the MCP resource as audience." }],
    tech: [{ t: "API", c: "GET /authorize?response_type=code&client_id=…&code_challenge=…&code_challenge_method=S256&resource=…" }],
  },
  {
    title: "Authenticate user + consent", label: "step 6 · Identity Service",
    nodes: ["idp", "user"], edges: [E.authz],
    lines: [{ who: "User", text: "Enters credentials at the identity service and reviews the requested access." }],
    tech: [{ t: "POLICY", c: "PingOne sign-in policy + consent screen" }],
  },
  {
    title: "Return authorization code", label: "step 7 · Identity Service → ChatGPT",
    nodes: ["idp", "chatgpt"], edges: [E.token],
    lines: [{ who: "Identity Service", text: "Redirects the browser back to ChatGPT with a one-time code." }],
    tech: [{ t: "API", c: "302 → ChatGPT redirect_uri?code=…&state=…" }],
  },
  {
    title: "Exchange code + PKCE verifier", label: "step 8 · ChatGPT → Identity Service",
    nodes: ["chatgpt", "idp"], edges: [E.token],
    lines: [{ who: "ChatGPT", text: "Redeems the code at the token endpoint, proving possession with the PKCE verifier." }],
    tech: [{ t: "API", c: "POST /token  grant_type=authorization_code&code=…&code_verifier=…" }],
  },
  {
    title: "Access token for MCP resource", label: "step 9 · Identity Service → ChatGPT",
    nodes: ["idp", "chatgpt"], edges: [E.token],
    lines: [{ who: "Identity Service", text: "Issues an access token bound to the MCP resource (audience)." }],
    tech: [{ t: "TOKEN", c: '{"access_token":"…","token_type":"Bearer","aud":"<mcp resource>","scope":"…"}' }],
  },
  {
    title: "Retry with Authorization: Bearer", label: "step 10 · ChatGPT → Gateway",
    nodes: ["chatgpt", "gateway"], edges: [E.mcp],
    lines: [{ who: "ChatGPT", text: "Repeats the original tool call, now with the token." }],
    tech: [{ t: "API", c: "POST /mcp  Authorization: Bearer <token>" }],
  },
  {
    title: "Validate token + evaluate policy", label: "step 11 · Gateway",
    nodes: ["gateway"], edges: [],
    lines: [{ who: "Gateway", text: "Checks the token, scopes, consent, persona, line of business and member relationship before the tool runs." }],
    tech: [{ t: "POLICY", c: "signature · iss · aud · exp · scope → allow / deny, audited" }],
  },
  {
    title: "Return authorized result", label: "step 12 · Gateway → ChatGPT → User",
    nodes: ["gateway", "chatgpt", "user"], edges: [E.mcp, E.ask],
    lines: [{ who: "ChatGPT", text: "Shows the user their benefits, based on their permissions." }],
    tech: [{ t: "API", c: 'HTTP 200  {"result":{"content":[…]}}' }],
  },
];

export const PANELS = [
  { title: "What triggers the prompt?", items: ["Tool metadata: securitySchemes → oauth2", "Publish OAuth protected-resource metadata", 'Tool error: _meta["mcp/www_authenticate"]'], foot: "Transport challenge: HTTP 401 + WWW-Authenticate" },
  { title: "Three separate decisions", items: ["Authentication — who is the user?", "Consent — what has the user agreed to?", "Authorization — is this action allowed?"], foot: "Authorization checks applicable consent." },
  { title: "Proposed gateway policy", items: ["Persona · LOB · member relationship", "Resource · action · scopes · consent", "Audit each access decision"], foot: "Apply policy on every protected call." },
];
