import { describe, expect, it } from "vitest";
import { OAUTH_VISUALIZER_FLOWS, createInitialRun, getDiagramArrowIndexes, getStepStatus } from "../oauthVisualizerModel";

describe("OAuth Visualizer model", () => {
  it("includes the supplied grant type and exchange families", () => {
    expect(OAUTH_VISUALIZER_FLOWS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "authorization-code-pkce" }),
      expect.objectContaining({ id: "client-credentials" }),
      expect.objectContaining({ id: "token-exchange-delegation" }),
    ]));
  });

  it("starts every flow idle with its first step selected", () => {
    const run = createInitialRun(OAUTH_VISUALIZER_FLOWS[0]);
    expect(run.status).toBe("idle");
    expect(run.selectedStepId).toBe(OAUTH_VISUALIZER_FLOWS[0].steps[0]);
    expect(getStepStatus(run, run.selectedStepId)).toBe("pending");
  });

  it("maps a selected step to the visualizer arrow range", () => {
    const flow = OAUTH_VISUALIZER_FLOWS.find((item) => item.id === "client-credentials");
    expect(getDiagramArrowIndexes(flow, 0)).toEqual([1]);
    expect(getDiagramArrowIndexes(flow, 2)).toEqual([3, 4]);
  });
});
