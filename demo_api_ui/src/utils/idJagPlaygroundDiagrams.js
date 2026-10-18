// One ReactFlow diagram per ID-JAG playground mode, as data. The page
// (pages/IdJagPlaygroundDiagramPage.jsx) only draws what is here, so a standalone copy of the
// playground can take this file as is.
//
// nodes: actors (kind picks the accent colour). notes: gotcha callouts, lit on their steps.
// edges: one real call each. steps = the playground step numbers (1-5) the call belongs to;
// fh/th = card handles (T|B|L|R + 1..3). dashed = where trust comes from (a JWKS or registry
// read) or an alternate path. ambient = lit but not zoomed to (the browser's button presses).
// Step 0 is the overview: everything lit.

export const playgroundDiagramPath = (mode, step) =>
  `/pingfederate-id-jag/playground/diagram/${mode}${step ? `?step=${step}` : ""}`;

const E = (id, from, fh, to, th, steps, label, dashed = false) => ({ id, from, fh, to, th, steps, label, dashed });
const AMBIENT = (e) => ({ ...e, ambient: true });

const BROWSER = { id: "browser", kind: "user", title: "Browser", sub: "the playground page · session cookie only",
  lines: ["Clicks each step's button", "Sees decoded claims and redacted requests, never a raw token"] };
const BFF = { id: "bff", kind: "bff", title: "BFF · the OAuth client", sub: "demo_api_server · /api/id-jag-playground",
  lines: ["Holds every token server-side: refresh token, ID-JAG, access token", "Runs a pre-flight check before each button"] };
const GW = { id: "gw", kind: "gw", title: "Node MCP gateway", sub: "MCP_DEMO_GATEWAY_URL · POST /mcp" };
const MCP = { id: "mcp", kind: "rs", title: "MCP server", sub: "the tools of the active vertical",
  lines: ["Answers tools/list and tools/call", "Lists only what the token's scope allows"] };
const PROFILE = { id: "profile", kind: "rs", title: "Protected resource", sub: "GET /protected/profile on oauth-mcp",
  lines: ["Same bearer validation as oauth-mcp's tools", "Says which check failed when it refuses"] };
const BUTTONS = "POST /api/id-jag-playground/… (cookie only)";
const NEGATIVE = "replay · tampered signature · other client · extra scope";

const STEP_TITLES = ["Sign in", "Get an ID-JAG", "Redeem it", "Call the MCP server", "Negative tests"];
const steps = (texts, titles = STEP_TITLES) => texts.map((text, i) => ({ n: i + 1, t: titles[i], text }));

