// demo_api_ui/src/config/davinciSdkLifecycleDiagram.js
//
// The client lifecycle on /davinci-sdk (OrchestrationSdkExplainerPage), drawn by StaticFlowDiagram with pingStyle.
// One arrow per message of LIFECYCLE_DIAGRAM (the Mermaid sequence kept in the page for export), in the same order.
// Mirrors the order of calls in davinciSdkClient.js.
const TOKEN = { dashed: true }; // pingStyle: dashed blue = a token, code or decision handed back
// The BFF sits above the page: its replies leave the bottom, the page's calls loop up the left (POST /start) and right (POST /callback).
const TOKEN_DOWN = { dashed: true, vertical: true };

// Ping palette: red = PingOne / DaVinci, dark = what the team builds, grey = the SDK library.
export const DAVINCI_LIFECYCLE_GROUPS = {
  page: { label: "Your page", bg: "#151a24" },
  sdk: { label: "davinci-client (SDK)", bg: "#5a5f69" },
  p1: { label: "PingOne / DaVinci", bg: "#b5231a" },
  bff: { label: "Your BFF", bg: "#151a24" },
};

export const DAVINCI_LIFECYCLE_NODES = [
  { id: "page", group: "page", label: "Your page", sub: ["calls the BFF, then the SDK", "renders the collectors", "writes values back with update()", "reads node.status each turn", "loops until status is success", "sends the code to the BFF"], x: 0, y: 260 },
  { id: "sdk", group: "sdk", label: "davinci-client", sub: ["davinci({ config }): async", "start({ query }): first node", "update(collector)(value)", "next(): posts the answers", "getCollectors, getClient", "holds the current node"], x: 340, y: 260 },
  { id: "p1", group: "p1", label: "PingOne / DaVinci", sub: ["GET /as/authorize (pi.flow)", "flow continue: next node", "returns node + collectors", "issues the authorization code", "POST /as/token for the BFF"], x: 680, y: 260 },
  { id: "bff", group: "bff", label: "Your BFF", sub: ["POST /start arms the nonce", "POST /callback swaps the code", "sets the HttpOnly cookie"], x: 0, y: 0 },
];

export const DAVINCI_LIFECYCLE_EDGES = [
  ["page", "bff", "POST /start", { lane: 60 }], // 0
  ["bff", "page", "clientId, redirectUri, wellknown, nonce", TOKEN_DOWN], // 1
  ["page", "sdk", "await davinci({ config }), then client.start({ query: { nonce } })"], // 2
  ["sdk", "p1", "GET /as/authorize (response_mode=pi.flow)"], // 3
  ["p1", "sdk", "node + collectors", TOKEN], // 4
  ["sdk", "page", "node.status === 'continue'", TOKEN], // 5
  ["page", "sdk", "client.update(collector)(value), then client.next()"], // 6
  ["sdk", "p1", "POST flow continue"], // 7
  ["p1", "sdk", "next node (loop until status is success)", TOKEN], // 8
  ["sdk", "page", "authorization.code", TOKEN], // 9
  ["page", "bff", "POST /callback (code + verifier)", { lane: -60 }], // 10
  ["bff", "p1", "POST /as/token"], // 11
  ["bff", "page", "HttpOnly session cookie", TOKEN_DOWN], // 12
];
