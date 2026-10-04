import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// In-app links to the static Learning Hub copy (public/learning-mirror/) must point at a page that exists.
const SRC = path.resolve(__dirname, "..");
const MIRROR = path.resolve(__dirname, "../../public/learning-mirror");

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : sourceFiles(p);
    return /\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

describe("links to /learning-mirror/", () => {
  const links = sourceFiles(SRC).flatMap((file) =>
    [...fs.readFileSync(file, "utf8").matchAll(/\/learning-mirror\/([A-Za-z0-9_-]+\.html)/g)].map((m) => ({
      file: path.relative(SRC, file),
      page: m[1],
    })),
  );

  it("finds the in-app links (so this test cannot pass by scanning nothing)", () => {
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it.each(links.map((l) => [l.file, l.page]))("%s -> %s exists in the mirror", (_file, page) => {
    expect(fs.existsSync(path.join(MIRROR, page))).toBe(true);
  });
});
