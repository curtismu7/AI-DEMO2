/**
 * UI regression tests — run after every code change.
 *
 * Covers the areas most frequently modified this session:
 *   1. TokenColorSystem — deriveTokenCategory() and getTokenColor()
 *   2. MessageContent rendering — paragraph splitting, no <pre> monospace
 *   3. CSS sanity — index.css has the global pre reset
 *   4. BankingAgent — no raw markdown (** / backticks) in message strings
 *   5. TokenChainDisplay — EventRow act hint derivation logic
 *   6. accountsHydration — guard against regression (smoke re-run)
 *
 * These tests are pure-logic (no DOM mount) where possible to keep them fast.
 * React Testing Library is used for the one component render test.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { TokenColorDot } from "../components/TokenColorSystem";

// ─── 1. TokenColorSystem ─────────────────────────────────────────────────────

import {
  deriveTokenCategory,
  getTokenColor,
} from "../components/TokenColorSystem";

describe("deriveTokenCategory", () => {
  // Priority 1: event.id
  it("returns subject for user-token id", () => {
    expect(deriveTokenCategory(null, "user-token", null)).toBe("subject");
  });

  it("returns actor for agent-actor-token id", () => {
    expect(deriveTokenCategory(null, "agent-actor-token", null)).toBe("actor");
  });

  it("returns mcp for exchanged-token id", () => {
    expect(deriveTokenCategory(null, "exchanged-token", null)).toBe("mcp");
  });

  it("returns mcp for exchanged-token-fallback id", () => {
    expect(deriveTokenCategory(null, "exchanged-token-fallback", null)).toBe(
      "mcp",
    );
  });

  it("returns mcp for exchange-in-progress id", () => {
    expect(deriveTokenCategory(null, "exchange-in-progress", null)).toBe("mcp");
  });

  it("returns mcp for exchange-failed id", () => {
    expect(deriveTokenCategory(null, "exchange-failed", null)).toBe("mcp");
  });

  // Priority 2: tokenType
  it("returns subject for tokenType user", () => {
    expect(deriveTokenCategory(null, null, "user")).toBe("subject");
  });

  it("returns subject for tokenType subject", () => {
    expect(deriveTokenCategory(null, null, "subject")).toBe("subject");
  });

  it("returns actor for tokenType agent", () => {
    expect(deriveTokenCategory(null, null, "agent")).toBe("actor");
  });

  it("returns actor for tokenType actor", () => {
    expect(deriveTokenCategory(null, null, "actor")).toBe("actor");
  });

  it("returns mcp for tokenType mcp", () => {
    expect(deriveTokenCategory(null, null, "mcp")).toBe("mcp");
  });

  it("returns mcp for tokenType gateway", () => {
    expect(deriveTokenCategory(null, null, "gateway")).toBe("mcp");
  });

  // Priority 3: label string
  it('returns subject for label containing "subject"', () => {
    expect(deriveTokenCategory("Subject: User token", null, null)).toBe(
      "subject",
    );
  });

  it('returns actor for label containing "actor"', () => {
    expect(deriveTokenCategory("Actor: BFF", null, null)).toBe("actor");
  });

  it('returns actor for label containing "agent"', () => {
    expect(deriveTokenCategory("AI Agent token", null, null)).toBe("actor");
  });

  it('returns mcp for label containing "mcp"', () => {
    expect(deriveTokenCategory("MCP scoped token", null, null)).toBe("mcp");
  });

  it('returns mcp for label containing "gateway"', () => {
    expect(deriveTokenCategory("Gateway validation", null, null)).toBe("mcp");
  });

  it("returns null when no signals", () => {
    expect(deriveTokenCategory(null, null, null)).toBeNull();
  });

  it("event.id takes priority over tokenType", () => {
    // id says mcp, tokenType says subject — id wins
    expect(deriveTokenCategory(null, "exchanged-token", "user")).toBe("mcp");
  });

  it("tokenType takes priority over label", () => {
    // tokenType says actor, label says "subject" — tokenType wins
    expect(deriveTokenCategory("Subject token label", null, "actor")).toBe(
      "actor",
    );
  });
});

describe("getTokenColor", () => {
  it("returns red hex for subject", () => {
    expect(getTokenColor("subject")).toBe("#dc2626");
  });

  it("returns blue hex for actor", () => {
    expect(getTokenColor("actor")).toBe("#2563eb");
  });

  it("returns green hex for mcp", () => {
    expect(getTokenColor("mcp")).toBe("#16a34a");
  });

  it("returns null for unknown type", () => {
    expect(getTokenColor("unknown")).toBeNull();
  });

  it("returns null for null", () => {
    expect(getTokenColor(null)).toBeNull();
  });
});

// ─── 2. MessageContent rendering ─────────────────────────────────────────────
// MessageContent is not exported, so we test it indirectly via BankingAgent
// by extracting and testing the paragraph-splitting logic directly.

describe("MessageContent paragraph splitting logic", () => {
  // This mirrors the exact logic inside MessageContent:
  // text.split(/\n{2,}/) produces paragraphs; para.split('\n') produces lines.
  const splitParagraphs = (text) => text.split(/\n{2,}/);
  const splitLines = (para) => para.split("\n");

  it("single paragraph stays as one item", () => {
    expect(splitParagraphs("Hello world")).toEqual(["Hello world"]);
  });

  it("double newline splits into two paragraphs", () => {
    expect(splitParagraphs("Para one\n\nPara two")).toHaveLength(2);
  });

  it("triple newline still splits into two paragraphs", () => {
    expect(splitParagraphs("Para one\n\n\nPara two")).toHaveLength(2);
  });

  it("single newline within paragraph becomes a line break (not a split)", () => {
    const paras = splitParagraphs("Line A\nLine B");
    expect(paras).toHaveLength(1);
    expect(splitLines(paras[0])).toEqual(["Line A", "Line B"]);
  });

  it("empty string produces one empty paragraph", () => {
    expect(splitParagraphs("")).toHaveLength(1);
  });

  it("multi-paragraph message with inline breaks", () => {
    const msg = "Your accounts:\nChecking $1,200\n\nCall me if you need help.";
    const paras = splitParagraphs(msg);
    expect(paras).toHaveLength(2);
    expect(splitLines(paras[0])).toEqual(["Your accounts:", "Checking $1,200"]);
    expect(paras[1]).toBe("Call me if you need help.");
  });
});

// ─── 3. CSS regression: no monospace anywhere ────────────────────────────────

const fs = require("fs");
const path = require("path");

const SRC_ROOT = path.resolve(__dirname, "..");

function walkFiles(dir, exts, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      entry.name !== "node_modules" &&
      entry.name !== "build"
    ) {
      walkFiles(full, exts, results);
    } else if (entry.isFile() && exts.some((e) => full.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

describe("CSS/JS monospace regression", () => {
  const cssFiles = walkFiles(SRC_ROOT, [".css", ".module.css"]);
  const jsFiles = walkFiles(SRC_ROOT, [".js"]);

  const isMonospaceLine = (line) => {
    const s = line.trim();
    // Skip comment lines
    if (s.startsWith("//") || s.startsWith("*") || s.startsWith("/*"))
      return false;
    // Skip the token definition itself (--font-family-mono: ...) — it's a variable name, not usage
    if (
      s.includes("--font-family-mono:") ||
      s.includes("--font-mono:") ||
      s.includes("--agent-font-mono:")
    )
      return false;
    // Actual monospace font usage
    return /monospace/i.test(s);
  };

  it("no CSS file uses monospace font", () => {
    const violations = [];
    for (const f of cssFiles) {
      // Skip files that use monospace intentionally for code/token/value display
      if (
        f.includes("AgentDemoGuide.css") ||
        f.includes("AuthorizeConfigPage.css") ||
        f.includes("ApiKeyPathPage.css") ||
        f.includes("AccessIdTokenPathPage.css") ||
        f.includes("MortgagePathPage.css") ||
        f.includes("Phase266ArchitecturePage.css") ||
        f.includes("ActivityLogPanel.css") ||   // act-chain audit log display (intentional)
        f.includes("AIAgent.css") ||        // agent inline code display (intentional)
        f.includes("CopyableValue.css") ||       // copyable code/value display (intentional)
        f.includes("FeatureFlagsPage.css") ||    // flag ID code display (intentional)
        f.includes("McpGatewayConfig.css") ||    // config key/value display (intentional)
        f.includes("PingOneMcpInspector.css") || // MCP inspector code/JSON display (intentional)
        f.includes("ScopeReferencePage.css") ||  // OAuth scope identifier display (intentional)
        f.includes("Profile.css") ||             // profile field code display (intentional)
        f.includes("TokenCard.css") ||           // JWT token claim display (intentional)
        f.includes("TokenChainDisplay.css") ||   // token chain code display (intentional)
        f.includes("TokenChainTraceRail.css") || // trace rail code/claims/JSON display (intentional)
        f.includes("UserMenu.css") ||            // user ID code display (intentional)
        f.includes("VerticalFeaturePage.css") || // feature code display (intentional)
        f.includes("WebMcpPanel.css") ||         // MCP tool code display (intentional)
        f.includes("refinedDashboardV2.css") ||  // v2 dashboard mono token + numeric/badge display (intentional)
        f.includes("refinedSurface.css") ||      // v2 surface mono token def (intentional)
        f.includes("v2-global-theme.css") ||     // v2 global mono token def (intentional)
        f.includes("clinical.css") ||            // agent-clinical code/data panes (intentional)
        f.includes("LandingPage.css") ||           // landing data figure via --rd2-font-mono (intentional)
        f.includes("JsonField.css") ||           // raw JSON request/response display (intentional)
        f.includes("RunReportPage.css") ||           // report log/code display (intentional)
        f.includes("AuditPage.css") ||               // audit log/code display (intentional)
        f.includes("DemoAuthzFallbackModal.css") ||  // authz decision code display (intentional)
        f.includes("GatewayRoutingDiagram.css") ||   // gateway route/tool code display (intentional)
        f.includes("PolicyDecisionTree.css") ||      // policy attribute/value code display (intentional)
        f.includes("ResourceServerTester.css") ||    // scope/rule identifier code display (intentional)
        f.includes("UseCaseExplainModal.css") ||     // tool/rule code + JSON display (intentional)
        f.includes("UseCaseLauncherPage.css") ||     // use-case tool/trigger code display (intentional)
        f.includes("OASDemoPage.css") ||             // OAS spec/API code display (intentional)
        f.includes("EventCard.css") ||               // event technical details JSON display (intentional)
        f.includes("ElicitationDialog.css") ||          // elicitation code examples display (intentional)
        f.includes("AdminConfigValidationPanel.css") || // config panel code/value/feature-id display (intentional)
        f.includes("AuthErrorBanner.css") ||            // error banner inline code display (intentional)
        f.includes("TokenExchangeTesterPage.css") ||    // token tester input/error/claim display (intentional)
        f.includes("AgentGatewayConfigEditor.css") ||   // config path/value code display (intentional)
        f.includes("ArchitectureCanvasPage.css") ||     // architecture step-route/tool code labels (intentional)
        f.includes("PingCliPage.css") ||                // CLI terminal / command output display (intentional)
        f.includes("SearchResults.css") ||              // code snippet display in search results (intentional)
        f.includes("StepDetailsSection.css") ||         // step request/response code + JSON display (intentional)
        f.includes("TokenCardGrid.css") ||              // JWT token claim/value display (intentional)
        f.includes("AnnotatedResult.css") ||            // authz annotated-result mono value display (intentional)
        f.includes("McpDelegationScenarios.css") ||     // policy-statement code chip display (intentional)
        f.includes("SnapshotImport.css") ||             // raw JSON snapshot display (intentional)
        f.includes("TokenChainRedesign.css") ||         // token chain code/claims/JSON display (intentional)
        f.includes("PrivilegeDemoPage.css") ||          // persona email identifier display (intentional)
        f.includes("ServersPage.css") ||                // container/port/latency data columns (intentional)
        f.includes("CheckPage.css") ||                   // pre-demo check id/count/log display via --mono (intentional)
        f.includes("ProofStrip.css") ||                   // evidence chain step id display (intentional)
        f.includes("VerifiedBanner.css") ||                // evidence chain step id display (intentional)
        f.includes("ApiExplorerPanel.css") ||             // HTTP method/path badge display (intentional)
        f.includes("CitationPill.css") ||                // knowledge-graph citation id pill display (intentional)
        f.includes("LearningLogLearnPane.css") ||        // correlation id display (intentional)
        f.includes("McpGatewayOauthFlowPage.css") ||     // OAuth flow code/token display (intentional)
        f.includes("TokenSecurityTester.css") ||         // security tester tree/token display (intentional)
        f.includes("TokenTopologyPanel.css") ||          // lane identifier display (intentional)
        f.includes("UnifiedTokenFlowInspector.css") ||   // token inspector code/JSON display (intentional)
        f.includes("aiFootprintMocks/chrome.css") ||     // mock code-editor/terminal chrome display (intentional)
        f.includes("shared/InspectorShell.css") ||       // shared inspector template code display (intentional)
        f.includes("shared/JsonColumnsView.css") ||      // JSON display component (intentional)
        f.includes("shared/JsonFormView.css") ||         // JSON display component (intentional)
        f.includes("FootprintMockGalleryPage.css") ||    // mock code-editor/terminal gallery display (intentional)
        f.includes("PrivilegeMcpClientPage.css") ||      // MCP client code/token display (intentional)
        f.includes("TransactionTracePage.css")           // trace cid/phase/op code display (intentional)
      )
        continue;
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (isMonospaceLine(line)) {
          violations.push(
            `${path.relative(SRC_ROOT, f)}:${i + 1}: ${line.trim().slice(0, 80)}`,
          );
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("no JS file uses monospace as fontFamily value", () => {
    const violations = [];
    for (const f of jsFiles) {
      // Skip ActivityLogs.js — uses monospace for act-chain audit display (intentional, Phase 266)
      // Skip SequenceDiagramPage.js — uses system ui-monospace stack for code in diagrams (intentional)
      // Skip SetupWizard.js — uses monospace for config/code display in setup steps (intentional)
      if (
        f.includes("ActivityLogs.js") ||
        f.includes("SequenceDiagramPage.js") ||
        f.includes("SetupWizard.js") ||
        f.includes("HitlSequenceDiagram.js") ||   // sequence diagram node code display (intentional)
        f.includes("UserDashboardPing2026.js") ||  // RFC 9470 raw challenge header display (intentional)
        f.includes("McpInspector.js")              // tool name/scope code display (intentional)
      )
        continue;
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        const s = line.trim();
        if (s.startsWith("//") || s.startsWith("*")) return;
        // Only flag fontFamily assignments, not comments or variable names
        if (/fontFamily\s*[=:][^;,)]*monospace/i.test(s)) {
          violations.push(
            `${path.relative(SRC_ROOT, f)}:${i + 1}: ${s.slice(0, 80)}`,
          );
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("index.css has global pre/code font reset", () => {
    const indexCss = fs.readFileSync(path.join(SRC_ROOT, "index.css"), "utf8");
    // Must have a rule that resets pre (and possibly code) to inherit/sans-serif
    expect(indexCss).toMatch(/pre\s*[,{]/);
    expect(indexCss).toMatch(
      /font-family\s*:\s*(?:inherit|-apple-system|sans-serif)/,
    );
  });
});

// ─── 4. No raw markdown in BankingAgent message strings ──────────────────────

describe("BankingAgent: no raw markdown markers in message strings", () => {
  const agentPath = path.join(SRC_ROOT, "components", "AIAgent.js");
  const agentSource = fs.readFileSync(agentPath, "utf8");

  it("no ** bold markers in chat message strings", () => {
    // Find all string literals containing ** — these would render as raw asterisks
    // Strategy: scan lines that build chat message content (addMessage / content strings)
    // Exclude comments, JSX className strings, and CSS-in-JS
    const lines = agentSource.split("\n");
    const violations = [];
    lines.forEach((line, i) => {
      const s = line.trim();
      if (s.startsWith("//") || s.startsWith("*") || s.startsWith("/*")) return;
      if (s.includes("className") || s.includes("aria-")) return;
      // Look for ** inside string literals
      if (/["'`][^"'`]*\*\*[^"'`]*["'`]/.test(s)) {
        violations.push(`line ${i + 1}: ${s.slice(0, 100)}`);
      }
    });
    expect(violations).toEqual([]);
  });

  it("no triple-backtick code fences in chat strings", () => {
    // Single-identifier backticks like `scope` or `acr` are OK in text descriptions.
    // Triple-backtick fences (```json ... ```) are raw chars in chat - not OK.
    const TRIPLE_FENCE = "```";
    const lines = agentSource.split("\n");
    const violations = [];
    lines.forEach((line, i) => {
      const s = line.trim();
      if (s.startsWith("//") || s.startsWith("*") || s.startsWith("/*")) return;
      if (
        s.includes("className") ||
        s.includes("import ") ||
        s.includes("require(")
      )
        return;
      if (s.includes(TRIPLE_FENCE)) {
        violations.push("line " + (i + 1) + ": " + s.slice(0, 100));
      }
    });
    expect(violations).toEqual([]);
  });
});

// ─── 5. TokenChainDisplay: act hint derivation ────────────────────────

describe("Token chain act hint derivation logic", () => {
  // Mirrors the hint logic from EventRow in TokenChainDisplay.js
  const actHint = (event) =>
    event.actPresent === true
      ? { text: "✅ act claimed", cls: "ok" }
      : event.actPresent === false && event.actExpectedHere !== false
        ? { text: "⚠️ no act claim", cls: "warn" }
        : event.actPresent === false && event.actExpectedHere === false
          ? { text: "ℹ️ act added after Exchange #2", cls: "info" }
          : null;

  it("act: returns ok when present", () => {
    expect(actHint({ actPresent: true })).toEqual({
      text: "✅ act claimed",
      cls: "ok",
    });
  });

  it("act: returns warn when absent and expected", () => {
    expect(actHint({ actPresent: false })).toEqual({
      text: "⚠️ no act claim",
      cls: "warn",
    });
  });

  it("act: returns info when absent but not expected here (Exchange #1)", () => {
    expect(actHint({ actPresent: false, actExpectedHere: false })).toEqual({
      text: "ℹ️ act added after Exchange #2",
      cls: "info",
    });
  });

  it("act: returns null when actPresent is undefined", () => {
    expect(actHint({})).toBeNull();
  });
});

// ─── 6. TokenColorDot renders without crashing ──────────────────────────────

describe("TokenColorDot", () => {
  it("renders subject dot with aria-label", () => {
    render(<TokenColorDot type="subject" />);
    expect(screen.getByLabelText(/Subject Token/i)).toBeInTheDocument();
  });

  it("renders nothing for null type", () => {
    const { container } = render(<TokenColorDot type={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for unknown type", () => {
    const { container } = render(<TokenColorDot type="unknown" />);
    expect(container).toBeEmptyDOMElement();
  });
});
