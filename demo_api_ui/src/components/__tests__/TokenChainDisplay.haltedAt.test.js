// demo_api_ui/src/components/__tests__/TokenChainDisplay.haltedAt.test.js
// TDD: Task A4-T1 — isHaltedAt helper + halted-step card modifier
//
// Tests exercise the PRODUCTION isHaltedAt and resolveStatusVisual exported
// from TokenChainDisplay.js (named exports, @visibleForTesting). The previous
// inline re-implementation is removed; any logic bug in the real function now
// causes failures here.

// ── Mocks (must be declared before any import that transitively loads the
//    component, so vitest hoisting picks them up first) ─────────────────────

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => null,
}));
vi.mock("../../context/EducationUIContext", () => ({
  useEducationUIOptional: () => null,
}));
vi.mock("../../hooks/useDraggablePanel", () => ({
  useDraggablePanel: () => ({ panelRef: { current: null }, onMouseDown: () => {} }),
}));
vi.mock("../shared/JsonHighlight", () => ({ default: () => null }));
vi.mock("../TokenColorSystem", () => ({
  deriveTokenCategory: () => "user",
  TokenColorDot: () => null,
  TokenColorLegend: () => null,
  getTokenColor: () => "#000",
}));
vi.mock("./specGuide", () => ({ SPEC_GUIDE: {} }), { virtual: true });
vi.mock("../specGuide", () => ({ SPEC_GUIDE: {} }));
vi.mock("../TokenCard", () => ({ default: () => null }));
vi.mock("../shared/JsonField", () => ({ default: () => null }));
vi.mock("../../utils/educationalPages", () => ({ isEducationalPath: () => false }));
vi.mock("../../../TokenChainDisplay.css", () => ({}), { virtual: true });
vi.mock("../TokenChainDisplay.css", () => ({}), { virtual: true });

// ── Import PRODUCTION helpers ─────────────────────────────────────────────────
// These are the real exported functions from the shipped module, not copies.
import { isHaltedAt, resolveStatusVisual } from "../TokenChainDisplay.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TokenChainDisplay — isHaltedAt (production function)", () => {
  // ── Basic edge cases ────────────────────────────────────────────────────────

  it("returns false for an undefined event (out-of-bounds index)", () => {
    expect(isHaltedAt([], 0)).toBe(false);
  });

  it("returns true when event.isHaltedStep === true, even if status is OK", () => {
    const events = [{ status: "active", isHaltedStep: true }, { status: "active" }];
    expect(isHaltedAt(events, 0)).toBe(true);
  });

  it("returns false when event.isHaltedStep === false and status is active", () => {
    const events = [{ status: "active", isHaltedStep: false }];
    expect(isHaltedAt(events, 0)).toBe(false);
  });

  // ── Fallback heuristic ──────────────────────────────────────────────────────

  it("fallback: returns true when status='failed' AND it is NOT the last event", () => {
    const events = [
      { status: "failed" },
      { status: "waiting" },
    ];
    expect(isHaltedAt(events, 0)).toBe(true);
  });

  it("fallback: returns false when status='failed' AND it IS the last event", () => {
    const events = [
      { status: "active" },
      { status: "failed" },
    ];
    // index 1 is last → no ghost steps queued after it, so not a halt point
    expect(isHaltedAt(events, 1)).toBe(false);
  });

  it("fallback: 'denied' resolves to failed bucket → halts when non-last", () => {
    const events = [
      { status: "denied" },
      { status: "waiting" },
    ];
    expect(isHaltedAt(events, 0)).toBe(true);
  });

  it("fallback: 'error' resolves to failed bucket → halts when non-last", () => {
    const events = [
      { status: "error" },
      { status: "waiting" },
    ];
    expect(isHaltedAt(events, 0)).toBe(true);
  });

  it("fallback: 'active' status at a non-last index does NOT halt", () => {
    const events = [
      { status: "active" },
      { status: "waiting" },
    ];
    expect(isHaltedAt(events, 0)).toBe(false);
  });

  it("explicit isHaltedStep=true takes priority even when event is last", () => {
    // Only one event; last-position rule would suppress the fallback, but the
    // explicit flag overrides it.
    const events = [{ status: "failed", isHaltedStep: true }];
    expect(isHaltedAt(events, 0)).toBe(true);
  });

  // ── A4 review: 3 additional cases ──────────────────────────────────────────

  it("SUCCESS CHAIN: all-active statuses — no step is halted", () => {
    // A complete, successful chain should never produce a halted step.
    const events = [
      { status: "active" },
      { status: "exchanged" },
      { status: "success" },
      { status: "active" },
    ];
    events.forEach((_, i) => {
      expect(isHaltedAt(events, i)).toBe(false);
    });
  });

  it("{ status: 'failed', isHaltedStep: false } at NON-LAST index: fallback heuristic still fires", () => {
    // isHaltedStep=false does NOT suppress the fallback — only the positive
    // flag (=true) is checked, so the fallback still triggers for a failed
    // status at a non-last position. This is the documented behavior.
    const events = [
      { status: "failed", isHaltedStep: false },
      { status: "waiting" },
    ];
    // fallback: failed bucket + not last → true, regardless of isHaltedStep=false
    expect(isHaltedAt(events, 0)).toBe(true);
  });

  it("MISSING status at non-last index: undefined status buckets as 'failed' → halt fires", () => {
    // resolveStatusVisual with a non-string / empty status returns the
    // 'failed' bucket (fail-loud policy). Therefore a step whose status is
    // missing/undefined will be treated as a halt point when it is not last.
    const events = [
      { label: "some step" /* no status property */ },
      { status: "waiting" },
    ];
    // undefined → key="" → not in STATUS_VISUAL → { bucket:"failed" } → halt
    expect(isHaltedAt(events, 0)).toBe(true);
  });
});

describe("resolveStatusVisual — unknown status falls to failed bucket", () => {
  it("unknown string → bucket='failed'", () => {
    expect(resolveStatusVisual("totally-unknown-status").bucket).toBe("failed");
  });

  it("undefined → bucket='failed'", () => {
    expect(resolveStatusVisual(undefined).bucket).toBe("failed");
  });

  it("null → bucket='failed'", () => {
    expect(resolveStatusVisual(null).bucket).toBe("failed");
  });

  it("empty string → bucket='failed'", () => {
    expect(resolveStatusVisual("").bucket).toBe("failed");
  });

  it("'active' → bucket='active'", () => {
    expect(resolveStatusVisual("active").bucket).toBe("active");
  });

  it("'success' → bucket='active'", () => {
    expect(resolveStatusVisual("success").bucket).toBe("active");
  });

  it("'valid' (gateway introspection active) → bucket='active', not failed", () => {
    expect(resolveStatusVisual("valid").bucket).toBe("active");
  });

  it("'skipped' (leg not part of this run) → bucket='notinpath', labeled Not in path", () => {
    expect(resolveStatusVisual("skipped")).toEqual({
      bucket: "notinpath",
      label: "Not in path",
    });
  });

  it("'synthesized' stays in the neutral 'skipped' bucket", () => {
    expect(resolveStatusVisual("synthesized").bucket).toBe("skipped");
  });

  it("'revoked' (gateway introspection inactive) → bucket='failed'", () => {
    expect(resolveStatusVisual("revoked").bucket).toBe("failed");
  });
});
