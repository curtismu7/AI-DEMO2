/**
 * UC-LOGIN — PingOne login (OIDC + PKCE). The browser is sent to PingOne, the
 * person authenticates, and the BFF redeems the returned authorization code
 * with a PKCE verifier: tokens stay in the BFF session, the browser only holds
 * a session cookie.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (browser)", sub: ["clicks Sign in"], x: 40, y: 150, detail: "Clicks 'Sign in with PingOne'; after the round trip her browser holds only a session cookie — no token ever reaches page JavaScript." },
  { id: "bff", group: "gateway", label: "BFF", sub: ["mints PKCE", "holds tokens"], x: 340, y: 150, detail: "Switches the provider to PingOne, destroys the old session, generates the code_verifier server-side, redirects with prompt=login, redeems the code and stores the access, ID and refresh tokens in the server session." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["hosted login", "token endpoint"], x: 640, y: 150, detail: "Authenticates the person (prompt=login forces a fresh sign-in instead of SSO bounce), issues the one-time authorization code, then the tokens." },
  { id: "rs", group: "resource", label: "Resource server", sub: ["/resource-server"], x: 940, y: 150, detail: "The OIDC Resource Server page uses the login token directly: no token exchange, PingOne Authorize or Agent Gateway." },
];

const EDGES = [
  ["user", "bff", "force fresh sign-in", { detail: "'Sign in with PingOne' — her tokens should never live in this browser." }],
  ["bff", "p1", "PKCE minted server-side", { detail: "The verifier never leaves the server — the browser only ever sees the challenge." }],
  ["p1", "rs", "callback + exchange", { detail: "The code returns to the BFF callback; the tokens it buys stay in the server session." }],
  ["rs", "user", "cookie, not token", { detail: "The login token is validated directly — no exchange, no Authorize, no gateway." }],
];

const walk = [
  {
    title: "Sign in with PingOne", label: "force fresh sign-in",
    nodes: ["user", "bff"], edges: [0],
    lines: [{ who: "Alice", text: "'Sign in with PingOne' — my tokens should never live in this browser." }],
    tech: [
      { t: "API", c: "POST /api/admin/config {oauth_provider:'pingone'} -> GET /api/auth/oauth/user/login?force=true" },
      { t: "POLICY", c: "force=true destroys the BFF session and sends prompt=login; SSO cannot silently re-auth" },
    ],
  },
  {
    title: "Redirect to hosted login", label: "PKCE minted server-side",
    nodes: ["bff", "p1"], edges: [1],
    lines: [{ who: "BFF", text: "The verifier never leaves the server — the browser only ever sees the challenge." }],
    tech: [
      { t: "API", c: "302 /as/authorize?response_type=code&redirect_uri=…&code_challenge_method=S256&state=…&nonce=…" },
      { t: "TOKEN", c: "code_verifier + state + nonce stored in the BFF session (never sent to the browser)" },
    ],
  },
  {
    title: "Code back, tokens stay", label: "callback + exchange",
    nodes: ["p1", "rs"], edges: [2],
    lines: [{ who: "PingOne", text: "The code returns to the BFF callback; the tokens it buys stay in the server session." }],
    tech: [
      { t: "API", c: "GET /api/auth/oauth/user/callback?code=…&state=… (state matched)" },
      { t: "TOKEN", c: "POST /as/token grant_type=authorization_code&code_verifier=… -> access_token (aud=BFF) + id_token + refresh_token, server-side only" },
    ],
  },
  {
    title: "End on the resource server", label: "cookie, not token",
    nodes: ["rs", "user"], edges: [3],
    lines: [{ who: "Resource server", text: "I validate the login token directly — no exchange, no Authorize, no gateway." }],
    tech: [
      { t: "TOKEN", c: "login AT (aud=ENDUSER_AUDIENCE) used directly — no RFC 8693 exchange, no P1AZ, no Agent Gateway" },
      { t: "API", c: "browser lands on /resource-server holding only the session cookie" },
    ],
  },
];

export default {
  id: "UC-LOGIN",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
