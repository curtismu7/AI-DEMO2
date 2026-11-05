// Starting layout for the Digital Worker diagram: what the demo actually does, in the order the
// movie reel shows it. Top lane = the attended run (you ask, a mock phone approves); bottom lane =
// the unattended run (the worker starts itself, the policy ceiling decides, a human approves a parked run).
// Coordinates are canvas pixels; `kind` picks a fill class in DigitalWorkerPage.css.
const box = (id, x, y, w, h, label, kind) => ({ id, position: { x, y }, style: { width: w, height: h }, type: "box", data: { label, kind } });
// Arrows are listed in the order Simulate walks them.
const arrow = (id, source, sourceHandle, target, targetHandle, label, extra = {}) => ({ id, source, sourceHandle, target, targetHandle, label, ...extra });

export const INITIAL_NODES = [
  box("lane1", 0, 0, 320, 30, "ATTENDED: you ask, a mock phone approves", "text"),
  box("cust", 0, 60, 150, 56, "Customer\nsigned in", "blue"),
  box("chat", 270, 60, 150, 56, "Browser\nRun the action", "blue"),
  box("phone", 270, 200, 150, 56, "Consent phone\nmock CIBA push", "green"),
  box("bff", 540, 60, 150, 56, "BFF\n/api/agent/invoke", "red"),
  box("p1", 530, -130, 170, 64, "PingOne\nMFA step-up, agent token", "orange"),
  box("gw", 810, 60, 150, 56, "PingGateway\ntools/call", "red"),
  box("az", 800, -130, 170, 64, "PingOne Authorize\nPERMIT or HITL hold", "orange"),
  box("ex", 800, 200, 170, 56, "Token exchange\nsub=user, act=agent", "orange"),
  box("mcp", 1080, 60, 150, 56, "MCP server\nchecks aud + act", "grey"),
  box("api", 1350, 60, 150, 56, "Vertical API\ncheckout / transfer", "purple"),
  box("lane2", 0, 380, 360, 30, "UNATTENDED: the worker starts itself", "text"),
  box("arm", 0, 430, 150, 56, "Arm + Fire job\nno human turn", "blue"),
  box("worker", 270, 430, 150, 56, "Worker agent\nits own identity", "green"),
  box("p1b", 540, 430, 170, 56, "PingOne\nclient-credentials token", "orange"),
  box("az2", 830, 430, 170, 56, "Authorize\nagent mandate ceiling", "orange"),
  box("park", 1110, 410, 150, 96, "Over the\nceiling?", "pink"),
  box("appr", 1350, 430, 150, 56, "Approve or deny\non the phone", "green"),
];

export const INITIAL_EDGES = [
  arrow("a1", "cust", "r", "chat", "l", "Click Run"),
  arrow("a2", "chat", "b", "phone", "t", "Ask / tap Approve", { bidirectional: true }),
  arrow("a3", "chat", "r", "bff", "l", "invoke"),
  arrow("a4", "bff", "t", "p1", "b", "Agent token"),
  arrow("a5", "bff", "r", "gw", "l", "tools/call"),
  arrow("a6", "gw", "t", "az", "b", "Decision / PERMIT or HITL", { bidirectional: true }),
  arrow("a7", "gw", "b", "ex", "t", "Delegate the call"),
  arrow("a8", "ex", "r", "mcp", "b", "Delegated token"),
  arrow("a9", "mcp", "r", "api", "l", "Run it"),
  arrow("u1", "arm", "r", "worker", "l", "Fire"),
  arrow("u2", "worker", "r", "p1b", "l", "Agent token"),
  arrow("u3", "p1b", "r", "az2", "l", "Spend"),
  arrow("u4", "az2", "r", "park", "l", "vs ceiling"),
  arrow("u5", "park", "r", "appr", "l", "Parked"),
  arrow("u6", "appr", "t", "api", "b", "Approved, it runs"),
];

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
