import { applyStepVisibility, SKIP_REASONS } from "../stepVisibility";

const mk = (id, status, extra = {}) => ({ id, status, detail: {}, ...extra });
const activeTrace = { startedAt: Date.now(), tokenEvents: [{ id: "x" }] };
const doneTrace = { ...activeTrace, outcome: "ok" };

describe("applyStepVisibility", () => {
  test("no run activity: everything empty (session-only state shows nothing)", () => {
    const out = applyStepVisibility([mk("website", "done"), mk("signin", "done")], {});
    expect(out).toEqual({ visible: [], skipped: [], revealed: [] });
  });

  test("in-flight: fired + notRequired visible, no skipped, no chip", () => {
    const steps = [
      mk("website", "done"),
      mk("signin", "done"),
      mk("agent", "done"),
      mk("exchange", "pending"),
      mk("gateway", "notinpath"),
      mk("exchange-x", "notinpath", { detail: { notRequired: true } }),
    ];
    const out = applyStepVisibility(steps, activeTrace);
    expect(out.visible.map((s) => s.id)).toEqual(["website", "signin", "agent", "exchange-x"]);
    expect(out.skipped).toEqual([]);
  });

  test("complete + collapsed: fired visible, the rest counted in skipped", () => {
    const steps = [
      mk("website", "done"), mk("agent", "done"),
      mk("exchange", "notinpath"), mk("api", "pending"), mk("database", "notinpath"),
    ];
    const out = applyStepVisibility(steps, doneTrace, { collapsed: true });
    expect(out.visible.map((s) => s.id)).toEqual(["website", "agent"]);
    expect(out.skipped.map((s) => s.id)).toEqual(["exchange", "api", "database"]);
    expect(out.revealed).toEqual([]);
  });

  test("complete + expanded: skipped revealed with SKIP_REASONS narrative", () => {
    const steps = [mk("agent", "done"), mk("api", "notinpath")];
    const out = applyStepVisibility(steps, doneTrace, { collapsed: false });
    expect(out.revealed).toHaveLength(1);
    expect(out.revealed[0].detail.narrative).toBe(SKIP_REASONS.api);
    // revealed mirrors skipped — visible stays the fired set (the consumer
    // renders [...visible, ...revealed] when expanded).
    expect(out.visible.map((s) => s.id)).toEqual(["agent"]);
    expect(out.revealed.map((s) => s.id)).toEqual(["api"]);
  });

  test("mock-success: revealed steps keep their own narrative", () => {
    const steps = [mk("agent", "done"), mk("api", "notinpath", { detail: { narrative: "Teaching text." } })];
    const trace = { ...doneTrace, outcome: "mock-success" };
    const out = applyStepVisibility(steps, trace, { collapsed: false });
    expect(out.revealed[0].detail.narrative).toBe("Teaching text.");
  });

  test("challenge hop: probe ran (done) stays visible; probe skipped (notinpath) collapses", () => {
    const ran = mk("tools-call-challenge", "done");
    const skippedProbe = mk("tools-list-challenge", "notinpath");
    const out = applyStepVisibility([mk("agent", "done"), ran, skippedProbe], doneTrace, { collapsed: true });
    expect(out.visible.map((s) => s.id)).toEqual(["agent", "tools-call-challenge"]);
    expect(out.skipped.map((s) => s.id)).toEqual(["tools-list-challenge"]);
  });

  test("guest run (no bearer, no probe): challenge hops collapse, never error", () => {
    const steps = [mk("agent", "done"), mk("tools-list-challenge", "notinpath"), mk("tools-call-challenge", "notinpath")];
    const out = applyStepVisibility(steps, doneTrace, { collapsed: true });
    expect(out.visible.map((s) => s.id)).toEqual(["agent"]);
    expect(out.skipped).toHaveLength(2);
  });
});
