// jsdom cannot show the cascade, so assert at stylesheet level. A live getComputedStyle check on
// /privilege-mcp-client?view=inspect&tab=policies found the sign-in-behaviour rows computing
// `display: inline-block` despite a `display: grid` rule: PingOne's cross-origin end-user-nano.css
// restyles bare elements above a lone class (0,1,0) and cannot be read from document.styleSheets.
// Every rule for the radio group must therefore be nested (a descendant selector wins at 0,2,0+).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(`${process.cwd()}/src/pages/PrivilegeMcpClientPage.css`, "utf8");

const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|[{};])\s*([^{}@;]+)\{/g)]
  .flatMap((m) => m[2].split(",").map((x) => x.trim()))
  .filter(Boolean);

const classCount = (sel) => (sel.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length;

describe("Sign-in behaviour radio group cascade", () => {
  const group = selectors.filter((s) => /\.cur-prompt-mode__(row|label|hint|err)\b/.test(s));

  it("has rules to check", () => {
    expect(group.length).toBeGreaterThan(5);
  });

  it("never styles the rows, labels or hints with a lone class", () => {
    for (const sel of group) expect(classCount(sel), sel).toBeGreaterThanOrEqual(3);
  });

  it("draws its own radio (native radios render as a tiny ringless dot here)", () => {
    expect(css).toMatch(/input\[type="radio"\]\s*\{[^}]*appearance:\s*none/);
    expect(css).toMatch(/input\[type="radio"\]\s*\{[^}]*padding:\s*0/);
  });

  it("nests the Connection column and Demo view type-scale step under .cur-ide", () => {
    const marker = css.indexOf("Type scale, one step up");
    expect(marker).toBeGreaterThan(-1);
    const block = css.slice(css.lastIndexOf("/*", marker));
    const nested = [...block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|[{};])\s*([^{}@;]+)\{/g)]
      .flatMap((m) => m[2].split(",").map((x) => x.trim()))
      .filter(Boolean);
    expect(nested.length).toBeGreaterThan(10);
    for (const sel of nested) expect(sel, sel).toMatch(/^\.cur-ide /);
    expect(block).not.toMatch(/font-size:\s*\d/);
  });

  it("restates the Inspect form layout under .cur-ide (labels computed inline-block, so Method, Parameters and Send shared one row)", () => {
    const rule = (sel) => css.match(new RegExp(`${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1] || "";
    expect(rule(".cur-ide .cur-field")).toMatch(/display:\s*flex/);
    expect(rule(".cur-ide .cur-field")).toMatch(/flex-direction:\s*column/);
    expect(rule(".cur-ide .cur-btn-row")).toMatch(/display:\s*flex/);
    expect(rule(".cur-ide .cur-tools-header")).toMatch(/display:\s*flex/);
    expect(rule(".cur-ide .cur-mcp-explorer")).toMatch(/flex-direction:\s*column/);
  });

  it("takes its font sizes from the scale, not literals", () => {
    const block = css.slice(css.indexOf(".cur-prompt-mode legend"));
    expect(block.slice(0, block.indexOf("@media"))).not.toMatch(/font-size:\s*\d/);
  });
});
