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

  // Locked 2026-08-17 (PR #1896): #1784 gated the float-mode filmstrip behind
  // ba_show_filmstrip === "1", default OFF — the filmstrip silently vanished
  // for every user who never touched the toggle. Default must stay ON
  // (unset/anything but "0" shows it); only an explicit toggle-off hides it.
  test("Ping2026 defaults the filmstrip toggle ON (only \"0\" hides it)", () => {
    expect(p2026).toMatch(/localStorage\.getItem\("ba_show_filmstrip"\)\s*!==\s*"0"/);
  });

  const aiAgent = read("../components/AIAgent.js");
  test("AIAgent's own Movie reel state defaults ON to match", () => {
    expect(aiAgent).toMatch(/localStorage\.getItem\("ba_show_filmstrip"\)\s*!==\s*"0"/);
  });

  // Locked 2026-08-18: the Focus Mode copy rendered UNCONDITIONALLY while only
  // the float-mode copy was gated. Focus Mode is the default layout, so the
  // More › Movie reel switch flipped state, persisted it, and changed nothing
  // on screen — reported as "we lost movie roll". Both copies must be gated on
  // the same state, or the control silently governs a branch nobody is looking
  // at. Verified live: 25 `tcfs` nodes present with `.tcfs-float-host` absent,
  // i.e. the copy on screen was the ungated one.
  test("EVERY TokenChainFilmstrip render is gated on showFilmstrip", () => {
    const renders = p2026.match(/<TokenChainFilmstrip\s*\/>/g) || [];
    expect(renders).toHaveLength(3);
    // No render may sit outside a showFilmstrip guard.
    expect(p2026).not.toMatch(/\n\s*<TokenChainFilmstrip\s*\/>\s*\n\s*<\/div>\s*\n\s*\)\s*:/);
    expect(p2026).toMatch(/\{showFilmstrip && <TokenChainFilmstrip\s*\/>\}/);
    const hostedGuards = p2026.match(/\{showFilmstrip && \(\s*\n\s*<div className="tcfs-float-host">/g) || [];
    expect(hostedGuards).toHaveLength(2);
  });

  test("bottom-dock layout renders the enabled filmstrip below the dock", () => {
    expect(p2026).toMatch(
      /<EmbeddedAgentDock[\s\S]*?agentPlacement=\{agentPlacement\}[\s\S]*?\{showFilmstrip && \([\s\S]*?<TokenChainFilmstrip\s*\/>/,
    );
  });

  // The switch is only meaningful if turning it off removes the reel in the
  // layout the user is actually in. Counting guards vs renders catches a future
  // third render site added ungated.
  test("filmstrip renders and showFilmstrip guards stay in balance", () => {
    const renders = (p2026.match(/<TokenChainFilmstrip\s*\/>/g) || []).length;
    const guards = (p2026.match(/showFilmstrip &&/g) || []).length;
    expect(guards).toBeGreaterThanOrEqual(renders);
  });
});
