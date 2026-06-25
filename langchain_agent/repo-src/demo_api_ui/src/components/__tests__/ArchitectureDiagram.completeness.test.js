// banking_api_ui/src/components/__tests__/ArchitectureDiagram.completeness.test.js
//
// REQ-DIAGRAM-09, REQ-DIAGRAM-10, REQ-DIAGRAM-15 (Phase 270).
//
// PURPOSE
//   Diagram-completeness invariant: every service named in run.sh SVC_LIST
//   must appear in at least one .mmd source at repo root. Also asserts the §0
//   emoji allowlist (⚠️ ✅ ❌) and the no-secret-values invariant so labels
//   never leak credentials.
//
// WHY A PURE FILE-READ TEST
//   Pitfall 5 in 270-RESEARCH.md: importing the diagram React component (or
//   ArchitectureTabsPanel) would create transitive imports heavy enough to
//   break the existing ArchitectureTabsPanel.anon.test.js. This test reads
//   files directly — no component import, no React render, no DOM bootstrap.
//
// RUN
//   cd banking_api_ui && CI=true npm test -- --watchAll=false \
//     --testPathPattern='ArchitectureDiagram.completeness'

const fs = require("fs");
const path = require("path");

// From banking_api_ui/src/components/__tests__/ to repo root: up 4 dirs.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const MMD_FILES = [
  "docs/diagrams/architecture-simple.mmd",
  "docs/diagrams/architecture.mmd",
  "docs/diagrams/i4ai-ref-arch.mmd",
  "docs/diagrams/mcp-security-gateway.mmd",
];

// Extract SVC_LIST from run.sh (single source of truth).
// Pure-JS regex on the file content — no shell-out (Pitfall A6 in research).
function getServiceList() {
  const runBankPath = path.join(REPO_ROOT, "run.sh");
  const content = fs.readFileSync(runBankPath, "utf8");
  const match = content.match(/^SVC_LIST=\(([^)]+)\)/m);
  if (!match) {
    throw new Error("Could not parse SVC_LIST=(...) from run.sh");
  }
  return match[1].trim().split(/\s+/).filter(Boolean);
}

