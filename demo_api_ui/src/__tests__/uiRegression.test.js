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
 * Everything here runs the REAL module or reads the REAL file. A test that re-implements the logic it
 * claims to cover (the old paragraph-splitting and act-hint "mirror" tests) stays green when the
 * product code changes, so those now render MessageContent and TokenChainDisplay themselves.
 */

import React from "react";
import { vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TokenColorDot } from "../components/TokenColorSystem";

// ─── 1. TokenColorSystem ─────────────────────────────────────────────────────

import {
  deriveTokenCategory,
  getTokenColor,
} from "../components/TokenColorSystem";
import { MessageContent } from "../components/agentResultPanels";
import TokenChainDisplay from "../components/TokenChainDisplay";

// TokenChainDisplay reads its events from context; the rest of this file never mounts it.
const mockChain = vi.hoisted(() => ({ events: [] }));
vi.mock("../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({
    events: mockChain.events,
    history: [],
    mcpToolCalls: [],
    mcpAuthMode: null,
    nlRoutingEvent: null,
    clearEvents: () => {},
    clearMcpToolCalls: () => {},
    resolvedIdentity: null,
  }),
}));
vi.mock("../context/EducationUIContext", () => ({ useEducationUIOptional: () => null }));
vi.mock("../hooks/useDraggablePanel", () => ({
  useDraggablePanel: () => ({ pos: { x: 0, y: 0 }, size: { width: 640, height: 420 }, handleDragStart: () => {}, createResizeHandler: () => () => {} }),
}));

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
// The real MessageContent (agentResultPanels.js) renders plain chat text through MarkdownContent.

describe("MessageContent paragraph rendering (real component)", () => {
  const paragraphs = (text) => {
    const { container } = render(<MessageContent text={text} />);
    return container.querySelectorAll("p");
  };

  it("single paragraph stays as one item", () => {
    const p = paragraphs("Hello world");
    expect(p).toHaveLength(1);
    expect(p[0].textContent).toBe("Hello world");
  });

  it("double newline splits into two paragraphs", () => {
    expect(paragraphs("Para one\n\nPara two")).toHaveLength(2);
  });

  it("triple newline still splits into two paragraphs", () => {
    expect(paragraphs("Para one\n\n\nPara two")).toHaveLength(2);
  });

  it("never renders a <pre> block for plain text (no monospace)", () => {
    const { container } = render(<MessageContent text={"Your accounts:\nChecking $1,200\n\nCall me if you need help."} />);
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).toContain("Call me if you need help.");
  });

  it("empty text renders nothing but does not throw", () => {
    const { container } = render(<MessageContent text="" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
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
  const jsFiles = walkFiles(SRC_ROOT, [".js", ".jsx"]);

  const isMonospaceLine = (line) => {
    const s = line.trim();
    // Skip comment lines
    if (s.startsWith("//") || s.startsWith("*") || s.startsWith("/*"))
      return false;
    // Skip a token DEFINITION (--font-mono: ..., --rd2-font-mono: ...) — the
    // whole point is that a mono stack is written down once, in a token.
    if (/^--[\w-]*mono[\w-]*\s*:/.test(s)) return false;
    // Actual monospace font usage
    return /monospace/i.test(s);
  };

  it("no CSS file uses monospace font", () => {
    const violations = [];
    for (const f of cssFiles) {
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

  // .jsx files used to be skipped entirely (walkFiles was given [".js"] only), so 36 inline monospace
  // fontFamily values in eight .jsx components were never seen. They are pinned here by count, measured on
  // this commit: the count may fall (delete or lower the line) and may not rise, and a new .jsx file gets none.
  const JSX_MONOSPACE_KNOWN = {
    "components/AdminTokenComplianceAudit.jsx": 1,
    "components/AgentClientSkin.jsx": 12,
    "components/ArchitectureTabsPanel.jsx": 4,
    "components/AuthorizeRulesPanel.jsx": 3,
    "components/BulkDecisionPanel.jsx": 2,
    "components/MockAuthzRulesPage.jsx": 8,
    "components/OAuthHealthDashboard.jsx": 5,
    "components/PacEditorLaunch.jsx": 1,
  };

  const monospaceFontFamilyByFile = () => {
    const byFile = {};
    for (const f of jsFiles) {
      // Skip ActivityLogs.js — uses monospace for act-chain audit display (intentional, Phase 266)
      // Skip SequenceDiagramPage.js — uses system ui-monospace stack for code in diagrams (intentional)
      // Skip SetupWizard.js — uses monospace for config/code display in setup steps (intentional)
      if (
        f.includes("ActivityLogs.js") ||
        f.includes("SequenceDiagramPage.js") ||
        f.includes("SetupWizard.js") ||
        f.includes("HitlSequenceDiagram.js") ||   // sequence diagram node code display (intentional)
        f.includes("UserDashboardPing2026.js")     // RFC 9470 raw challenge header display (intentional)
      )
        continue;
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        const s = line.trim();
        if (s.startsWith("//") || s.startsWith("*")) return;
        // Only flag fontFamily assignments, not comments or variable names
        if (/fontFamily\s*[=:][^;,)]*monospace/i.test(s)) {
          const rel = path.relative(SRC_ROOT, f).split(path.sep).join("/");
          (byFile[rel] ||= []).push(`${rel}:${i + 1}: ${s.slice(0, 80)}`);
        }
      });
    }
    return byFile;
  };

  it("no JS or JSX file uses monospace as fontFamily value (beyond the pinned .jsx list)", () => {
    const violations = [];
    for (const [rel, list] of Object.entries(monospaceFontFamilyByFile())) {
      if (list.length > (JSX_MONOSPACE_KNOWN[rel] || 0)) violations.push(...list);
    }
    expect(violations).toEqual([]);
  });

  it("the pinned .jsx monospace list is not stale — lower a count when its file is fixed", () => {
    const now = Object.fromEntries(Object.entries(monospaceFontFamilyByFile()).map(([f, l]) => [f, l.length]));
    expect(now).toEqual(JSX_MONOSPACE_KNOWN);
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
// EventRow's hint is rendered by the real TokenChainDisplay from the events in context.

describe("Token chain act hint (real TokenChainDisplay)", () => {
  const renderWith = (event) => {
    mockChain.events = [{ id: "user-token", label: "User token", status: "active", ...event }];
    return render(<TokenChainDisplay />);
  };

  afterEach(() => {
    mockChain.events = [];
  });

  it("act: shows ok when present", () => {
    renderWith({ actPresent: true });
    expect(screen.getByText("✅ act claimed")).toBeInTheDocument();
  });

  it("act: shows warn when absent and expected", () => {
    renderWith({ actPresent: false });
    expect(screen.getByText("⚠️ no act claim")).toBeInTheDocument();
  });

  it("act: shows info when absent but not expected here (Exchange #1)", () => {
    renderWith({ actPresent: false, actExpectedHere: false });
    expect(screen.getByText("ℹ️ act added after Exchange #2")).toBeInTheDocument();
  });

  it("act: shows no hint when actPresent is undefined", () => {
    renderWith({});
    expect(screen.queryByText(/act claimed|no act claim|act added after/)).toBeNull();
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
