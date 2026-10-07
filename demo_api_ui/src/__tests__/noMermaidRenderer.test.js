import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// React Flow is the renderer for every diagram page (FlowDiagram draws Mermaid-format text
// with it). Nothing under src/ may import the Mermaid library or the old render hook.
const SRC = resolve(process.cwd(), "src");
const SELF = "noMermaidRenderer.test.js";

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(jsx?|tsx?)$/.test(name) && name !== SELF) yield full;
  }
}

describe("no Mermaid renderer", () => {
  it("nothing imports the mermaid library or useMermaidRender", () => {
    const offenders = [];
    for (const f of files(SRC)) {
      const text = readFileSync(f, "utf8");
      if (/from\s+['"]mermaid['"]|import\(\s*['"]mermaid['"]|useMermaidRender/.test(text)) {
        offenders.push(f.replace(`${SRC}/`, ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});
