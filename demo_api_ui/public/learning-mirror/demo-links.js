// Phase 0: "Run it in the demo" card for every static Learning Hub mirror page.
// Each topic page sets data-demo-topic="<slug>" on <body> and loads this file; the
// slug keys into TOPIC_ROUTES and this script injects one card above the footer.
// The demo route list mirrors demo_api_ui/src/App.js; learningMirrorDemoLinks.test.js
// enforces that every topic page carries the attribute and the include.
(function () {
  var TOPIC_ROUTES = {
    "actor-token-agent": "/workload-agents?useCase=UC44",
    "agent-builder-landscape": "/agent-builder",
    "agent-gateway": "/agent-gateway-inspector",
    "agent-guardrails": "/agent-guardrails",
    "agent-kill-switch": "/agent-lifecycle",
    "agent-onboarding-flow": "/agent-onboarding-flow",
    "agent-onboarding-flow-compact": "/agent-onboarding-flow",
    "agent-tech-comparison": "/langchain",
    "agentic-maturity-model": "/use-cases",
    "ai-platform-landscape": "/use-cases",
    "ai-primer": "/use-cases",
    "ai-specialist-program": "/use-cases",
    "architecture": "/architecture/overview",
    "architecture-diagram": "/architecture/overview",
    "auth-code-pkce": "/resource-server",
    "authzen": "/pingone-authorize",
    "best-practices": "/owasp",
    "ciba-oob": "/use-cases/live",
    "computer-use-agent-cua": "/personal-agent",
    "gateway-vs-p1az-decision-split": "/gateway-enforcement-map",
    "glean-pingone": "/use-cases",
    "human-in-the-loop": "/use-cases/live",
    "id-jag-cross-app-access": "/demo/enterprise-mcp",
    "ietf-standards-agentic": "/use-cases",
    "intent-auth-standards": "/use-cases/live",
    "introspection-rfc-7662": "/use-cases/live",
    "jwt-client-auth-rfc-7523": "/learning-lab/jwt-client-auth",
    "langchain-lcel-langgraph": "/langchain",
    "llm-landscape": "/llm-gateway",
    "machine-iam-for-agentic-ai": "/agent-lifecycle",
    "may-act-act-claims": "/token-exchange-tester",
    "mcp-elicitation": "/mcp-inspector",
    "mcp-mfa-gate-on-tools": "/workload-agents?useCase=UC38",
    "mcp-protocol": "/mcp-inspector",
    "mcp-server-discovery": "/mcp-inspector",
    "oauth-cimd": "/agent-builder",
    "par-rfc-9126": "/use-cases/live",
    "ping-agent-gateway-security": "/agent-gateway-inspector",
    "pingone-authorize": "/pingone-authorize",
    "pingone-mcp-tools": "/mcp-tools",
    "pkce-deep-dive": "/resource-server",
    "rar-rfc-9396": "/use-cases/live",
    "rfc-spec-index": "/use-cases",
    "sensitive-data-disclosure": "/llm-gateway",
    "server-capabilities": "/servers",
    "spiffe-svid-workload-identity": "/spiffe-pingone-bridge",
    "step-up-mfa": "/use-cases/live",
    "token-chain-edu": "/token-exchange-tester",
    "token-exchange-rfc-8693": "/token-exchange-tester",
    "vector-search-rag-weaviate": "/code-search",
  };

  var topic = document.body.getAttribute("data-demo-topic");
  var route = topic && TOPIC_ROUTES[topic];
  if (!route) return;

  var style = document.createElement("style");
  style.textContent =
    ".run-it-in-the-demo{max-width:920px;margin:26px auto 0;padding:14px 18px;border:1px solid #ddd5fb;" +
    "border-left:4px solid #6b46ff;border-radius:10px;background:#f0eefb;display:flex;flex-wrap:wrap;" +
    "gap:10px 16px;align-items:center;justify-content:space-between;font-size:.95rem}" +
    ".run-it-in-the-demo .rid-label{font-weight:600;color:#3f3a55}" +
    ".run-it-in-the-demo .rid-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;color:#5a6271;display:block;margin-top:2px}" +
    ".run-it-in-the-demo a.rid-btn{white-space:nowrap;background:#6b46ff;color:#fff;text-decoration:none;" +
    "border-radius:999px;padding:8px 18px;font-weight:600}" +
    ".run-it-in-the-demo a.rid-btn:hover{background:#5938d9}";
  document.head.appendChild(style);

  var card = document.createElement("div");
  card.className = "run-it-in-the-demo";
  card.innerHTML =
    '<span class="rid-label">This concept runs live in the demo.' +
    '<code class="rid-code">' + route + "</code></span>" +
    '<a class="rid-btn" href="' + route + '">Run it in the demo &rarr;</a>';

  var foot = document.querySelector(".snap-foot");
  if (foot && foot.parentNode) foot.parentNode.insertBefore(card, foot);
  else document.body.appendChild(card);
})();
