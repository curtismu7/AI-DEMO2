import UC1 from "../../../config/useCaseDiagrams/UC1";
import UC8 from "../../../config/useCaseDiagrams/UC8";
import { buildTraceSteps } from "../buildTraceSteps";
import { buildLiveUcWalk } from "../ucLiveOverlay";

const eventsFor = (slug, extra = []) => [
  { id: "user-token", claims: { sub: "alice" }, useCaseId: undefined },
  { id: "request_accepted", status: "done", useCaseId: slug, vertical: "banking" },
  ...extra,
];

test("UC1 run renders a live walk from fired hops", () => {
  const trace = {
    prompt: { message: "balance" }, outcome: "ok", startedAt: Date.now(), phases: [],
    tokenEvents: eventsFor("delegated-access-with-proof", [
      { id: "gw-authorize", status: "done", decision: "PERMIT", useCaseId: "delegated-access-with-proof" },
      { id: "exchanged-token", status: "done", claims: { scope: "accounts:read", act: { sub: "agent" } }, useCaseId: "delegated-access-with-proof" },
    ]),
    authorize: { decision: "PERMIT", useCaseId: "delegated-access-with-proof" },
  };
  const walk = buildLiveUcWalk(UC1, trace, buildTraceSteps(trace));
  expect(walk).not.toBeNull();
  const ids = walk.map((w) => w.nodes.join(">"));
  expect(ids).toContain("gw>p1");           // exchange hop
  expect(walk.every((w) => w.lines.length && Array.isArray(w.tech))).toBe(true);
});

test("free-typed prompt (no slug): curated fallback", () => {
  const trace = { prompt: { message: "hi" }, outcome: "ok", startedAt: 1, phases: [], tokenEvents: [{ id: "x" }] };
  expect(buildLiveUcWalk(UC1, trace, buildTraceSteps(trace))).toBeNull();
});

test("slug mismatch (UC1 page, UC8 run): curated fallback", () => {
  const trace = { outcome: "ok", startedAt: 1, tokenEvents: [{ id: "e", useCaseId: "hitl-consent" }] };
  expect(buildLiveUcWalk(UC1, trace, [])).toBeNull();
});

test("UC8 run overlays its consent walk", () => {
  const trace = {
    outcome: "ok", startedAt: 1,
    tokenEvents: [{ id: "authorize-decision", decision: "HITL_REQUIRED", useCaseId: "hitl-consent" }],
    authorize: { decision: "HITL_REQUIRED", useCaseId: "hitl-consent" },
    phases: [{ phase: "gateway_hitl_required", label: "consent" }],
  };
  const walk = buildLiveUcWalk(UC8, trace, buildTraceSteps(trace));
  expect(walk).not.toBeNull();
});

test("config without hopHints never overlays (all other UCs unchanged)", () => {
  const cfg = { ...UC1, hopHints: undefined };
  expect(buildLiveUcWalk(cfg, { outcome: "ok", startedAt: 1, tokenEvents: [{ id: "e", useCaseId: "delegated-access-with-proof" }] }, [])).toBeNull();
});
