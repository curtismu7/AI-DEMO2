/**
 * UC-LOGIN-AIC — AIC login, federated through PingOne. PingOne stays the
 * authorization server; its AIC_Login sign-on policy sends the browser to
 * PingOne Advanced Identity Cloud to authenticate. AIC's tokens stop at
 * PingOne — the BFF still redeems a PingOne code and holds PingOne tokens.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (browser)", sub: ["clicks Sign in"], x: 40, y: 150, detail: "Clicks 'Sign in with AIC'; she authenticates at AIC, and after the round trip her browser holds only a session cookie." },
  { id: "bff", group: "gateway", label: "BFF", sub: ["mints PKCE", "holds tokens"], x: 340, y: 150, detail: "Turns AIC sign-in on, destroys the old session, generates the code_verifier server-side and redirects to PingOne asking for the AIC_Login policy. It redeems PingOne's code and stores PingOne's tokens in the server session." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["authorization server", "federates to AIC"], x: 640, y: 150, detail: "Runs the AIC_Login sign-on policy, whose one step is the AIC external identity provider. After AIC returns, PingOne links or creates the user and issues its own authorization code and tokens." },
  { id: "aic", group: "external", label: "PingOne AIC", sub: ["authenticates the person"], x: 640, y: 340, detail: "PingOne Advanced Identity Cloud, alpha realm. PingOne is an OIDC client of AIC: the person signs in here and AIC returns a code to PingOne's callback." },
  { id: "rs", group: "resource", label: "Resource server", sub: ["/resource-server"], x: 940, y: 150, detail: "The OIDC Resource Server page uses the PingOne login token directly: no token exchange, PingOne Authorize or Agent Gateway." },
];

const EDGES = [
  ["user", "bff", "force fresh sign-in", { detail: "'Sign in with AIC' — her identity lives in AIC, her tokens stay on the server." }],
  ["bff", "p1", "acr_values=AIC_Login", { detail: "A normal PKCE authorize request to PingOne, naming the sign-on policy that hands off to AIC." }],
  ["p1", "aic", "redirect to AIC", { detail: "PingOne sends the browser to AIC's authorize endpoint as an OIDC client." }],
  ["aic", "p1", "code to PingOne", { detail: "AIC authenticates the person and returns a code to PingOne's callback; AIC's tokens stop at PingOne." }],
  ["p1", "rs", "callback + exchange", { detail: "PingOne's own code returns to the BFF callback; the PingOne tokens it buys stay in the server session." }],
  ["rs", "user", "cookie, not token", { detail: "The PingOne login token is validated directly — no exchange, no Authorize, no gateway." }],
];

const walk = [
  {
    title: "Sign in with AIC", label: "force fresh sign-in",
    nodes: ["user", "bff"], edges: [0],
    lines: [{ who: "Alice", text: "'Sign in with AIC' — my account lives in Advanced Identity Cloud." }],
    tech: [
      { t: "API", c: "POST /api/admin/config {oauth_provider:'pingone', aic_login_enabled:'true'} -> GET /api/auth/oauth/user/login?force=true" },
      { t: "POLICY", c: "force=true destroys the BFF session and sends prompt=login; SSO cannot silently re-auth" },
    ],
  },
  {
    title: "Redirect to PingOne", label: "acr_values=AIC_Login",
    nodes: ["bff", "p1"], edges: [1],
    lines: [{ who: "BFF", text: "Same PKCE request as any login — I only name the sign-on policy that federates to AIC." }],
    tech: [
      { t: "API", c: "302 /as/authorize?response_type=code&acr_values=AIC_Login&code_challenge_method=S256&state=…&nonce=…" },
      { t: "POLICY", c: "AIC_Login must be assigned to the User Login app, or PingOne rejects the acr_values" },
    ],
  },
  {
    title: "PingOne hands off to AIC", label: "federated sign-in",
    nodes: ["p1", "aic"], edges: [2, 3],
    lines: [
      { who: "PingOne", text: "This policy has one step: the AIC identity provider. Over to you." },
      { who: "AIC", text: "She signed in with me — here is a code for your callback." },
    ],
    tech: [
      { t: "API", c: "302 AIC /am/oauth2/alpha/authorize?client_id=…&scope=openid profile email -> PingOne /rp/callback/openid_connect?code=…" },
      { t: "TOKEN", c: "PingOne redeems AIC's code, maps sub/email/name, links or creates the PingOne user; AIC tokens never reach the BFF" },
    ],
  },
  {
    title: "Code back, tokens stay", label: "callback + exchange",
    nodes: ["p1", "rs"], edges: [4],
    lines: [{ who: "PingOne", text: "My own code returns to the BFF callback; the tokens it buys are PingOne tokens." }],
    tech: [
      { t: "API", c: "GET /api/auth/oauth/user/callback?code=…&state=… (state matched)" },
      { t: "TOKEN", c: "POST /as/token grant_type=authorization_code&code_verifier=… -> PingOne access_token + id_token + refresh_token, server-side only" },
    ],
  },
  {
    title: "End on the resource server", label: "cookie, not token",
    nodes: ["rs", "user"], edges: [5],
    lines: [{ who: "Resource server", text: "A PingOne token, validated as usual — I cannot tell she signed in at AIC, and I do not need to." }],
    tech: [
      { t: "TOKEN", c: "login AT issued by PingOne — token exchange, P1AZ and the Agent Gateway work unchanged afterwards" },
      { t: "API", c: "browser lands on /resource-server holding only the session cookie" },
    ],
  },
];

export default {
  id: "UC-LOGIN-AIC",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
