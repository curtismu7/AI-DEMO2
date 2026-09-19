import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(__dirname, "../AIAgent.css"), "utf8");

describe("Quick Config surface selector layout contract", () => {
  it("opens the menu above following rows with a dark high-contrast surface", () => {
    const selector = css.match(/\.ba-surface-selector\s*\{([\s\S]*?)\}/)?.[1] || "";
    const menu = css.match(/\.ba-surface-selector-menu\s*\{([\s\S]*?)\}/)?.[1] || "";

    expect(selector).toMatch(/position:\s*relative/);
    expect(selector).toMatch(/z-index:\s*\d+/);
    expect(menu).toMatch(/position:\s*absolute/);
    expect(menu).toMatch(/z-index:\s*\d+/);
    expect(menu).toMatch(/background:\s*#0f172a/);
    expect(menu).toMatch(/color:\s*#f8fafc/);
  });
});
