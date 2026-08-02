/**
 * diagram-token-flow-regions.js
 *
 * Region coordinate map for the token-flow sequence diagram.
 * Coordinates are PERCENTAGES (0–100), used as-is in viewBox="0 0 100 100".
 *
 * These are cosmetic highlight overlays only — they pulse a colored band over
 * the rendered token-flow.png while the simulation runs. Misalignment degrades
 * the highlight effect but does not affect simulation correctness or any
 * token/auth logic.
 *
 * SOURCE OF TRUTH for these bounds (2026-05-15): token-flow.png is rendered
 * from i4ai-ref-arch.mmd by scripts/build-diagrams.sh. The percentages below
 * were derived analytically from the rendered SVG's actor-box x-coordinates
 * (viewBox="-105 -10 5072 5103"), NOT eyeballed:
 *
 *   pctX = (svgX - (-105)) / 5072 * 100
 *
 * Each region is a tall vertical band over its participant's lifeline column
 * (yPct≈1, hPct≈98), padded ~1% each side so the band comfortably wraps the
 * column. If i4ai-ref-arch.mmd participants change, re-derive from the SVG:
 *   npx -y @mermaid-js/mermaid-cli@11 -i i4ai-ref-arch.mmd -o /tmp/tf.svg
 *   then grep the SVG for rect elements with class "actor actor-top" and
 *   read each rect's x + width attributes.
 * Recompute pctX with the formula above (read viewBox minX/width too).
 *
 * Participant → region-id map (declaration order in i4ai-ref-arch.mmd):
 *   U  User              (not highlighted)
 *   WA Web Application  → olb-application
 *   CB Chatbot          → chatbot
 *   A  Agent            → agent1
 *   LLM LLM             → llm
 *   PID PingOne         → pingone-aic   (token-exchange-box overlays the A↔PID span)
 *   AG Agent Gateway    → mcp-gateway-tf
 *   PA Ping Authorize   → pingauthorize-tf
 *   HITL HITL Service   → hitl-tf
 *   MCP MCP OLB         → mcp-olb
 *   INV MCP Resource Server → mcp-invest
 *   RS Resource Server  → oauth-rs
 */
export const TOKEN_FLOW_REGIONS = [
  {
    id: "olb-application",
    label: "Web Application",
    bounds: { xPct: 9.6, yPct: 1, wPct: 5, hPct: 98 },
    triggers: ["oauth", "session"],
    tags: [],
    keywords: ["olb", "bff", "banking app", "application", "web app"],
  },
  {
    id: "chatbot",
    label: "Chatbot (UI)",
    bounds: { xPct: 17.1, yPct: 1, wPct: 5, hPct: 98 },
    triggers: ["agent"],
    tags: ["agent/message"],
    keywords: ["chatbot", "chat", "user interface"],
  },
  {
    id: "agent1",
    label: "Agent (BFF LangGraph)",
    bounds: { xPct: 25.3, yPct: 1, wPct: 5.5, hPct: 98 },
    triggers: ["agent_prompt"],
    tags: ["agent_prompt/llm_invoke", "agent_prompt/heuristic_tool"],
    keywords: ["agent", "langgraph", "agent1"],
  },
  {
    id: "llm",
    label: "LLM (Claude)",
    bounds: { xPct: 33.2, yPct: 1, wPct: 5, hPct: 98 },
    triggers: ["agent_prompt"],
    tags: ["agent_prompt/llm_invoke", "agent_prompt/llm_complete"],
    keywords: ["llm", "claude", "anthropic", "language model"],
  },
  {
    id: "pingone-aic",
    label: "PingOne",
    bounds: { xPct: 37.9, yPct: 1, wPct: 5.4, hPct: 98 },
    triggers: ["oauth", "token_exchange", "introspection"],
    tags: [],
    keywords: ["pingone", "aic", "authorization server", "oauth as"],
  },
  {
    id: "token-exchange-box",
    label: "RFC 8693 Token Exchange",
    bounds: { xPct: 25.3, yPct: 1, wPct: 18, hPct: 98 },
    triggers: ["token_exchange"],
    tags: ["token_exchange/rfc8693-success", "token_exchange/rfc8693-error"],
    keywords: ["token exchange", "rfc 8693", "rfc8693", "delegation"],
  },
  {
    id: "mcp-gateway-tf",
    label: "Agent Gateway",
    bounds: { xPct: 51.8, yPct: 1, wPct: 5, hPct: 98 },
    triggers: ["mcp", "token_exchange"],
    tags: [],
    keywords: ["mcp gateway", "gateway", "mcp gw", "agent gateway"],
  },
  {
    id: "pingauthorize-tf",
    label: "PingOne Authorization Server",
    bounds: { xPct: 63.7, yPct: 1, wPct: 5, hPct: 98 },
    triggers: ["authorize"],
    tags: [],
    keywords: ["pingauthorize", "authorize", "policy", "permit", "deny"],
  },
  {
    id: "hitl-tf",
    label: "HITL Service",
    bounds: { xPct: 67.7, yPct: 1, wPct: 7, hPct: 98 },
    triggers: ["hitl"],
    tags: [],
    keywords: ["hitl", "consent", "human approval", "out-of-band", "challenge"],
  },
  {
    id: "mcp-olb",
    label: "MCP OLB Server",
    bounds: { xPct: 73.7, yPct: 1, wPct: 6.7, hPct: 98 },
    triggers: ["mcp", "agent_prompt"],
    tags: ["agent_prompt/heuristic_tool"],
    keywords: ["mcp olb", "olb server", "mcp server"],
  },
  {
    id: "mcp-invest",
    label: "MCP Resource Server",
    bounds: { xPct: 80.8, yPct: 1, wPct: 6.8, hPct: 98 },
    triggers: ["mcp", "agent_prompt"],
    tags: ["agent_prompt/heuristic_tool"],
    keywords: ["mcp invest", "invest server", "investments"],
  },
  {
    id: "oauth-rs",
    label: "Resource Server / Demo API",
    bounds: { xPct: 89, yPct: 1, wPct: 6.1, hPct: 98 },
    triggers: ["agent_prompt"],
    tags: ["agent_prompt/heuristic_tool"],
    keywords: ["resource server", "demo api", "oauth rs", "rs"],
  },
];
