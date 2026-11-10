import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// legacyNavItems in AdminSideNav.jsx is only a registry: the sidebar shows an item only when a group
// below it (productGroup(...)) names it. An item that is in the registry but in no group is a page
// nobody can find in the menu or the menu search. This test lists those items.
const src = fs.readFileSync(path.resolve(__dirname, "../AdminSideNav.jsx"), "utf8");
const lines = src.split("\n");
const registryStart = lines.findIndex((l) => l.includes("const legacyNavItems = ["));
const groupsStart = lines.findIndex((l) => l.includes("const legacyChildren = legacyNavItems"));
const registry = lines.slice(registryStart, groupsStart).join("\n");
const groups = lines.slice(groupsStart).join("\n");

// Removed from the menu on purpose (commit "drop the Demo Map nav line"); the page is still routed.
const HIDDEN_ON_PURPOSE = new Set(["/demo-map"]);

describe("AdminSideNav registry items are rendered by a group", () => {
  const found = new Map();
  for (const m of registry.matchAll(/label:\s*"([^"]+)",\s*(?:path:\s*"([^"]+)")?/g)) if (m[2]) found.set(`${m[1]}|${m[2]}`, [m[1], m[2]]);
  for (const m of registry.matchAll(/label:\s*"([^"]+)",\s*\n\s*path:\s*"([^"]+)"/g)) found.set(`${m[1]}|${m[2]}`, [m[1], m[2]]);
  const items = [...found.values()];

  it("finds the registry", () => {
    expect(items.length).toBeGreaterThan(100);
  });

  it("renders every item that has a path", () => {
    const hidden = items.filter(([label, p]) => !HIDDEN_ON_PURPOSE.has(p) && !groups.includes(`"${label}"`) && !groups.includes(`"${p}"`));
    expect(hidden.map(([label, p]) => `${label} (${p})`)).toEqual([]);
  });
});