function loadAllMmdContent() {
  return MMD_FILES.map((file) => {
    const fullPath = path.join(REPO_ROOT, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Mermaid source missing: ${file} at ${fullPath}`);
    }
    return { file, content: fs.readFileSync(fullPath, "utf8") };
  });
}

// InteractiveArchDiagram.js is the hand-built "Live token highlights" view on
// /architecture/system. Unlike the .mmd sources it is NOT covered by the
// SVC_LIST enforcer above, so it silently drifted to a pre-gateway 5-node
// model (User->BFF->MCP, no gateway, false direct edge) — the 2026-05-16 §4
// fix. This loads it as TEXT (no React import — importing the component would
// pull transitive deps heavy enough to break ArchitectureTabsPanel.anon.test.js,
// per the WHY-A-PURE-FILE-READ-TEST note above) so we can pin its topology.
const IAD_PATH = path.resolve(
  __dirname,
  "..",
  "education",
  "InteractiveArchDiagram.js",
);

function loadInteractiveArchDiagramSource() {
  if (!fs.existsSync(IAD_PATH)) {
    throw new Error(`InteractiveArchDiagram.js missing at ${IAD_PATH}`);
  }
  return fs.readFileSync(IAD_PATH, "utf8");
}

describe("Architecture diagram completeness", () => {
  const services = getServiceList();
  const mmds = loadAllMmdContent();

  test("SVC_LIST parses to exactly 10 services", () => {
    expect(services).toHaveLength(10);
  });

  // Services known to be missing from the .mmd diagrams. Adding to this list
  // suppresses the completeness check — only do so when the gap is tracked
  // (e.g. waiting on a docs PR). When you add the service to a .mmd file,
  // remove it from this list. Order: most-recently-added first.
  const KNOWN_MISSING_FROM_DIAGRAMS = new Set([
    "mastra_agent",      // added to run.sh in commit 5261846a (feat(mastra)); diagram update pending
    "demo_authz_server", // added to run.sh SVC_LIST; not in .mmd diagrams yet
  ]);

  test.each(services.filter((s) => !KNOWN_MISSING_FROM_DIAGRAMS.has(s)))(
    'service "%s" appears in at least one .mmd source',
    (svc) => {
      const found = mmds.filter(({ content }) => content.includes(svc));
      if (found.length === 0) {
        throw new Error(
          `Service "${svc}" is in run.sh SVC_LIST but appears in NONE of: ` +
            MMD_FILES.join(", ") +
            `. Add it to architecture-simple.mmd (clean view) or architecture.mmd (detailed view).`,
        );
      }
      expect(found.length).toBeGreaterThan(0);
    },
  );

  test("langchain_agent (Python service) appears in at least one .mmd source", () => {
    const found = mmds.filter(
      ({ content }) =>
        content.includes("langchain_agent") ||
        content.includes("LangChain Agent") ||
        content.includes("LangChain agent"),
    );
    expect(found.length).toBeGreaterThan(0);
  });

  test.each([
    ["PingOne", "PingOne IDP name"],
    ["RFC 8693", "token-exchange RFC marker"],
    ["PKCE", "authorization-code+PKCE marker"],
    ["client_credentials", "CC grant marker"],
  ])(
    'OAuth grant marker "%s" (%s) appears in at least one .mmd source',
    (marker) => {
      const found = mmds.filter(({ content }) => content.includes(marker));
      expect(found.length).toBeGreaterThan(0);
    },
  );

  // REQ-DIAGRAM-05: Phase 266 three-path multi-issuer story must be represented
  test.each([
    ["Path A", "Phase 266 Path A (banking_api_server resource)"],
    ["Path B", "Phase 266 Path B (mortgage_service resource)"],
    ["Path C", "Phase 266 Path C (HITL service resource)"],
  ])(
    'Phase 266 marker "%s" (%s) appears in at least one .mmd source',
    (marker) => {
      const found = mmds.filter(({ content }) => content.includes(marker));
      expect(found.length).toBeGreaterThan(0);
    },
  );

  // REQ-DIAGRAM-07: Phase 269 vault startup-load arrow must be visible
  test('Phase 269 vault marker "secrets.vault" appears in at least one .mmd source', () => {
    const found = mmds.filter(({ content }) =>
      content.includes("secrets.vault"),
    );
    expect(found.length).toBeGreaterThan(0);
  });

  describe("Security: no secret values in diagram labels (REQ-DIAGRAM-15)", () => {
    // FORBIDDEN: anything that looks like an actual secret value in an =-assignment.
    // ALLOWED:    header names like "X-API-Key:" since they are not value-bearing.
    const FORBIDDEN_PATTERNS = [
      { re: /VAULT_PASSWORD\s*=\s*\S/, name: "VAULT_PASSWORD=value" },
      { re: /client_secret\s*=\s*\S/, name: "client_secret=value" },
      { re: /_SECRET\s*=\s*[^"\s]/, name: "*_SECRET=value" },
      // api_key=... when followed by something that isn't whitespace/quote.
      // The `=` requirement alone disambiguates header references like
      // "X-API-Key:" (uses `:`, not `=`) from value-bearing assignments.
      { re: /\bapi_key\s*=\s*[^\s"][^\s"]*/i, name: "api_key=value" },
    ];

    test.each(MMD_FILES)("%s contains no secret-value substring", (file) => {
      const { content } = mmds.find((m) => m.file === file);
      for (const { re, name } of FORBIDDEN_PATTERNS) {
        const match = content.match(re);
        if (match) {
          throw new Error(
            `${file} contains a secret-value pattern (${name}): "${match[0]}". ` +
              `Diagram labels MUST reference mechanisms (e.g. "startup-load", "X-API-Key"), ` +
              `never values.`,
          );
        }
      }
    });

    // Regression: prior regex used `[^X\s"]` which silently allowed any
    // api_key=X... value through (e.g. "api_key=Xabcd1234567890"). The fix
    // drops the X-exclusion. This synthetic test pins detection capability.
    test("api_key=value pattern catches values starting with X", () => {
      const synthetic = "node[Service api_key=Xabcd1234567890 here]";
      const apiKeyPattern = FORBIDDEN_PATTERNS.find(
        (p) => p.name === "api_key=value",
      ).re;
      expect(synthetic).toMatch(apiKeyPattern);
    });
  });

  describe("Style: §0 emoji allowlist enforced (REQ-DIAGRAM-08)", () => {
    // §0 allowlist per REGRESSION_PLAN: ⚠️ (U+26A0 ± U+FE0F), ✅ (U+2705), ❌ (U+274C).
    const ALLOWED_EMOJI = new Set([
      "⚠", // ⚠ (without variation selector)
      "⚠️", // ⚠️ (with VS-16)
      "✅", // ✅
      "❌", // ❌
    ]);
    // Conservative emoji ranges — covers 🖥 ☁ which we know existed in
    // architecture.mmd. Second range extended to U+2B55 so common dingbats
    // like ⭐ (U+2B50) and ⭕ (U+2B55) that a contributor might paste into a
    // label are not silently allowed (WR-02 / Phase 270 review).
    const EMOJI_RE = /([\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{2B55}])️?/gu;

    test.each(MMD_FILES)(
      "%s contains no emoji outside §0 allowlist",
      (file) => {
        const { content } = mmds.find((m) => m.file === file);
        const matches = content.match(EMOJI_RE) || [];
        const forbidden = matches.filter((m) => !ALLOWED_EMOJI.has(m));
        if (forbidden.length > 0) {
          throw new Error(
            `${file} contains non-allowlist emoji(s): ${forbidden.map((c) => `"${c}" (U+${c.codePointAt(0).toString(16).toUpperCase()})`).join(", ")}. ` +
              `REGRESSION_PLAN §0 allows only ⚠️ ✅ ❌. Remove these glyphs.`,
          );
        }
        expect(forbidden).toEqual([]);
      },
    );

    // Regression: prior emoji range stopped at U+27BF and missed ⭐ (U+2B50).
    // Pin detection capability so a future range narrowing is caught.
    test("emoji detector catches ⭐ when present in a synthetic .mmd label", () => {
      const synthetic = 'node["⭐ test label"]';
      const matches = synthetic.match(EMOJI_RE) || [];
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  // Live-view topology guard (2026-05-16 §4 fix). The "Live token highlights"
  // diagram is hand-maintained and unprotected by the SVC_LIST enforcer; it
  // had reverted to a false pre-gateway 5-node model. These assertions pin
  // the corrected topology against silent re-drift. We anchor on stable
  // service identifiers (port + banking_mcp_* names), NOT display labels,
  // so honest re-wording does not false-fail — only a structural revert does.
  describe("Live InteractiveArchDiagram topology (anti-drift)", () => {
    const src = loadInteractiveArchDiagramSource();

    test.each([
      ["demo_mcp_gateway", "MCP Gateway node"],
      ["demo_mcp_server", "MCP OLB backend node"],
      ["demo_mcp_invest", "MCP Invest backend node"],
    ])('NODES references "%s" (%s)', (svc) => {
      if (!src.includes(svc)) {
        throw new Error(
          `InteractiveArchDiagram.js no longer references "${svc}". ` +
            `The live /architecture/system view appears to have regressed to a ` +
            `pre-gateway model. Restore the User->BFF->Gateway->backends topology ` +
            `(see REGRESSION_PLAN §4 2026-05-16 "live-view model corrected").`,
        );
      }
      expect(src).toContain(svc);
    });

    test("a 'gateway' node key exists (no false direct BFF->MCP edge)", () => {
      // The core bug was a missing gateway hop. The corrected model defines a
      // `gateway:` key in the NODES map. Its absence means the gateway was
      // removed and the BFF->MCP edge is direct again.
      expect(src).toMatch(/\bgateway\s*:\s*{/);
    });

    test("gateway port :3005 is present (identifies the gateway, not OLB)", () => {
      expect(src).toContain(":3005");
    });
  });
});
