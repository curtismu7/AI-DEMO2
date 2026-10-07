import { expect } from "vitest";
import { parseFlowchart } from "../parseFlowchart";
import { parseSequence } from "../parseSequence";

/**
 * Asserts that Mermaid-format diagram text is something FlowDiagram can draw: it parses to at
 * least one edge/message, every edge endpoint is a declared node or group, and no line was
 * silently dropped as an edge it could not read. Replaces the old mermaid.parse() guards.
 */
export function expectDrawable(source) {
  if (/^\s*(?:---[\s\S]*?\n---\s*)?(?:%%[^\n]*\n\s*)*sequenceDiagram\b/.test(source)) {
    const m = parseSequence(source);
    const messages = m.items.filter((i) => i.type === "message");
    expect(messages.length).toBeGreaterThan(0);
    const ids = new Set(m.participants.map((p) => p.id));
    expect(messages.every((x) => ids.has(x.from) && ids.has(x.to))).toBe(true);
    return m;
  }
  const m = parseFlowchart(source);
  expect(m.edges.length).toBeGreaterThan(0);
  const ids = new Set([...m.nodes.map((n) => n.id), ...m.groups.map((g) => g.id)]);
  expect(m.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  // Each source line that contains an arrow produced at least one edge.
  const arrowLines = source.split("\n").filter((l) => /(-->|-\.->|==>|\s---\s|-\.-)/.test(l) && !l.trim().startsWith("%%") && !/^\s*(style|classDef|linkStyle)\b/.test(l));
  expect(m.edges.length).toBeGreaterThanOrEqual(arrowLines.length);
  return m;
}
