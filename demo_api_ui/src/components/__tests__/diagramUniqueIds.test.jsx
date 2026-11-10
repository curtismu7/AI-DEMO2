// Two React Flow diagrams on one page must not share a DOM id. React Flow's own accessibility nodes
// (react-flow__node-desc-<id>, react-flow__edge-desc-<id>, react-flow__aria-live-<id>), its dot-grid <pattern>, and the
// arrowhead <marker> each diagram draws are id'd from the `id` prop (default "1") or from a fixed string, so every
// second diagram on a page repeated them: duplicate ids in the accessibility tree, and the second diagram's arrows
// pointing at the first one's marker. Every diagram now gets a per-instance id (components/diagram/UniqueReactFlow).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivilegeFirstGatewayPage from "../PrivilegeFirstGatewayPage";
import StaticFlowDiagram from "../StaticFlowDiagram";
import PingSlideFlow from "../PingSlideFlow";
import { SystemFlowMapView } from "../SystemFlowMap";
import { TOPOLOGY_SLIDE } from "../../config/pingSlideDiagrams";

class ResizeObserverStub {
  constructor(cb) { this.cb = cb; }
  observe(target) { this.cb([{ target, contentRect: { width: 250, height: 40 } }]); }
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class {};

const GROUPS = { a: { label: "App", bg: "#151a24" } };
const NODES = [
  { id: "x", group: "a", label: "X", x: 0, y: 0 },
  { id: "y", group: "a", label: "Y", x: 300, y: 0 },
];
const EDGES = [["x", "y", "go"]];

// document-wide, since React Flow renders some nodes and markers outside the diagram's own container
const duplicateIds = () => {
  const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
};
// every url(#x) / url('#x') an element points at must exist exactly once
const danglingRefs = () => {
  const present = new Set([...document.querySelectorAll("[id]")].map((e) => e.id));
  const out = [];
  for (const el of document.querySelectorAll("[marker-end],[marker-start]")) {
    for (const a of ["marker-end", "marker-start"]) {
      const m = /url\(['"]?#([^'")]+)['"]?\)/.exec(el.getAttribute(a) || "");
      if (m && !present.has(m[1])) out.push(m[1]);
    }
  }
  return out;
};

describe("ReactFlow diagrams give every instance its own ids", () => {
  it("two StaticFlowDiagrams on one page share no id", () => {
    render(
      <>
        <StaticFlowDiagram NODES={NODES} EDGES={EDGES} GROUPS={GROUPS} testId="one" />
        <StaticFlowDiagram NODES={NODES} EDGES={EDGES} GROUPS={GROUPS} testId="two" />
      </>,
    );
    expect(duplicateIds()).toEqual([]);
    expect(danglingRefs()).toEqual([]);
  });

  it("two PingSlideFlows on one page share no id", () => {
    render(
      <>
        <PingSlideFlow config={TOPOLOGY_SLIDE} />
        <PingSlideFlow config={TOPOLOGY_SLIDE} />
      </>,
    );
    expect(duplicateIds()).toEqual([]);
    expect(danglingRefs()).toEqual([]);
  });

  it("two SystemFlowMaps on one page share no id", () => {
    render(
      <>
        <SystemFlowMapView />
        <SystemFlowMapView />
      </>,
    );
    expect(duplicateIds()).toEqual([]);
    expect(danglingRefs()).toEqual([]);
  });

  it("the Privilege-first gateway page, which draws two diagrams, has no duplicate id", () => {
    render(<MemoryRouter><PrivilegeFirstGatewayPage /></MemoryRouter>);
    expect(duplicateIds()).toEqual([]);
    expect(danglingRefs()).toEqual([]);
  });
});

describe("a page with two diagrams does not get two primary Simulate buttons", () => {
  it("PrivilegeFirstGatewayPage: two bars, both secondary (data-multi) and told apart by toolbar name", () => {
    const { container } = render(<MemoryRouter><PrivilegeFirstGatewayPage /></MemoryRouter>);
    const bars = [...container.querySelectorAll(".dstep-bar")];
    expect(bars).toHaveLength(2);
    expect(bars.every((b) => b.getAttribute("data-multi") === "true")).toBe(true);
    expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual(["Diagram 1 controls", "Diagram 2 controls"]);
  });
});

describe("the shared wrapper is the only way in", () => {
  const SRC = resolve(__dirname, "..", "..");
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "__tests__" && name !== "node_modules") walk(p); }
      else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) files.push(p);
    }
  };
  walk(SRC);

  it("no source file imports ReactFlow straight from @xyflow/react (use components/diagram/UniqueReactFlow)", () => {
    const offenders = files.filter((f) => {
      if (f.endsWith(join("diagram", "UniqueReactFlow.jsx"))) return false;
      const src = readFileSync(f, "utf8");
      return [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@xyflow\/react['"]/g)].some((m) => /(^|[\s,])ReactFlow(\s*,|\s*$|\s+as\b)/.test(m[1]));
    });
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it("no ReactFlow diagram draws a marker or url(#...) with a fixed id", () => {
    const fixed = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/UniqueReactFlow/.test(src)) continue;
      for (const m of src.matchAll(/<marker[^>]*\sid="([^"{]+)"/g)) fixed.push(`${f.slice(SRC.length + 1)}: ${m[1]}`);
      for (const m of src.matchAll(/url\(#([A-Za-z][\w-]*)\)/g)) fixed.push(`${f.slice(SRC.length + 1)}: url(#${m[1]})`);
    }
    expect(fixed).toEqual([]);
  });
});
