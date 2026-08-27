import fs from "node:fs";
import path from "node:path";
import { buildReelFrames } from "../IntentBindingLearningPage";

const LIVE_RESULT = {
  status: 403,
  errorCode: "intent_exceeded",
  reason: "DENY — $500 exceeds the $100 declared intent (via PAR)",
  requestUri: "urn:ietf:params:oauth:request_uri:abc",
  parRequest: {
    method: "POST",
    url: "https://auth.pingone.com/env-1/as/par",
    form: { client_id: "actor", client_secret: "<redacted>", authorization_details: [{ amount: 500 }] },
  },
  parResponse: { request_uri: "urn:ietf:params:oauth:request_uri:abc", expires_in: 60 },
};

describe("buildReelFrames", () => {
  it("plays request, response, decision for a live PAR run", () => {
    const frames = buildReelFrames(LIVE_RESULT, {});
    expect(frames.map((f) => f.chip)).toEqual(["Request", "Response", "Decision"]);
    expect(frames[0].body).toBe(LIVE_RESULT.parRequest);
    expect(frames[1].body).toBe(LIVE_RESULT.parResponse);
    expect(frames[2].side).toBe("deny");
    expect(frames[2].title).toContain("intent_exceeded");
  });

  it("marks the decision permit when the run succeeds", () => {
    const frames = buildReelFrames({ ...LIVE_RESULT, status: 200, errorCode: null }, {});
    expect(frames[2].side).toBe("permit");
    expect(frames[2].title).toBe("Decision — PERMIT");
  });

  it("flags a rejected PAR push on the response frame", () => {
    const frames = buildReelFrames(
      { ...LIVE_RESULT, parResponse: { error: "par_push_failed", error_description: "boom" } },
      {},
    );
    expect(frames[1].side).toBe("deny");
    expect(frames[1].title).toContain("rejected");
  });

  it("falls back to the page's own call when no PAR push happened", () => {
    const sent = { action: "permit", requestedAmount: 80, live: false };
    const frames = buildReelFrames({ status: 200, reason: "PERMIT" }, sent);
    expect(frames.map((f) => f.chip)).toEqual(["Request", "Response"]);
    expect(frames[0].body).toBe(sent);
  });

  it("renders nothing before a run", () => {
    expect(buildReelFrames(null, {})).toEqual([]);
  });
});

// Measured live at a 960px viewport: a plain `1fr 1fr` is `minmax(auto, 1fr)`,
// so the reel's min-content widened the drift track to 803px, squeezed the
// permit column to 182px and overflowed the page by 173px. `.App` clips
// overflow-x, so the $500 column was cut off rather than scrollable.
describe("ib-split track sizing", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "IntentBindingLearningPage.css"), "utf8");

  it("keeps both run columns shrinkable", () => {
    expect(css).toMatch(/\.ib-split \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it("wraps long JSON instead of widening the column", () => {
    expect(css).toMatch(/\.ib-reel-json \{[^}]*white-space: pre-wrap/);
  });
});
