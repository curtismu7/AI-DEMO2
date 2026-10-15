// Starting layout for the Digital Worker diagram (traced from the Lucid original).
// Coordinates are canvas pixels; `kind` picks a fill class in DigitalWorkerPage.css.
const box = (id, x, y, w, h, label, kind, data = {}) => ({
  id, type: "box", position: { x, y }, style: { width: w, height: h }, data: { label, kind, ...data },
});
const zone = (id, x, y, w, h, label, kind, data = {}) => ({
  id, type: "zone", position: { x, y }, style: { width: w, height: h }, zIndex: -1, data: { label, kind, ...data },
});

export const INITIAL_NODES = [
  zone("shadow", 442, 528, 220, 225, "Shadow IT", "shadow"),
  zone("mcpzone", 988, 477, 714, 355, "MCP", "mcp", { bottom: true }),

  box("user", 82, 488, 80, 60, "User", "blue"),
  box("ping", 292, 465, 80, 28, "Ping Session", "note"),
  box("olb", 262, 494, 140, 50, "OLB\nApplication", "blue"),
  box("chatbot", 262, 545, 140, 44, "chatbot", "blue"),
  box("humantok", 152, 552, 100, 138, "Human token:\nsub: user1\naud: agent1.bxf.com\nscope: agent1\nacr: Single_Factor\nmay_act: agent1", "note"),
  box("agent1", 512, 539, 80, 60, "agent1", "green"),
  box("llm", 512, 685, 80, 60, "LLM", "green"),
  box("agenttok", 632, 433, 135, 90, "Agent token:\nclient_id: agent1\naud: agent1.bxf.com", "note"),
  box("txtok", 822, 418, 110, 122, "TX Token:\nsub: user1\naud: .bxf.com\nscope: mcp\nact: agent1\nacr: Single_Factor\ntransaction details", "note"),

  box("ats", 602, 223, 330, 60, "Agentic Token Service", "red"),
  box("introspect", 932, 223, 30, 60, "Introspect", "orange", { vertical: true }),
  box("orch", 602, 283, 130, 30, "Orchestration", "orange"),
  box("agentsvc", 732, 283, 70, 30, "Agent", "orange"),
  box("tokexc", 802, 283, 70, 30, "Token Exc", "orange"),
  box("clientcred", 872, 283, 90, 30, "Client Cred", "orange"),

  box("authz", 1122, 223, 80, 60, "Authorization", "red"),
  box("gov", 1552, 223, 80, 60, "Governance", "dgreen"),
  box("azure", 1511, 53, 82, 58, "Azure", "lgreen"),
  box("aws", 1431, 133, 82, 60, "AWS", "lgreen"),
  box("google", 1622, 123, 80, 60, "Google", "lgreen"),
  box("govnote", 1718, 226, 260, 40, "Check for the act . sub claim\nP1AZ is in control of all …", "text"),

  box("diamond", 662, 737, 180, 125, "Control problem:\nMCP access governance\n\nor Downstream token\nmediation?", "pink"),
  box("aigw", 1042, 893, 160, 70, "AI Gateway", "red"),

  box("agentgw", 1011, 538, 160, 242, "Agent Gateway", "red"),
  box("route1", 1021, 549, 130, 60, "Route:\nhttps://mcp-olb.bxf.com/mcp", "white"),
  box("route2", 1021, 711, 140, 60, "Route:\nhttps://mcp-invest.bxf.com/mcp", "white"),
  box("mcpolb", 1254, 538, 80, 60, "MCP", "grey"),
  box("mcpolbname", 1244, 600, 110, 18, "mcp-olb.bxf.com", "text"),
  box("rs", 1490, 538, 80, 60, "RS", "purple"),
  box("mcpinv", 1254, 709, 80, 60, "MCP", "grey"),
  box("mcpinvname", 1234, 770, 120, 18, "mcp-invest.bxf.com", "text"),
  box("api", 1490, 709, 80, 60, "API", "purple"),
  box("olbtok", 1172, 383, 110, 58, "Token:\nclient_id: mcp-olb\naud: mcp-olb.bxf.com", "note"),
  box("olbtok2", 1352, 598, 128, 110, "Token:\nsub: user1\naud:\nolb-resource.bxf.com\nscope: balance\ntransfer\nact: agent1", "note"),
  box("olbres", 1474, 488, 200, 56, "aud: olb-resource.bxf.com\n/balance - scope: balance\n/transfer - scope: transfer", "text"),
  box("invres", 1492, 653, 200, 56, "investments-resource.bxf.com\n/balance\nAPI key: 12345", "text"),
];

