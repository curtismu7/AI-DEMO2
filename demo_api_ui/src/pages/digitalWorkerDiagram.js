// Starting layout for the Digital Worker diagram, imported from the Lucid "V2 Agent - GW/Authorize" page
// with scripts/lucid-vsdx-to-diagram.py (see its docstring to re-import after Lucid edits).
// Coordinates are canvas pixels; `kind` picks a fill class in DigitalWorkerPage.css.
export const INITIAL_NODES = [
  {"id": "n24", "position": {"x": 1125, "y": 344}, "style": {"width": 248, "height": 252}, "type": "box", "data": {"label": "Shadow IT", "kind": "red"}},
  {"id": "n26", "position": {"x": 1740, "y": 286}, "style": {"width": 802, "height": 398}, "type": "box", "data": {"label": "", "kind": "note"}},
  {"id": "n28", "position": {"x": 1204, "y": 355}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "agent1", "kind": "green"}},
  {"id": "n30", "position": {"x": 2304, "y": 547}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "API", "kind": "purple"}},
  {"id": "n32", "position": {"x": 922, "y": 305}, "style": {"width": 158, "height": 57}, "type": "box", "data": {"label": "OLB\nApplication", "kind": "blue"}},
  {"id": "n34", "position": {"x": 2304, "y": 355}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "RS", "kind": "purple"}},
  {"id": "n36", "position": {"x": 2304, "y": 484}, "style": {"width": 186, "height": 57}, "type": "box", "data": {"label": "investments-resource.bxf.com\n/balance\nAPI key: 12345", "kind": "text"}},
  {"id": "n38", "position": {"x": 2284, "y": 298}, "style": {"width": 162, "height": 57}, "type": "box", "data": {"label": "aud: olb-resource.bxf.com\n/balance - scope: balance\n/transfer - scope: transfer", "kind": "text"}},
  {"id": "n40", "position": {"x": 1305, "y": 0}, "style": {"width": 371, "height": 68}, "type": "box", "data": {"label": "Agentic Token Service", "kind": "red"}},
  {"id": "n43", "position": {"x": 956, "y": 272}, "style": {"width": 90, "height": 32}, "type": "box", "data": {"label": "Ping Session", "kind": "note"}},
  {"id": "n45", "position": {"x": 922, "y": 363}, "style": {"width": 158, "height": 49}, "type": "box", "data": {"label": "chatbot", "kind": "blue"}},
  {"id": "n50", "position": {"x": 2039, "y": 547}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "MCP", "kind": "grey"}},
  {"id": "n52", "position": {"x": 2023, "y": 614}, "style": {"width": 123, "height": 21}, "type": "box", "data": {"label": "mcp-invest.bxf.com", "kind": "text"}},
  {"id": "n55", "position": {"x": 1890, "y": 0}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "Authorization", "kind": "red"}},
  {"id": "n59", "position": {"x": 799, "y": 371}, "style": {"width": 112, "height": 156}, "type": "box", "data": {"label": "Human token:\nsub: user1\naud: agent1.bxf.com\nscope: agent1\nacr: Single_Factor\nmay_act: agent1", "kind": "note"}},
  {"id": "n63", "position": {"x": 1530, "y": 68}, "style": {"width": 79, "height": 34}, "type": "box", "data": {"label": "Token Exc", "kind": "orange"}},
  {"id": "n65", "position": {"x": 1676, "y": 0}, "style": {"width": 34, "height": 68}, "type": "box", "data": {"label": "Introspect", "kind": "orange", "vertical": true}},
  {"id": "n68", "position": {"x": 1339, "y": 237}, "style": {"width": 136, "height": 101}, "type": "box", "data": {"label": "Agent token:\nclient_id: agent1\naud: agent1.bxf.com", "kind": "note"}},
  {"id": "n70", "position": {"x": 1553, "y": 219}, "style": {"width": 123, "height": 138}, "type": "box", "data": {"label": "TX Token:\nsub: user1\naud: .bxf.com\nscope: mcp\nact: agent1\nacr: Single_Factor\ntransaction details", "kind": "note"}},
  {"id": "n72", "position": {"x": 1609, "y": 68}, "style": {"width": 101, "height": 34}, "type": "box", "data": {"label": "Client Cred", "kind": "orange"}},
  {"id": "n74", "position": {"x": 2031, "y": 423}, "style": {"width": 106, "height": 21}, "type": "box", "data": {"label": "mcp-olb.bxf.com", "kind": "text"}},
  {"id": "n76", "position": {"x": 2039, "y": 355}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "MCP", "kind": "grey"}},
  {"id": "n78", "position": {"x": 1766, "y": 354}, "style": {"width": 180, "height": 273}, "type": "box", "data": {"label": "Agent Gateway", "kind": "red"}},
  {"id": "n82", "position": {"x": 1777, "y": 367}, "style": {"width": 146, "height": 68}, "type": "box", "data": {"label": "Route:\nhttps://mcp-olb.bxf.com/mcp", "kind": "white"}},
  {"id": "n84", "position": {"x": 1777, "y": 549}, "style": {"width": 158, "height": 68}, "type": "box", "data": {"label": "Route:\nhttps://mcp-invest.bxf.com/mcp", "kind": "white"}},
  {"id": "n87", "position": {"x": 720, "y": 298}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "User", "kind": "blue"}},
  {"id": "n92", "position": {"x": 2149, "y": 423}, "style": {"width": 143, "height": 76}, "type": "box", "data": {"label": "Token:\nsub: user1\naud: olb-resource.bxf.com\nscope: balance transfer\nact: agent1", "kind": "note"}},
  {"id": "n94", "position": {"x": 2123, "y": 664}, "style": {"width": 34, "height": 21}, "type": "box", "data": {"label": "MCP", "kind": "text"}},
  {"id": "n96", "position": {"x": 1204, "y": 519}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "LLM", "kind": "green"}},
  {"id": "n98", "position": {"x": 1451, "y": 68}, "style": {"width": 79, "height": 34}, "type": "box", "data": {"label": "Agent", "kind": "orange"}},
  {"id": "n153", "position": {"x": 1800, "y": 754}, "style": {"width": 180, "height": 79}, "type": "box", "data": {"label": "AI Gateway", "kind": "red"}},
  {"id": "n156", "position": {"x": 1372, "y": 578}, "style": {"width": 202, "height": 142}, "type": "box", "data": {"label": "Control problem:\nMCP access governance\n\nor Downstream token mediation?", "kind": "pink"}},
  {"id": "n163", "position": {"x": 1305, "y": 68}, "style": {"width": 146, "height": 34}, "type": "box", "data": {"label": "Orchrestration", "kind": "orange"}},
  {"id": "n169", "position": {"x": 1946, "y": 180}, "style": {"width": 123, "height": 66}, "type": "box", "data": {"label": "Token:\nclient_id: mcp-olb\naud: mcp-olb.bxf.com", "kind": "note"}},
  {"id": "n172", "position": {"x": 2575, "y": 871}, "style": {"width": 371, "height": 40}, "type": "box", "data": {"label": "Check for the act.sub claim to determine what called the API\nP1AZ is in control of all data requests \\ responses", "kind": "text"}},
  {"id": "n174", "position": {"x": 2373, "y": 877}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "Governance", "kind": "dgreen"}},
  {"id": "n176", "position": {"x": 2328, "y": 686}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "Azure", "kind": "lgreen"}},
  {"id": "n178", "position": {"x": 2238, "y": 776}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "AWS", "kind": "lgreen"}},
  {"id": "n180", "position": {"x": 2452, "y": 765}, "style": {"width": 90, "height": 68}, "type": "box", "data": {"label": "Google", "kind": "lgreen"}},
];