export const PLAYGROUND_DIAGRAMS = {
  mock: {
    label: "Mock",
    lede: "Same five steps, answered by sample data inside the page. Nothing is sent.",
    overview: "Mock mode needs no sign-in and makes no network call: idJagPlaygroundMock.js stands in for the BFF and returns the same response shapes, so the page renders exactly as in a real run. Hosts below are sample values.",
    nodes: [
      { ...BROWSER, x: 0, y: 300, sub: "the playground page, in Mock mode", lines: ["Every button calls the mock API, not the network"] },
      { id: "mockapi", kind: "bff", x: 520, y: 300, title: "Mock API", sub: "idJagPlaygroundMock.js · in the page",
        lines: ["Fixtures for issue, inspect, redeem, call and negative tests", "Sample trusted IdP: Partner Okta (sample)"] },
      { id: "pf", kind: "pf", x: 1040, y: 0, title: "PingFederate (sample)", sub: "pingfederate.example.com",
        lines: ["Sample ID-JAG typed oauth-id-jag+jwt", "Exchange client agent-exchange-client"] },
      { id: "as", kind: "as", x: 1040, y: 600, title: "MCP authorization server (sample)", sub: "mcp-as.example.com/token",
        lines: ["Sample redemption for client agent-mcp-client"] },
      { ...GW, x: 1560, y: 300, title: "MCP gateway (sample)", sub: "mcp-gateway.example.com/mcp", lines: ["Sample tools: search_records, get_record, create_note"] },
      { ...MCP, x: 2080, y: 300, title: "MCP server (sample)", sub: "mcp.example.com/mcp" },
      { ...PROFILE, x: 520, y: 640, title: "Protected resource (sample)", sub: "sample /protected/profile page" },
    ],
    notes: [
      { id: "n-mock", x: 0, y: 40, steps: [1, 2, 3, 4, 5], text: "Mock: every arrow is simulated by idJagPlaygroundMock.js inside the page. No sign-in, no network, no real token." },
    ],
    edges: [
      AMBIENT(E("m1", "browser", "R2", "mockapi", "L2", [1, 2, 3, 4, 5], "①–⑤ mockApi.post(…) · no network")),
      E("m2", "mockapi", "T3", "pf", "B1", [2, 5], "② simulated RFC 8693 token exchange · requested_token_type=id-jag"),
      E("m3", "mockapi", "R3", "as", "L1", [3], "③ simulated RFC 7523 jwt-bearer · client_id agent-mcp-client"),
      E("m3k", "as", "T2", "pf", "B2", [3], "③ sample JWKS check", true),
      E("m4", "mockapi", "R1", "gw", "L2", [4], "④ simulated tools/list · tools/call (Bearer)"),
      E("m4f", "gw", "R2", "mcp", "L2", [4], "④ sample tools"),
      E("m4r", "mockapi", "B2", "profile", "T2", [4], "④ sample protected page"),
      E("m5", "mockapi", "B3", "as", "L3", [5], `⑤ sample refusals: ${NEGATIVE}`),
    ],
    steps: steps([
      "No sign-in: the mock config says you are signed in, so steps 2 to 5 are ready at once.",
      "A sample ID-JAG comes back with the same request, response and spec-check table a real exchange produces.",
      "A sample redemption returns a decoded access token. The scope dropdown lists the sample ID-JAG's scopes.",
      "tools/list returns three sample tools; tools/call returns a sample result. The protected page renders a sample profile.",
      "Each negative test returns a sample refusal so you can see what a pass looks like.",
    ], ["No sign-in", "Get an ID-JAG", "Redeem it", "Call the MCP server", "Negative tests"]),
  },

  "oauth-mcp": {
    label: "PingFederate → oauth-mcp",
    lede: "The app's PingFederate issues the ID-JAG; oauth-mcp redeems it; the Node MCP gateway carries the call.",
    overview: "PingFederate is the IdP: it issues a short-lived, single-use ID-JAG from your session. oauth-mcp is the MCP server's authorization server: it trusts PingFederate's keys, redeems the ID-JAG and mints its own token. Only that token travels on to the gateway, the MCP server and the protected page.",
    nodes: [
      { ...BROWSER, x: 0, y: 300 },
      { ...BFF, x: 520, y: 300 },
      { id: "pf", kind: "pf", x: 1040, y: 0, title: "PingFederate · issues the ID-JAG", sub: "pf_issuer · local.ping-devops.com:9031 or SE cmuir-pf.ping-devops.com",
        lines: ["Sign-in at its own login page", "Token exchange policy + SP connection with ID-JAG on", "Signs typ oauth-id-jag+jwt · keys at /pf/JWKS"] },
      { id: "mcpas", kind: "as", x: 1040, y: 600, title: "oauth-mcp · resource AS", sub: "pf_id_jag_redemption_token_endpoint · SE cmuir-mcp.ping-devops.com/token",
        lines: ["Verifies the ID-JAG against PingFederate's JWKS", "client_id must be the redeeming client · jti single-use", "Mints its own access token"] },
      { ...GW, x: 1560, y: 300, lines: ["Picks the JWKS by iss: oauth-mcp's here", "Verifies signature, expiry, audience, scope", "Forwards to the tool's server"] },
      { ...MCP, x: 2080, y: 300 },
      { ...PROFILE, x: 520, y: 640 },
    ],
    notes: [
      { id: "n-custody", x: 0, y: 600, steps: [1], text: "Custody: the browser never holds a token. The BFF keeps each one in its session and returns decoded claims and redacted requests only." },
      { id: "n-stop", x: 1560, y: 620, steps: [4], text: "The ID-JAG stops at oauth-mcp. The MCP call and the protected page carry oauth-mcp's own token; the raw ID-JAG must be refused there." },
      { id: "n-jti", x: 1040, y: 880, steps: [5], text: "Each test mints a fresh ID-JAG (② again), breaks one thing and expects an OAuth error with no token. Replay is refused because oauth-mcp keeps jti single-use." },
    ],
    edges: [
      E("o1a", "browser", "T2", "pf", "L1", [1], "① sign in at PingFederate's login page (authorize, prompt=login)"),
      E("o1b", "pf", "L3", "bff", "T2", [1], "① code → BFF callback · BFF keeps the refresh token"),
      AMBIENT(E("obtn", "browser", "R2", "bff", "L2", [2, 3, 4, 5], `②–⑤ ${BUTTONS}`)),
      E("o2", "bff", "T3", "pf", "B1", [2, 5], "② RFC 8693 token exchange · requested_token_type=id-jag · subject=refresh token"),
      E("o3", "bff", "R3", "mcpas", "L1", [3], "③ RFC 7523 jwt-bearer · client_id demo-bff-mcp-client · scope ⊆ ID-JAG"),
      E("o3k", "mcpas", "T2", "pf", "B2", [3], "③ JWKS fetch · PingFederate /pf/JWKS (x5t)", true),
      E("o4", "bff", "R1", "gw", "L2", [4], "④ tools/list · tools/call (Bearer oauth-mcp token)"),
      E("o4k", "gw", "B2", "mcpas", "R2", [4], "④ verify vs oauth-mcp JWKS", true),
      E("o4f", "gw", "R2", "mcp", "L2", [4], "④ forward to the tool's server"),
      E("o4r", "bff", "B2", "profile", "T2", [4], "④ GET /protected/profile · token | none | raw ID-JAG"),
      E("o5", "bff", "B3", "mcpas", "L3", [5], `⑤ broken assertions: ${NEGATIVE}`),
    ],
    steps: steps([
      "A fresh sign-in at PingFederate's own login page. The BFF swaps the code for tokens and keeps the refresh token: the ID-JAG is minted from it.",
      "RFC 8693 token exchange at PingFederate with requested_token_type=…:id-jag. subject_token is the refresh token, audience is oauth-mcp's issuer, resource is the MCP server. PingFederate returns a JWT typed oauth-id-jag+jwt that lives about 5 minutes; the page checks it against the draft.",
      "RFC 7523 JWT bearer grant at oauth-mcp. It reads PingFederate's keys, checks typ, signature, iss, a single aud equal to its issuer, expiry, that client_id is the client redeeming now, and that the jti is unused. It grants at most the ID-JAG's scope and mints its own access token.",
      "tools/list and tools/call go to the Node MCP gateway with oauth-mcp's token. The gateway picks oauth-mcp's JWKS by iss, verifies the token and forwards it. oauth-mcp's /protected/profile takes the same token and must refuse no token and the raw ID-JAG.",
      "Each test mints a fresh ID-JAG, breaks one thing (replay, signature, client, scope) and expects an OAuth error with no token.",
    ], ["Sign in with PingFederate", "Get an ID-JAG from PingFederate", "Redeem at oauth-mcp", "Call the MCP server", "Negative tests"]),
  },

  "pf-pf": {
    label: "PingFederate → PingFederate",
    lede: "The SE PingFederate issues the ID-JAG; the local PingFederate redeems it; the gateway validates PingFederate's token.",
    overview: "Two PingFederates: the SE one is the IdP and issues the ID-JAG after a sign-in at its own login page; the local one is the resource authorization server and redeems it with a JWT bearer grant through an IdP connection. The token it mints comes from the access token manager the gateway trusts.",
    nodes: [
      { ...BROWSER, x: 0, y: 300 },
      { ...BFF, x: 520, y: 300 },
      { id: "sepf", kind: "pf", x: 1040, y: 0, title: "SE PingFederate · issuer", sub: "cmuir-pf.ping-devops.com · PF_IDJAG_ISSUER_PF_URL",
        lines: ["Its own login page (code + PKCE, offline_access)", "Token exchange policy issues the ID-JAG", "Signs with the key published at /pf/JWKS"] },
      { id: "localpf", kind: "as", x: 1040, y: 600, title: "Local PingFederate · resource AS", sub: "local.ping-devops.com:9031 · pf_issuer · /as/token.oauth2",
        lines: ["JWT bearer grant through an IdP connection to the SE issuer", "Client ai-demo-pf-idjag-redeemer", "Mints from the access token manager the gateway trusts"] },
      { ...GW, x: 1560, y: 300, lines: ["Picks the JWKS by iss: PingFederate's here", "Verifies signature, expiry, audience, scope", "Forwards to the tool's server"] },
      { ...MCP, x: 2080, y: 300 },
      { ...PROFILE, x: 520, y: 640 },
    ],
    notes: [
      { id: "n-two", x: 520, y: -200, steps: [1, 2], text: "Two PingFederates on purpose: an IdP must not redeem its own ID-JAG (draft §9.3), and only the SE issuer's JWKS is reachable from both." },
      { id: "n-x5t", x: 1040, y: 880, steps: [3], text: "Gotcha: PingFederate cannot pick a key by x5t. The SE issuer must publish a single-key JWKS, and the local PingFederate caches it: re-save the IdP connection (or restart it) after a key change, or redeem fails with \"Invalid JWT token\"." },
      { id: "n-iss", x: 0, y: 600, steps: [4], text: "The access token comes from the local PingFederate, so oauth-mcp's /protected/profile refuses it at the issuer check. Expected here: PingFederate → oauth-mcp shows it accepted." },
    ],
    edges: [
      E("p1a", "browser", "T2", "sepf", "L1", [1], "① GET /issuer/login → SE PingFederate login page (code + PKCE, prompt=login)"),
      E("p1b", "sepf", "L3", "bff", "T2", [1], "① code → /issuer/callback · BFF keeps the issuer refresh token"),
      AMBIENT(E("pbtn", "browser", "R2", "bff", "L2", [2, 3, 4, 5], `②–⑤ ${BUTTONS}`)),
      E("p2", "bff", "T3", "sepf", "B1", [2, 5], "② RFC 8693 token exchange · requested_token_type=id-jag · audience=local PingFederate"),
      E("p3", "bff", "R3", "localpf", "L1", [3], "③ RFC 7523 jwt-bearer · client_id ai-demo-pf-idjag-redeemer"),
      E("p3k", "localpf", "T2", "sepf", "B2", [3], "③ IdP connection fetches the SE /pf/JWKS (single key)", true),
      E("p4", "bff", "R1", "gw", "L2", [4], "④ tools/list · tools/call (Bearer PingFederate token)"),
      E("p4k", "gw", "B2", "localpf", "R2", [4], "④ verify vs PingFederate JWKS", true),
      E("p4f", "gw", "R2", "mcp", "L2", [4], "④ forward to the tool's server"),
      E("p4r", "bff", "B2", "profile", "T2", [4], "④ GET /protected/profile → refused at the issuer check"),
      E("p5", "bff", "B3", "localpf", "L3", [5], `⑤ broken assertions: ${NEGATIVE}`),
    ],
    steps: steps([
      "A sign-in at the SE PingFederate's own login page, separate from the app's sign-in. The BFF runs code + PKCE against the issuer and keeps its refresh token.",
      "RFC 8693 token exchange at the SE PingFederate with requested_token_type=…:id-jag, subject = the issuer refresh token, audience = the local PingFederate's issuer.",
      "RFC 7523 JWT bearer grant at the local PingFederate as client ai-demo-pf-idjag-redeemer. Its IdP connection to the SE issuer verifies the signature with the issuer's JWKS, then the access token manager mints the token the gateway trusts.",
      "tools/list and tools/call go to the Node MCP gateway with PingFederate's token; the gateway validates it against PingFederate's keys and forwards it. oauth-mcp's protected page refuses this token at the issuer check, as expected.",
      "Each test mints a fresh ID-JAG at the SE PingFederate, breaks one thing and expects the local PingFederate to refuse it with no token.",
    ], ["Sign in at the issuer PingFederate", "Get an ID-JAG from the SE PingFederate", "Redeem at the local PingFederate", "Call the MCP server", "Negative tests"]),
  },

  byo: {
    label: "Your IdP → our resource AS",
    lede: "An outside company's IdP issues the ID-JAG; our oauth-mcp or PingFederate redeems it because the Trusted IdPs registry says so.",
    overview: "An outside agent signs its user in at its own IdP (for example the Acme PingFederate) and gets an ID-JAG addressed to our authorization server. You paste it here, or scripts/id-jag/outside-agent.js presents it directly. Our resource authorization server only trusts that IdP because an admin put it on the Trusted IdPs registry.",
    nodes: [
      { id: "agent", kind: "user", x: 0, y: 0, title: "Outside agent", sub: "scripts/id-jag/outside-agent.js · or you",
        lines: ["Signs its user in at its own IdP", "Gets an ID-JAG addressed to our authorization server"] },
      { id: "extidp", kind: "pf", x: 1040, y: 0, title: "Outside IdP · issues", sub: "e.g. Acme PingFederate · cmuir-pf-acme.ping-devops.com",
        lines: ["Token exchange → ID-JAG, aud = our AS issuer", "client_id = the one it registered for us", "Publishes its own JWKS"] },
      { ...BROWSER, x: 0, y: 340, title: "Browser · paste", lines: ["Pastes the ID-JAG once; the BFF keeps it", "Sees decoded claims only"] },
      { ...BFF, x: 520, y: 340 },
      { id: "oauthmcp", kind: "as", x: 1040, y: 680, title: "oauth-mcp · resource AS", sub: "target oauth-mcp · SE cmuir-mcp.ping-devops.com/token",
        lines: ["Trusts an outside issuer only if the registry lists it", "Verifies against that IdP's JWKS · aud = its issuer", "Mints its own access token"] },
      { id: "ourpf", kind: "as", x: 1040, y: 1000, title: "Our PingFederate · resource AS", sub: "target pingfederate · pf_issuer",
        lines: ["JWT bearer via an IdP connection synced from the registry", "Client ai-demo-pf-idjag-redeemer"] },
      { id: "registry", kind: "bff", x: 520, y: 1000, title: "Trusted IdPs registry", sub: "BFF · id_jag_trusted_idps",
        lines: ["Admin-approved: issuer, JWKS URL, client_id the IdP writes, targets, scope cap", "No secrets in an entry"] },
      { ...GW, x: 1560, y: 340, lines: ["Picks the JWKS by iss: the redeeming AS's", "Verifies, then forwards"] },
      { ...MCP, x: 2080, y: 340 },
      { ...PROFILE, x: 0, y: 680 },
    ],
    notes: [
      { id: "n-trust", x: 0, y: 1000, steps: [2, 3], text: "Trust comes from the Trusted IdPs registry: an admin approves the issuer, its JWKS URL, the client_id it writes and the targets. An issuer not on the list (or not for this target) is refused before any redemption." },
      { id: "n-agent", x: 0, y: -180, steps: [1], text: "scripts/id-jag/outside-agent.js runs the same flow with none of our code in its path: its IdP, then our public token endpoint, then (optionally) the gateway." },
      { id: "n-replay", x: 1560, y: 1000, steps: [5], text: "Replay is skipped: it would use up your ID-JAG. The other tests reuse your pasted token, broken one way at a time." },
    ],
    edges: [
      E("b1a", "agent", "R2", "extidp", "L2", [1], "① sign in + RFC 8693 token exchange · requested_token_type=id-jag · aud=our AS issuer"),
      E("b1p", "agent", "B2", "browser", "T2", [1], "① paste the ID-JAG (compact JWT)"),
      E("b1b", "browser", "R1", "bff", "L1", [1], "① POST /byo/inspect · { idJag, target }"),
      AMBIENT(E("bbtn", "browser", "R3", "bff", "L3", [3, 4, 5], `③–⑤ ${BUTTONS}`)),
      E("b2r", "bff", "B2", "registry", "T2", [2], "② iss on the Trusted IdPs list for this target?"),
      E("b2k", "bff", "T3", "extidp", "L3", [2], "② JWKS fetch · verify the signature", true),
      E("b3", "bff", "R3", "oauthmcp", "L1", [3], "③ RFC 7523 jwt-bearer · client_id from the registry entry (default demo-bff-mcp-client)"),
      E("b3p", "bff", "B3", "ourpf", "L1", [3], "③ or target=pingfederate · client_id ai-demo-pf-idjag-redeemer"),
      E("b3r", "oauthmcp", "B1", "registry", "R1", [3], "③ GET /trusted-idps/registry (Bearer ID_JAG_REGISTRY_TOKEN)", true),
      E("b3s", "ourpf", "L3", "registry", "R3", [3], "③ sync-id-jag-trusted-idps.js → IdP connection", true),
      E("b3k", "oauthmcp", "T2", "extidp", "B2", [3], "③ JWKS fetch · the outside IdP's keys", true),
      E("b4", "bff", "R1", "gw", "L2", [4], "④ tools/list · tools/call (Bearer our token)"),
      E("b4k", "gw", "B2", "oauthmcp", "R2", [4], "④ verify vs the issuing AS's JWKS", true),
      E("b4f", "gw", "R2", "mcp", "L2", [4], "④ forward to the tool's server"),
      E("b4r", "bff", "B1", "profile", "R1", [4], "④ GET /protected/profile"),
      E("b5", "bff", "B3", "oauthmcp", "L3", [5], "⑤ your ID-JAG, broken one way at a time (replay skipped)"),
    ],
    steps: steps([
      "Your IdP signs its user in and issues the ID-JAG (aud = our authorization server's issuer). You paste it; the BFF keeps it and shows only its decoded claims.",
      "The BFF finds the issuer on the Trusted IdPs registry (enabled, and targeting the server you picked), verifies the signature with that IdP's JWKS, and runs the draft checks.",
      "RFC 7523 JWT bearer grant at oauth-mcp (client from the registry entry) or at our PingFederate (ai-demo-pf-idjag-redeemer). oauth-mcp reads the registry from the BFF; PingFederate gets it as an IdP connection from the sync script. Either one verifies against the outside IdP's keys and mints its own token.",
      "tools/list and tools/call go to the Node MCP gateway with the token our server minted; the gateway verifies it and forwards it. The protected page takes the same token.",
      "We cannot mint at your IdP, so each test reuses your pasted ID-JAG and breaks one thing. Replay is skipped.",
    ], ["Paste an ID-JAG from your IdP", "Check it against the draft", "Redeem at our resource AS", "Call the MCP server", "Negative tests"]),
  },
};

export const PLAYGROUND_DIAGRAM_MODES = Object.keys(PLAYGROUND_DIAGRAMS);

const ends = (edges) => [...new Set(edges.flatMap((e) => [e.from, e.to]))];

/**
 * What step `step` lights up: its calls, the actors they touch and its callouts. `focus` is what the
 * view zooms to (ambient calls left out, unless the step has nothing else). Step 0 lights everything.
 */
export function stepParts(d, step) {
  if (!step) {
    const nodes = d.nodes.map((n) => n.id);
    return { edges: d.edges.map((e) => e.id), nodes, notes: d.notes.map((n) => n.id), focus: nodes };
  }
  const edges = d.edges.filter((e) => e.steps.includes(step));
  const notes = d.notes.filter((n) => n.steps.includes(step)).map((n) => n.id);
  const main = ends(edges.filter((e) => !e.ambient));
  return { edges: edges.map((e) => e.id), nodes: ends(edges), notes, focus: [...(main.length ? main : ends(edges)), ...notes] };
}
