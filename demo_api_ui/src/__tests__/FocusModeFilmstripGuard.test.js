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
  // for every user who never touched the toggle. Default must stay ON.
  //
  // Strengthened 2026-08-25, third disappearance: defaulting ON was not enough
  // while "off" was PERSISTED. One stray click wrote ba_show_filmstrip="0" to
  // localStorage and hid the reel in that browser profile permanently — across
  // reloads, redeploys and demos, invisible to everyone else, no self-heal.
  // Hiding is now session-only React state and is never written to storage, so
  // a reload always restores the reel. These two tests keep their original
  // purpose (default ON) and additionally pin that no persistence returns.
  const aiAgent = read("../components/AIAgent.js");

  test("Ping2026 defaults the filmstrip ON with no storage read", () => {
    expect(p2026).not.toMatch(/getItem\(\s*["']ba_show_filmstrip["']\s*\)/);
    expect(p2026).toMatch(/const \[showFilmstrip, setShowFilmstrip\] = useState\(true\)/);
  });

  test("AIAgent's own Movie reel state defaults ON to match, unpersisted", () => {
    expect(aiAgent).not.toMatch(/getItem\(\s*["']ba_show_filmstrip["']\s*\)/);
    // The toggle must not write the flag back.
    expect(aiAgent).not.toMatch(/setItem\(\s*["']ba_show_filmstrip["']/);
  });

  test("an already-poisoned browser is actively healed on mount", () => {
    expect(aiAgent).toMatch(/removeItem\(\s*["']ba_show_filmstrip["']\s*\)/);
  });

  // Locked 2026-08-18: the Focus Mode copy rendered UNCONDITIONALLY while only
  // the float-mode copy was gated. Focus Mode is the default layout, so the
  // More › Movie reel switch flipped state, persisted it, and changed nothing
  // on screen — reported as "we lost movie roll". Both copies must be gated on
  // the same state, or the control silently governs a branch nobody is looking
  // at. Verified live: 25 `tcfs` nodes present with `.tcfs-float-host` absent,
  // i.e. the copy on screen was the ungated one.
  // The float and dock copies now render <ReelDock/> — the sticky host plus its
  // collapse toggle — while Focus Mode still renders the filmstrip straight into
  // its grid row. Three reel renders either way, and all three stay gated.
  test("EVERY reel render is gated on showFilmstrip", () => {
    const direct = p2026.match(/<TokenChainFilmstrip\s*\/>/g) || [];
    const docks = p2026.match(/<ReelDock\s*\/>/g) || [];
    expect(direct).toHaveLength(1);
    expect(docks).toHaveLength(2);
    expect(p2026).toMatch(/\{showFilmstrip && <TokenChainFilmstrip\s*\/>\}/);
    const dockGuards = p2026.match(/\{showFilmstrip && <ReelDock\s*\/>\}/g) || [];
    expect(dockGuards).toHaveLength(2);
  });

  test("bottom-dock layout renders the enabled reel below the dock", () => {
    expect(p2026).toMatch(
      /<EmbeddedAgentDock[\s\S]*?agentPlacement=\{agentPlacement\}[\s\S]*?\{showFilmstrip && <ReelDock\s*\/>\}/,
    );
  });

  // The switch is only meaningful if turning it off removes the reel in the
  // layout the user is actually in. Counting guards vs renders catches a future
  // third render site added ungated.
  test("reel renders and showFilmstrip guards stay in balance", () => {
    const renders =
      (p2026.match(/<TokenChainFilmstrip\s*\/>/g) || []).length +
      (p2026.match(/<ReelDock\s*\/>/g) || []).length;
    const guards = (p2026.match(/showFilmstrip &&/g) || []).length;
    expect(guards).toBeGreaterThanOrEqual(renders);
  });

  // Locked 2026-08-27, fourth "the reel is gone": it was RENDERED in float and
  // dock mode but sat at y~2800 of a ~3500px page, below every banking card, so
  // nobody ever scrolled to it. Focus Mode gives it a grid row; the other two
  // layouts only had .tcfs-float-host, which flowed with the document. Pinning
  // that wrapper is what makes the reel visible in all three layouts.
  const filmstripCss = read("../components/TokenChainFilmstrip.css");

  test(".tcfs-float-host is pinned to the viewport bottom", () => {
    const rule = filmstripCss.match(/\.tcfs-float-host \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule[0]).toMatch(/position:\s*sticky/);
    expect(rule[0]).toMatch(/bottom:\s*0/);
  });

  test("Transaction Trace mounts the same pinned dock", () => {
    const trace = read("../pages/TransactionTracePage.jsx");
    expect(trace).toMatch(/<ReelDock\s*\/>/);
    expect(trace).toContain('import ReelDock from "../components/ReelDock"');
  });

  // The collapse toggle added the second piece of hide-the-reel state in this
  // codebase. The first one persisted, and hid the reel in one browser profile
  // permanently (#1896). This one must default to EXPANDED and never reach
  // storage, so a reload always brings the reel back.
  test("ReelDock defaults to expanded and never persists collapsed", () => {
    const dock = read("../components/ReelDock.jsx");
    expect(dock).toMatch(/useState\(false\)/);
    expect(dock).not.toMatch(/localStorage|sessionStorage/);
  });

  // .tcfs is display:contents, so the reel cannot lay itself out — every pinned
  // mount needs this host, and it is now written once instead of three times.
  test("ReelDock owns the sticky host markup", () => {
    const dock = read("../components/ReelDock.jsx");
    expect(dock).toContain("tcfs-float-host");
    expect(p2026).not.toContain('className="tcfs-float-host"');
  });

  // The live canary skips its reel assertion when the dashboard on screen has no
  // reel by design, and it tells the two apart by `.customer-skin-p1`. That is
  // the ONLY class that separates them: the roots are otherwise near-identical
  // and the CLASSIC dashboard also carries user-dashboard--2026,
  // refined-customer-surface and data-rd-v2. The first version of that gate used
  // user-dashboard--2026 and would have skipped nothing, leaving the canary red
  // on every run. If either assertion below fails, fix the canary's selector in
  // scripts/canary/uc1-canary.js in the same commit.
  test("customer-skin-p1 marks the Ping2026 dashboard and ONLY it", () => {
    expect(classic).not.toContain("customer-skin-p1");
    expect(p2026).toContain("customer-skin-p1 user-dashboard user-dashboard--2026");
  });

  test("the clinical-split root is also skin-p1, so the canary must exclude it", () => {
    // It has no reel by design — the early return renders AgentClinicalHost only.
    expect(p2026).toContain("customer-skin-p1 user-dashboard user-dashboard--clinical-split");
  });
});
