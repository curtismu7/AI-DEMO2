import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// The mirror's index.html is maintained by hand (the exporter never writes it), so a card that
// points at a page that was never exported would be a silent 404 for anyone browsing the mirror.
const MIRROR = path.resolve(__dirname, "../../public/learning-mirror");
const index = fs.readFileSync(path.join(MIRROR, "index.html"), "utf8");
const pages = [...index.matchAll(/<a class="lx-card"[^>]*href="([A-Za-z0-9_-]+\.html)"/g)].map((m) => m[1]);

describe("learning-mirror/index.html", () => {
  it("lists the topic pages (so this cannot pass by matching nothing)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(45);
  });

  it("includes the four topics exported from the hub drawers", () => {
    for (const p of [
      "agent-kill-switch.html",
      "spiffe-svid-workload-identity.html",
      "gateway-vs-p1az-decision-split.html",
      "vector-search-rag-weaviate.html",
    ]) {
      expect(pages).toContain(p);
    }
  });

  it.each(pages.map((p) => [p]))("%s exists in the mirror folder", (page) => {
    expect(fs.existsSync(path.join(MIRROR, page))).toBe(true);
  });
});
