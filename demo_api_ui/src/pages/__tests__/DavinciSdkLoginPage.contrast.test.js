import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../DavinciSdkLoginPage.css"), "utf8");

describe("DaVinci SDK live form contrast", () => {
  it("pins live collector text to the emphasis-surface ink token", () => {
    expect(css).toMatch(/\.dvsdk-live-app \.dvsdk-field[\s\S]*?color: var\(--th-text-on-emphasis\)/);
    expect(css).toMatch(/\.dvsdk-live-app \.dvsdk-rich-text[\s\S]*?color: var\(--th-text-on-emphasis\)/);
  });
});
