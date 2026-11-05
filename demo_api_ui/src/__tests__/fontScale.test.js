import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FONT_SCALES, FONT_SCALE_DEFAULT } from "../context/ThemeContext";

describe("page font dial", () => {
  it("steps up in order, includes the default, and reaches 200%", () => {
    expect([...FONT_SCALES].sort((a, b) => a - b)).toEqual(FONT_SCALES);
    expect(FONT_SCALES).toContain(FONT_SCALE_DEFAULT);
    expect(Math.max(...FONT_SCALES)).toBe(2);
    expect(FONT_SCALES[0]).toBe(1);
  });

  it("index.html's boot script accepts every value the dial can store (so a saved 200% is applied before first paint)", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const m = html.match(/\[([0-9., ]+)\]\.indexOf\(s\)/);
    expect(m, "boot script whitelist").toBeTruthy();
    expect(m[1].split(",").map((x) => Number(x.trim()))).toEqual(FONT_SCALES);
  });
});
