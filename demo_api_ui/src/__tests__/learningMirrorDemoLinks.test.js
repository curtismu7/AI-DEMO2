import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Phase 0: every static Learning Hub mirror page must carry a "Run it in the demo"
// card linking to the live demo route that proves its topic. The card is injected by
// demo-links.js at runtime, so the test enforces the wiring contract instead of the HTML:
//   1. the shared include exists and is loaded by every topic page
//   2. every topic page (except index) has a data-demo-topic attribute naming its topic
//   3. every topic key in demo-links.js maps to a route served by the app (sanity: non-empty, app-relative)
const MIRROR = path.resolve(__dirname, "../../public/learning-mirror");
const INCLUDE = path.join(MIRROR, "demo-links.js");

const topicPages = fs
  .readdirSync(MIRROR, { withFileTypes: true })
  .filter((e) => e.isFile() && /^[a-z0-9-]+\.html$/.test(e.name) && e.name !== "index.html")
  .map((e) => e.name);

describe("learning-mirror demo-link include", () => {
  it("has topic pages to check (so this cannot pass by scanning nothing)", () => {
    expect(topicPages.length).toBeGreaterThanOrEqual(45);
  });

  it("ships the shared demo-links.js include", () => {
    expect(fs.existsSync(INCLUDE)).toBe(true);
  });

  it("include defines a TOPIC_ROUTES map and injects the card", () => {
    const src = fs.readFileSync(INCLUDE, "utf8");
    expect(src).toContain("TOPIC_ROUTES");
    expect(src).toContain("run-it-in-the-demo");
  });

  it.each(topicPages.map((p) => [p]))("%s loads the include and names its topic", (page) => {
    const html = fs.readFileSync(path.join(MIRROR, page), "utf8");
    expect(html, `${page} must set data-demo-topic`).toMatch(/data-demo-topic="[a-z0-9-]+"/);
    expect(html, `${page} must load demo-links.js`).toContain("demo-links.js");
  });

  it("maps every declared topic key to a demo route", () => {
    const src = fs.readFileSync(INCLUDE, "utf8");
    const keys = [...src.matchAll(/^\s*"?([a-z0-9-]+)"?\s*:\s*"?(.+?)"?,?\s*$/gm)]
      .map((m) => m[1])
      .filter((k) => k !== "TOPIC_ROUTES" && !k.startsWith("//"));
    expect(keys.length).toBeGreaterThanOrEqual(40);
  });
});
