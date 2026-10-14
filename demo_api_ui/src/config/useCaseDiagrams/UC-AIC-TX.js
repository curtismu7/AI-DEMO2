/**
 * UC-AIC-TX — RFC 8693 delegation exchange at PingOne Advanced Identity Cloud.
 * The person signs in directly at AIC (subject token), the agent gets its own
 * token with client credentials (actor token), and the agent exchanges the pair
 * for a narrower token that records who is acting. Every call is made by the
 * BFF, which holds all three tokens; the browser sees only a redacted trace.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (browser)", sub: ["signs in at AIC"], x: 40, y: 150, detail: "Signs in directly at AIC, beside her app session. Her browser never holds a token — only the redacted trace the BFF returns." },
  { id: "bff", group: "gateway", label: "BFF", sub: ["holds all three tokens"], x: 340, y: 150, detail: "Runs the AIC sign-in with PKCE, keeps the user token, the actor token and the delegated token in the server session, and makes the agent's calls with the agent client's credentials." },
  { id: "aic", group: "external", label: "PingOne AIC", sub: ["authorization server", "May Act script"], x: 640, y: 150, detail: "Issues all three tokens. It only exchanges tokens it issued itself, and only when the subject client's May Act script names the actor." },
  { id: "agent", group: "agent", label: "Agent client", sub: ["confidential", "the actor"], x: 640, y: 340, detail: "A confidential AIC client with the Client Credentials and Token Exchange grants. It is the party the delegated token says is acting for Alice." },
];

const EDGES = [
  ["user", "bff", "sign in at AIC", { detail: "A second sign-in beside the app session: the app's own login only yields PingOne tokens." }],
  ["bff", "aic", "code + PKCE", { detail: "Authorization code with PKCE on a public client; the access token it returns is the subject token." }],
  ["agent", "aic", "client credentials", { detail: "The agent authenticates as itself; the access token it gets is the actor token." }],
  ["aic", "agent", "delegated token", { detail: "A narrower token for Alice, issued to the agent, carrying an act claim that names the agent." }],
];

const walk = [
  {
    title: "Sign in at AIC", label: "sign in at AIC",
    nodes: ["user", "bff"], edges: [0],
    lines: [{ who: "Alice", text: "I sign in at AIC itself — the exchange needs a token AIC issued for me." }],
    tech: [
      { t: "API", c: "GET /api/aic-demo/login/start -> 302 AIC /authorize?client_id=<public client>&scope=openid profile email <scope>&code_challenge_method=S256" },
      { t: "POLICY", c: "the app session is untouched; AIC state and the PKCE verifier live in req.session.aicDemo" },
    ],
  },
  {
    title: "User token", label: "code + PKCE",
    nodes: ["bff", "aic"], edges: [1],
    lines: [{ who: "BFF", text: "I redeem the code with the verifier and keep the token. This is the subject token." }],
    tech: [
      { t: "API", c: "GET /api/aic-demo/callback?code=…&state=… -> POST /access_token grant_type=authorization_code&code_verifier=…" },
      { t: "TOKEN", c: "access_token (opaque by default) + id_token, verified against AIC's JWKS; may_act is added by the subject client's May Act script" },
    ],
  },
  {
    title: "Actor token", label: "client credentials",
    nodes: ["agent", "aic"], edges: [2],
    lines: [{ who: "Agent", text: "I authenticate as myself. This is the actor token." }],
    tech: [
      { t: "API", c: "POST /api/aic-demo/actor-token -> POST /access_token grant_type=client_credentials&scope=<scope> (HTTP Basic as the agent client)" },
    ],
  },
  {
    title: "Exchange", label: "delegated token",
    nodes: ["aic", "agent"], edges: [3],
    lines: [
      { who: "Agent", text: "Here is Alice's token and mine — let me act for her, for this scope only." },
      { who: "AIC", text: "Her token says you may. Here is a token for her that names you as the actor." },
    ],
    tech: [
      { t: "API", c: "POST /api/aic-demo/exchange -> POST /access_token grant_type=urn:ietf:params:oauth:grant-type:token-exchange&subject_token=…&actor_token=…&scope=<scope>" },
      { t: "TOKEN", c: "delegated access_token, sub = Alice, act = the agent client; introspected by the agent client to show the claims" },
      { t: "POLICY", c: "refused unless the Token Exchange grant is on the agent client and the May Act script names it" },
    ],
  },
];

export default {
  id: "UC-AIC-TX",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
