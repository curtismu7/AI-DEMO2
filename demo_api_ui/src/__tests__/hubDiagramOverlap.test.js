import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIGS } from "../config/useCaseDiagrams";

// Every Learning Hub "Demo step" chip links /use-cases#UCxx; when the UC also
// has a use-case diagram the card grows a "Diagram ↗" link. This ratchet pins
// that pairing: a demoStep the hub cannot diagram is either a wrong UC or a
// missing diagram — fix one of the two, don't silence this.
const hub = fs.readFileSync(
  path.resolve(__dirname, "../components/LearningHub.tsx"),
  "utf8",
);
const hubIds = [
  ...new Set([...hub.matchAll(/useCaseId: "([^"]+)"/g)].map((m) => m[1])),
];

describe("Learning Hub demoStep chips", () => {
  it("collects the hub's use-case ids (so this cannot pass by matching nothing)", () => {
    expect(hubIds.length).toBeGreaterThanOrEqual(20);
  });

  it("every demoStep UC resolves through getConfig (chip + Diagram link both render)", () => {
    const missing = hubIds.filter((id) => !CONFIGS.some((c) => c.id === id));
    expect(missing).toEqual([]);
  });
});
