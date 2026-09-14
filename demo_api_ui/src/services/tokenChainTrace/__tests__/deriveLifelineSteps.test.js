import { describe, test, expect } from "vitest";
import { deriveLifelineSteps, deriveLifelineParticipants } from "../deriveLifelineSteps";

describe("deriveLifelineSteps", () => {
  test("empty input returns no steps", () => {
    expect(deriveLifelineSteps([])).toEqual([]);
    expect(deriveLifelineSteps(undefined)).toEqual([]);
  });

  test("a lone step (no previous lane) renders as a note, not an arrow", () => {
    const steps = deriveLifelineSteps([
      { id: "website", lane: "BROWSER", title: "Browser", status: "done" },
    ]);
    expect(steps).toEqual([
      { id: "website", type: "note", lane: "BROWSER", label: "Browser", status: "done" },
    ]);
  });

  test("consecutive steps in different lanes render as an arrow between them", () => {
    const steps = deriveLifelineSteps([
      { id: "website", lane: "BROWSER", title: "Browser", status: "done" },
      { id: "signin", lane: "PINGONE", title: "Sign-in", status: "active" },
    ]);
    expect(steps[1]).toEqual({
      id: "signin",
      type: "arrow",
      from: "BROWSER",
      to: "PINGONE",
      label: "Sign-in",
      status: "active",
    });
  });

  test("two consecutive steps in the SAME lane render the second as a note, not a zero-length arrow", () => {
    const steps = deriveLifelineSteps([
      { id: "agent-token", lane: "BFF", title: "Agent token", status: "done" },
      { id: "exchange", lane: "BFF", title: "Exchange", status: "active" },
    ]);
    expect(steps[1]).toEqual({
      id: "exchange",
      type: "note",
      lane: "BFF",
      label: "Exchange",
      status: "active",
    });
  });

  test("steps missing a lane are skipped rather than breaking the chain", () => {
    const steps = deriveLifelineSteps([
      { id: "website", lane: "BROWSER", title: "Browser", status: "done" },
      { id: "no-lane", title: "Untracked", status: "pending" },
      { id: "signin", lane: "PINGONE", title: "Sign-in", status: "active" },
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ from: "BROWSER", to: "PINGONE" });
  });
});

describe("deriveLifelineParticipants", () => {
  test("empty input returns no participants", () => {
    expect(deriveLifelineParticipants([])).toEqual([]);
  });

  test("returns lanes in first-seen order, de-duplicated", () => {
    const lifelineSteps = deriveLifelineSteps([
      { id: "website", lane: "BROWSER", title: "Browser", status: "done" },
      { id: "signin", lane: "PINGONE", title: "Sign-in", status: "done" },
      { id: "prompt", lane: "CHAT", title: "Prompt", status: "done" },
      { id: "reply", lane: "CHAT", title: "Reply", status: "active" },
      { id: "again", lane: "BROWSER", title: "Back to browser", status: "pending" },
    ]);
    expect(deriveLifelineParticipants(lifelineSteps)).toEqual(["BROWSER", "PINGONE", "CHAT"]);
  });
});
