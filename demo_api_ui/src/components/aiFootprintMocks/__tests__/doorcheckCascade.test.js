// jsdom cannot show the cascade, so assert at stylesheet level that the Check doors button
// outranks the legacy `.pvs-connect button` fills (live getComputedStyle check still pending).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f) => readFileSync(`${process.cwd()}/src/components/aiFootprintMocks/${f}`, "utf8");

// [ids, classes/attrs/pseudo-classes, elements] — enough for the simple selectors used here.
const specificity = (sel) => {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const cls = (sel.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length;
  const bare = sel.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+|#[\w-]+/g, " ");
  const els = (bare.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return [ids, cls, els];
};
const beats = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};
const selectors = (css) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|[{};])\s*([^{}@;]+)\{/g)]
    .flatMap((m) => m[2].split(",").map((x) => x.trim()))
    .filter(Boolean);

describe("Check doors button cascade", () => {
  const views = selectors(read("PrivilegeShellViews.css"));
  // the bar/gate button (inside .pvs-doorcheck) and the VS Code tree button (inside .pvs-tree)
  const bases = [".pvs .pvs-doorcheck .pvs-doorcheck__btn", ".pvs .pvs-tree .pvs-doorcheck__btn"];
  const cases = bases.flatMap((b) => ["", ":disabled", ":focus-visible"].map((s) => [b + s]));

  it.each(cases)("has the high-specificity rule %s", (sel) => {
    expect(views).toContain(sel);
  });

  it("beats every legacy .pvs-connect button selector (any shape, incl. inside @media)", () => {
    const legacy = selectors(read("PrivilegeShellPanel.css")).filter((s) => /\.pvs-connect\b.*\bbutton\b/.test(s));
    expect(legacy.length).toBeGreaterThan(1);
    for (const b of bases) for (const l of legacy) expect(beats(specificity(b), specificity(l)), `${b} vs ${l}`).toBe(true);
  });
});
