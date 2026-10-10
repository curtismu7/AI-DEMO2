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

  it("every TOPIC_ROUTES value is a route the app actually serves (the 404 ratchet)", () => {
    const src = fs.readFileSync(INCLUDE, "utf8");
    const routes = [...src.matchAll(/^\s*"[a-z0-9-]+":\s*"([^"]+)"/gm)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThanOrEqual(40);

    const app = fs.readFileSync(path.resolve(__dirname, "../App.js"), "utf8");
    const appPaths = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
    const staticPaths = new Set(appPaths.filter((p) => !p.includes(":")));
    const paramPrefixes = appPaths
      .filter((p) => p.includes(":"))
      .map((p) => p.split(":")[0]); // "/learning-lab/:lab" -> "/learning-lab/"
    // Wildcard mounts ("/architecture/*") serve their children by prefix.
    const wildcardPrefixes = appPaths
      .filter((p) => p.endsWith("/*"))
      .map((p) => p.slice(0, -1)); // "/architecture/*" -> "/architecture/"

    const dead = routes.filter((route) => {
      const base = route.split("?")[0].replace(/\/+$/, "") || "/";
      if (staticPaths.has(base)) return false; // literal route exists — alive
      if (paramPrefixes.some((prefix) => base.startsWith(prefix))) return false;
      return !wildcardPrefixes.some((prefix) => base.startsWith(prefix)); // no mount serves it — dead
    });
    expect(dead, `demo-links.js points at routes App.js does not serve: ${dead.join(", ")}`).toEqual([]);
  });
});
