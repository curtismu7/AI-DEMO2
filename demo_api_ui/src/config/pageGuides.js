// Route -> Guide content. Drives the shared <PageGuide /> button.
//   lessons: ids from learning/lessonCatalog.js, rendered as read-only steps.
//   body:    a lazy-loaded learning page to render as-is instead.
// Pages that ARE a learning page already (/jev-learning, /a2a-protocol-learning,
// /davinci-widget, /academy/*) are deliberately absent.
export const PAGE_GUIDES = {
  "/agent-registry": { title: "Agent Registry Guide", lessons: ["agent-landscape", "lifecycle"] },
  "/token-exchange-tester": { title: "Token Exchange Guide", lessons: ["delegation"] },
  "/pingone-mcp-inspector": { title: "MCP Inspector Guide", lessons: ["mcp"] },
  "/agent-gateway-inspector": { title: "Agent Gateway Guide", lessons: ["authorize"] },
  "/personal-agent": { title: "Personal Agent Guide", lessons: ["consumer-agent"] },
  "/audit-agent": { title: "Audit Agent Guide", lessons: ["evidence-timeline"] },
  "/use-cases/live": {
    title: "Live Use Cases Guide",
    lessons: ["customer-service-agent", "hitl-step-up", "threat-defense"],
  },
  "/intent-inspector": { title: "Intent Binding Guide", body: "intent-binding" },
};
