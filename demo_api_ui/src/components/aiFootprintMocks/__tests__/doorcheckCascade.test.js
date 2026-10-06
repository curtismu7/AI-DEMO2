// jsdom cannot show the cascade, so assert at stylesheet level that the Check doors button
// outranks the legacy `.pvs-connect button` fills. A live getComputedStyle check on the served
// stack found the VS Code tree button UNSTYLED: the side tree renders in the chrome's
// `.afm-vcs-side`, OUTSIDE any `.pvs` root, so its selectors must not require a `.pvs` ancestor.
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
  // the bar/gate button (inside .pvs-doorcheck, inside a .pvs costume root) and the VS Code tree
  // button (inside .pvs-tree, which lives in the chrome's side panel, outside any .pvs)
  const barBase = ".pvs .pvs-doorcheck .pvs-doorcheck__btn";
  const treeBase = ".pvs-tree .pvs-doorcheck__btn";
  const bases = [barBase, treeBase];
  const cases = bases.flatMap((b) => ["", ":disabled", ":focus-visible"].map((s) => [b + s]));

  it.each(cases)("has the high-specificity rule %s", (sel) => {
    expect(views).toContain(sel);
  });

  it("beats every legacy .pvs-connect button selector (any shape, incl. inside @media)", () => {
    const legacy = selectors(read("PrivilegeShellPanel.css")).filter((s) => /\.pvs-connect\b.*\bbutton\b/.test(s));
    expect(legacy.length).toBeGreaterThan(1);
    // only the bar button can sit inside .pvs-connect (the signed-out gate); the tree never does
    for (const l of legacy) expect(beats(specificity(barBase), specificity(l)), `${barBase} vs ${l}`).toBe(true);
  });

  it("never requires a .pvs ancestor for the tree button (it renders outside .pvs)", () => {
    const treeRules = views.filter((s) => s.includes(".pvs-tree") && s.includes(".pvs-doorcheck__btn"));
    expect(treeRules.length).toBeGreaterThan(0);
    for (const sel of treeRules) expect(sel, sel).not.toMatch(/(^|\s)\.pvs(\s|$)/);
  });
});

describe("per-skin accent on Check doors and Re-arm", () => {
  const css = read("PrivilegeShellViews.css");
  const chrome = read("chrome.css");

  it("defines --pvs-accent for every chat-capable skin from its own chrome", () => {
    expect(css).toMatch(/\.pvs--vscode,\s*\.pvs-tree\s*\{\s*--pvs-accent:\s*var\(--accent\);/);
    expect(css).toMatch(/\.pvs--claude-desktop\s*\{\s*--pvs-accent:\s*var\(--claude-accent\);/);
    expect(css).toMatch(/\.pvs--coding\s*\{\s*--pvs-accent:\s*#[0-9a-f]{6};/i);
  });

  it("takes the accents from variables the chrome really defines", () => {
    expect(chrome).toMatch(/--accent:\s*#[0-9a-f]{6}/i);
    expect(chrome).toMatch(/--claude-accent:\s*#[0-9a-f]{6}/i);
  });

  it("tints the Check doors button, the Re-arm banner and its button with the accent", () => {
    for (const re of [
      /\.pvs-tree \.pvs-doorcheck__btn \{[^}]*var\(--pvs-accent, currentColor\)/,
      /\.pvs-rearm \{[^}]*var\(--pvs-accent, currentColor\)/,
      /\.pvs-rearm button \{[^}]*var\(--pvs-accent, currentColor\)/,
    ]) expect(css).toMatch(re);
  });

  it("falls back to currentColor, so a skin without an accent keeps the neutral look", () => {
    expect(css).not.toMatch(/var\(--pvs-accent\)/);
  });
});
