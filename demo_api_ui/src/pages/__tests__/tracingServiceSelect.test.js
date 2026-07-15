// demo_api_ui/src/pages/__tests__/tracingServiceSelect.test.js
import { describe, expect, it } from "vitest";
import {
  isTransientFailure,
  pickBestService,
  rankCandidateServices,
} from "../tracingServiceSelect";

describe("rankCandidateServices", () => {
  it("puts preferred services first and caps at 8", () => {
    const ranked = rankCandidateServices([
      "z-other",
      "hitl-service",
      "mcp-gateway",
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
    expect(ranked[0]).toBe("mcp-gateway");
    expect(ranked).toContain("hitl-service");
    expect(ranked.length).toBeLessThanOrEqual(8);
  });
});

describe("pickBestService", () => {
  it("selects the service with the newest startTime", () => {
    const best = pickBestService(
      [
        {
          service: "quiet",
          traces: [],
        },
        {
          service: "old",
          traces: [{ startTime: "2026-07-15T10:00:00.000Z" }],
        },
        {
          service: "fresh",
          traces: [{ startTime: "2026-07-15T12:00:00.000Z" }],
        },
      ],
      ["quiet", "old", "fresh"],
    );
    expect(best).toBe("fresh");
  });

  it("falls back to the first listed service when all empty", () => {
    expect(pickBestService([{ service: "a", traces: [] }], ["a", "b"])).toBe("a");
  });
});

describe("isTransientFailure", () => {
  it("detects 502 and socket hang up", () => {
    expect(isTransientFailure(new Error("HTTP 502"))).toBe(true);
    expect(isTransientFailure(new Error("socket hang up"))).toBe(true);
    expect(isTransientFailure(new Error("HTTP 404"))).toBe(false);
  });
});