// Handle ids: t r b l. `bidirectional` draws an arrowhead at both ends; `accent` draws the arrow red.
export const INITIAL_EDGES = [
  {"id": "e42", "source": "n43", "sourceHandle": "t", "target": "n40", "targetHandle": "b", "label": "User Authentication", "bidirectional": true},
  {"id": "e47", "source": "n45", "sourceHandle": "r", "target": "n28", "targetHandle": "l", "label": "Request"},
  {"id": "e48", "source": "n76", "sourceHandle": "r", "target": "n34", "targetHandle": "l", "label": "Request"},
  {"id": "e49", "source": "n50", "sourceHandle": "r", "target": "n30", "targetHandle": "l", "label": "API key (via vault)"},
  {"id": "e54", "source": "n78", "sourceHandle": "r", "target": "n50", "targetHandle": "l", "label": "Request"},
  {"id": "e57", "source": "n28", "sourceHandle": "r", "target": "n78", "targetHandle": "l", "label": "JSON-RPC request"},
  {"id": "e58", "source": "n28", "sourceHandle": "b", "target": "n96", "targetHandle": "t", "label": "", "bidirectional": true},
  {"id": "e61", "source": "n28", "sourceHandle": "b", "target": "n156", "targetHandle": "t", "label": "JSON-RPC request"},
  {"id": "e62", "source": "n28", "sourceHandle": "t", "target": "n63", "targetHandle": "b", "label": "Request token"},
  {"id": "e67", "source": "n28", "sourceHandle": "t", "target": "n98", "targetHandle": "b", "label": "Request"},
  {"id": "e80", "source": "n78", "sourceHandle": "r", "target": "n76", "targetHandle": "l", "label": "Forward tool call"},
  {"id": "e81", "source": "n78", "sourceHandle": "t", "target": "n55", "targetHandle": "b", "label": "Authorization check"},
  {"id": "e86", "source": "n55", "sourceHandle": "l", "target": "n65", "targetHandle": "r", "label": "Introspect token"},
  {"id": "e89", "source": "n87", "sourceHandle": "r", "target": "n32", "targetHandle": "l", "label": "User request"},
  {"id": "e90", "source": "n76", "sourceHandle": "l", "target": "n63", "targetHandle": "r", "label": "Request"},
  {"id": "e91", "source": "n76", "sourceHandle": "l", "target": "n72", "targetHandle": "r", "label": "Request"},
  {"id": "e155", "source": "n153", "sourceHandle": "t", "target": "n76", "targetHandle": "b", "label": "MCP Client - MCP Server", "bidirectional": true},
  {"id": "e158", "source": "n156", "sourceHandle": "r", "target": "n153", "targetHandle": "l", "label": "Access Governance", "bidirectional": true},
  {"id": "e159", "source": "n156", "sourceHandle": "r", "target": "n78", "targetHandle": "l", "label": "Token Mediation", "bidirectional": true},
  {"id": "e171", "source": "n153", "sourceHandle": "r", "target": "n174", "targetHandle": "l", "label": "Read Agent Meta-Data", "bidirectional": true, "accent": true},
  {"id": "e182", "source": "n174", "sourceHandle": "t", "target": "n176", "targetHandle": "b", "label": "", "bidirectional": true},
  {"id": "e183", "source": "n174", "sourceHandle": "t", "target": "n180", "targetHandle": "b", "label": ""},
  {"id": "e184", "source": "n174", "sourceHandle": "l", "target": "n178", "targetHandle": "r", "label": ""},
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
