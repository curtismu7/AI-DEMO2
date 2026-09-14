// Every lane the trace store can emit must have a colour in the diagram's
// stylesheet. A lane without one does not fail loudly — `--srd-lane` falls back
// to muted grey, so the hop renders as a plain grey line that reads as "nothing
// happened" regardless of how the step actually resolved. That is how
// HEURISTICS, AIRLINES, INVEST and MORTGAGE all shipped grey.
//
// Static-source rather than a render: the mismatch is between two files, and
// reproducing it through a mounted component would need a fixture per lane.
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
const TRACE = read("../../services/tokenChainTrace/buildTraceSteps.js");
const CSS = read("../SequenceReelDiagram.css");

function emittedLanes() {
  const start = TRACE.indexOf("const LANES = {");
  const block = TRACE.slice(start, TRACE.indexOf("};", start));
  const lanes = new Set();
  for (const m of block.matchAll(/["']([A-Z_]+)["']/g)) lanes.add(m[1]);
  // Lanes reassigned after the map lookup — heuristic runs and the per-vertical
  // resource lanes never appear in LANES.
  for (const m of TRACE.matchAll(/lane\s*[:=]\s*["']([A-Z_]+)["']/g)) lanes.add(m[1]);
  return [...lanes].sort();
}

describe("SequenceReelDiagram lane colours", () => {
  it("finds the lanes to check", () => {
    const lanes = emittedLanes();
    expect(lanes.length).toBeGreaterThan(10);
    expect(lanes).toContain("HEURISTICS");
    expect(lanes).toContain("BROWSER");
  });

  it.each(emittedLanes())("%s has a colour token", (lane) => {
    expect(CSS).toMatch(new RegExp(`--srd-color-${lane.toLowerCase()}\\s*:`));
  });

  it.each(emittedLanes())("%s maps that colour onto --srd-lane", (lane) => {
    const l = lane.toLowerCase();
    expect(CSS).toMatch(new RegExp(`\\.srd-lane-${l}\\s*\\{[^}]*--srd-lane:`));
  });

  // The view also draws the rail's A2A hops (buildA2aTokenChainSteps), whose
  // lane never appears in buildTraceSteps.js.
  it("the lane of the rail's A2A hops has a colour", () => {
    const RAIL = read("../TokenChainTraceRail.jsx");
    const lanes = new Set([...RAIL.matchAll(/\["a2a-[^"]+",[^\]]*"([A-Z0-9_]+)"\]/g)].map((m) => m[1]));
    expect([...lanes]).toEqual(["A2A"]);
    for (const lane of lanes) {
      const l = lane.toLowerCase();
      expect(CSS).toMatch(new RegExp(`--srd-color-${l}\\s*:`));
      expect(CSS).toMatch(new RegExp(`\\.srd-lane-${l}\\s*\\{[^}]*--srd-lane:`));
    }
  });
});
