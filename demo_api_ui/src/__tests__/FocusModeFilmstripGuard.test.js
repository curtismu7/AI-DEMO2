// Static-source guards for Focus Mode (Option C, filmstrip).
// Spec: docs/superpowers/specs/2026-08-08-focus-mode-filmstrip-design.md
//
// Static rather than JSDOM renders: UserDashboardPing2026 is ~3700 lines with a
// large provider surface, and EmbeddedDockLayoutGuard.test.js already
// establishes this pattern for the same file.
//
// The last two tests are the point of the exercise. TokenChainTraceRail mounts
// on ~20 surfaces and UserDashboard.js is frozen behind a sha256 canary; the
// filmstrip is a sibling over the same store, never an edit to either.
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
const p2026 = read("../components/UserDashboardPing2026.js");
const classic = read("../components/UserDashboard.js");
const rail = read("../components/TokenChainTraceRail.jsx");

describe("Focus Mode filmstrip guard", () => {
  test("TokenChainFilmstrip component exists", () => {
    expect(fs.existsSync(path.resolve(__dirname, "../components/TokenChainFilmstrip.jsx"))).toBe(true);
  });

  test("Ping2026 middle branch renders the filmstrip", () => {
    expect(p2026.includes("TokenChainFilmstrip")).toBe(true);
  });

  test("agent column keeps ud-agent-column so its CSS still applies", () => {
    expect(p2026.includes("ud-agent-column")).toBe(true);
  });

  test("agentColumnRef stays attached (handleScrollToAssistant depends on it)", () => {
    expect(p2026.includes("ref={agentColumnRef}")).toBe(true);
  });

  test("config strip slot stays in the middle layout", () => {
    expect(p2026.includes('className="ud-dashboard-config-strip"')).toBe(true);
  });

  test("the removed agent login wall is NOT reintroduced (PR #1450)", () => {
    expect(p2026.includes("ud-dashboard-inline-agent-login-prompt")).toBe(false);
  });

  // ── zero-diff guards: these must pass BEFORE and AFTER ──
  test("the shared TokenChainTraceRail gains no filmstrip markup", () => {
    expect(rail.includes("ud-focus-mode")).toBe(false);
    expect(rail.includes("TokenChainFilmstrip")).toBe(false);
  });

  test("the frozen classic dashboard gains no Focus Mode markup", () => {
    expect(classic.includes("ud-focus-mode")).toBe(false);
    expect(classic.includes("TokenChainFilmstrip")).toBe(false);
  });
});
