// Demo Map: the agent demos and the Ping products, one row each, with the AI-DEMO2 pages that show them.
// The standalone twin (demo-map-LAB) uses the same rows and adds the standalone apps from the demo shelf.
// Every path must be a real route in App.js (DemoMapPage.test.jsx checks it).
export const DEMO_MAP_ROWS = [
  {
    id: "personal-agent",
    title: "Personal Agent demo",
    summary: "A person's own agent asks first, gets a 401, sends the person to sign in, then acts on their behalf.",
    pages: [
      { label: "Personal Agent page", path: "/personal-agent" },
      { label: "Muse", path: "/personal-agent/muse" },
      { label: "Request flow diagram", path: "/personal-agent-flow" },
      { label: "Dot workbench", path: "/personal-agent/dot" },
      { label: "Poppy protocol", path: "/poppy" },
    ],
  },
  {
    id: "digital-worker",
    title: "Digital Worker agent",
    summary: "An autonomous worker holds its own delegated identity, spends it across tools, and every action is governed.",
    pages: [
      { label: "Digital Worker", path: "/digital-worker" },
      { label: "Authorization flow", path: "/authorization-flow" },
      { label: "Workload agents", path: "/workload-agents" },
      { label: "Embedded worker", path: "/embedded-worker" },
    ],
  },
  {
    id: "pingone",
    title: "PingOne",
    summary: "Sign-in, MFA, DaVinci flows and the platform configuration the demos run on.",
    pages: [
      { label: "Platform configuration", path: "/pingone-platform-config" },
      { label: "DaVinci orchestration SDK", path: "/davinci-orchestration-sdk" },
      { label: "Verify and Recognize", path: "/ping-products/verify-recognize" },
      { label: "Session lab", path: "/session-lab" },
    ],
  },
  {
    id: "pingfederate",
    title: "PingFederate",
    summary: "Token exchange, ID-JAG, CIMD and DPoP for agents, on PingFederate.",
    pages: [
      { label: "PingFederate for AI agents", path: "/pingfederate-ai-agent" },
      { label: "How ID-JAG works", path: "/pingfederate-id-jag" },
      { label: "ID-JAG playground", path: "/pingfederate-id-jag/playground" },
      { label: "ID-JAG runner lab", path: "/pingfederate-id-jag/runner" },
      { label: "PingFederate token demo", path: "/privilege-pf-token" },
      { label: "DaVinci integration kit", path: "/pingfederate-davinci-kit" },
    ],
  },
  {
    id: "pinggateway",
    title: "PingGateway",
    summary: "Routes, claims and the agent-aware gateway in front of MCP servers and APIs.",
    pages: [
      { label: "PingGateway routes", path: "/pinggateway-routes" },
      { label: "Agent gateway inspector", path: "/agent-gateway-inspector" },
      { label: "Scope topology and MCP gateway", path: "/mcp-scope-topology" },
    ],
  },
  {
    id: "privilege",
    title: "PingOne Privilege",
    summary: "Agent identity, keys, guardrails and the Privilege gateway that every agent call goes through.",
    pages: [
      { label: "Privilege shelf", path: "/privilege-shelf" },
      { label: "Privilege map", path: "/privilege-map" },
      { label: "Gateway topologies", path: "/privilege-gateway-topologies" },
      { label: "Gateway stats", path: "/gateway-stats" },
      { label: "External agent app diagrams", path: "/external-door-diagrams" },
      { label: "Docs index", path: "/privilege-docs-index" },
    ],
  },
  {
    id: "authorize",
    title: "PingOne Authorize",
    summary: "Policy decisions for agents: who may call which tool, with what limits.",
    pages: [
      { label: "Authorize configuration", path: "/pingone-authorize-config" },
      { label: "Authorize inspector", path: "/pingone-authorize" },
      { label: "Authorize product page", path: "/ai-products/authorize" },
    ],
  },
];
