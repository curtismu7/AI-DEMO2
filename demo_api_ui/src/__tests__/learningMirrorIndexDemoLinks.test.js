import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// The mirror's index.html is the master page: it must offer a path from every
// topic to the live demo — a prominent hero link plus no muted dead-end cards.
const MIRROR = path.resolve(__dirname, "../../public/learning-mirror");
const index = fs.readFileSync(path.join(MIRROR, "index.html"), "utf8");

describe("learning-mirror/index.html master page", () => {
  it("links prominently to the live demo", () => {
    expect(index).toMatch(/class="lx-cta"[^>]*href="https:\/\/local\.ping-devops\.com:4000\/?"/);
    expect(index).toContain("Open the live demo");
  });

  it("has no muted dead-end cards — every 'live demo app' card links out", () => {
    const muted = [...index.matchAll(/<div class="lx-card lx-muted"><div class="lx-t">([^<]*)<\/div>/g)].map((m) => m[1]);
    expect(muted).toEqual([]);
  });

  it("links the formerly-muted topics to their demo routes", () => {
    // Guided Demo Tour -> /use-cases, Jev -> /jev-learning, Agentic Trust -> /agentic-trust
    expect(index).toMatch(/href="https:\/\/local\.ping-devops\.com:4000\/use-cases"[^>]*>[^<]*<div class="lx-t">Guided Demo Tour</);
    expect(index).toMatch(/href="https:\/\/local\.ping-devops\.com:4000\/jev-learning"[^>]*>[^<]*<div class="lx-t">Jev: Decision Model</);
    expect(index).toMatch(/href="https:\/\/local\.ping-devops\.com:4000\/agentic-trust"[^>]*>[^<]*<div class="lx-t">Agentic Trust</);
  });
});