// [id, source, sourceHandle, target, targetHandle, label, options]. Handle ids: t r b l.
const edge = (id, source, sourceHandle, target, targetHandle, label = "", extra = {}) => ({
  id, source, sourceHandle, target, targetHandle, label, ...extra,
});
const BOTH = { bidirectional: true };

export const INITIAL_EDGES = [
  edge("e1", "user", "r", "olb", "l", "User request"),
  edge("e2", "olb", "t", "ats", "l", "User Authentication"),
  edge("e3", "chatbot", "r", "agent1", "l", "Request"),
  edge("e4", "agent1", "t", "agentsvc", "b", "Request token"),
  edge("e5", "agent1", "t", "tokexc", "b", "Request"),
  edge("e6", "agent1", "b", "llm", "t", "", BOTH),
  edge("e7", "llm", "r", "diamond", "t", "JSON-RPC request"),
  edge("e8", "agent1", "r", "agentgw", "l", "JSON-RPC request"),
  edge("e9", "diamond", "r", "agentgw", "l", "Token Mediation", BOTH),
  edge("e10", "diamond", "b", "aigw", "l", "Access Governance", BOTH),
  edge("e11", "agentgw", "r", "mcpolb", "l", "Forward tool call"),
  edge("e12", "mcpolb", "r", "rs", "l", "Request"),
  edge("e13", "route2", "r", "mcpinv", "l", "Request"),
  edge("e14", "mcpinv", "r", "api", "l", "API key (via vault)"),
  edge("e15", "mcpolb", "t", "clientcred", "r", "Request"),
  edge("e16", "agentgw", "t", "authz", "b", "Authorization check"),
  edge("e17", "authz", "l", "introspect", "r", "Introspect token"),
  edge("e18", "gov", "l", "authz", "r", "Read Agent Meta-Data", { accent: true }),
  edge("e19", "gov", "t", "azure", "b"),
  edge("e20", "gov", "t", "aws", "r"),
  edge("e21", "gov", "t", "google", "l"),
  edge("e22", "aigw", "r", "mcpolb", "b", "MCP Client - MCP Server"),
];

// What counts as an edit for Undo: everything except selection, drag flags and measured sizes.
export const diagramSignature = (nodes, edges) => JSON.stringify([
  nodes.map((n) => [n.id, n.position.x, n.position.y, n.width, n.height, n.style?.width, n.style?.height, n.data?.label]),
  edges.map((e) => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle, e.label]),
]);

// Validates a file saved by "Download JSON". Throws an Error whose message is shown to the user.
export function parseDiagram(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error("That file is not valid JSON."); }
  if (!Array.isArray(d?.nodes) || !Array.isArray(d?.edges)) throw new Error("Expected a diagram file with nodes and edges.");
  const ids = new Set();
  for (const n of d.nodes) {
    if (!n?.id || typeof n.position?.x !== "number" || typeof n.position?.y !== "number" || !["box", "zone"].includes(n.type)) {
      throw new Error("A box in the file is missing an id, position or type.");
    }
    ids.add(n.id);
  }
  for (const e of d.edges) {
    if (!ids.has(e?.source) || !ids.has(e?.target)) throw new Error("An arrow in the file points at a box that is not in the file.");
  }
  return { nodes: d.nodes, edges: d.edges };
}
