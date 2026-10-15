// "How ChatGPT requests user login": 4 lanes, 12 numbered steps. `from`/`to` are lane indexes;
// from === to is a step that happens inside one lane. `n` is the number shown on the arrow.
export const LANES = [
  { id: "user", title: "User", sub: "in ChatGPT" },
  { id: "chatgpt", title: "ChatGPT", sub: "MCP client" },
  { id: "gateway", title: "MCP Gateway", sub: "MCP server" },
  { id: "idp", title: "Identity Service", sub: "e.g. PingOne" },
];

export const STEPS = [
  { n: 1, from: 0, to: 1, label: "Show my benefits", detail: "The user asks a question that needs a protected MCP tool.", wire: "natural-language prompt" },
  { n: 2, from: 1, to: 2, label: "Call protected MCP tool", detail: "ChatGPT calls the tool with no access token yet.", wire: 'POST /mcp  {"method":"tools/call", "params":{"_meta":{"openai/locale":"en-US"}}}' },
  { n: 3, from: 2, to: 1, label: "Authentication required", detail: "The server signals the requirement: an HTTP 401 challenge, or, for ChatGPT callers, a tool error carrying the same challenge in _meta. Both point at the RFC 9728 protected-resource metadata.", wire: 'HTTP 401  WWW-Authenticate: Bearer resource_metadata="https://…/.well-known/oauth-protected-resource"\n— or —\nresult._meta["mcp/www_authenticate"] = ["Bearer resource_metadata=\\"…\\""]' },
  { n: 4, from: 1, to: 0, label: "Connect / sign in", detail: "ChatGPT shows a sign-in link. The user's browser opens to the identity service.", wire: "ChatGPT renders the link because tools/list declared securitySchemes: oauth2" },
  { n: 5, from: 0, to: 3, label: "Open /oauth/authorize", detail: "The browser goes to the authorization endpoint found in the metadata, with a PKCE challenge and the MCP resource as the audience.", wire: "GET /authorize?response_type=code&client_id=…&code_challenge=…&code_challenge_method=S256&resource=…" },
  { n: 6, from: 3, to: 3, label: "Authenticate user + consent", detail: "The user enters credentials at the identity service and reviews the requested access.", wire: "PingOne sign-in policy + consent screen" },
  { n: 7, from: 3, to: 1, label: "Return authorization code", detail: "The identity service redirects the browser back to ChatGPT with a one-time code.", wire: "302 → ChatGPT redirect_uri?code=…&state=…" },
  { n: 8, from: 1, to: 3, label: "Exchange code + PKCE verifier", detail: "ChatGPT redeems the code at the token endpoint, proving possession with the PKCE verifier.", wire: "POST /token  grant_type=authorization_code&code=…&code_verifier=…" },
  { n: 9, from: 3, to: 1, label: "Access token for MCP resource", detail: "The identity service issues an access token bound to the MCP resource (audience).", wire: '{"access_token":"…","token_type":"Bearer","aud":"<mcp resource>","scope":"…"}' },
  { n: 10, from: 1, to: 2, label: "Retry with Authorization: Bearer", detail: "ChatGPT repeats the original tool call, now with the token.", wire: "POST /mcp  Authorization: Bearer <token>" },
  { n: 11, from: 2, to: 2, label: "Validate token + evaluate policy", detail: "The gateway checks the token, scopes, consent, persona, line of business and member relationship before the tool runs.", wire: "signature · iss · aud · exp · scope → allow / deny, logged" },
  { n: 12, from: 2, to: 1, label: "Return authorized result", detail: "The tool result goes back to ChatGPT, which shows the user their benefits based on their permissions.", wire: 'HTTP 200  {"result":{"content":[…]}}' },
];

export const PANELS = [
  { title: "What triggers the prompt?", items: ["Tool metadata: securitySchemes → oauth2", "Publish OAuth protected-resource metadata", 'Tool error: _meta["mcp/www_authenticate"]'], foot: "Transport challenge: HTTP 401 + WWW-Authenticate" },
  { title: "Three separate decisions", items: ["Authentication — who is the user?", "Consent — what has the user agreed to?", "Authorization — is this action allowed?"], foot: "Authorization checks applicable consent." },
  { title: "Proposed gateway policy", items: ["Persona · LOB · member relationship", "Resource · action · scopes · consent", "Audit each access decision"], foot: "Apply policy on every protected call." },
];
