import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildFocusDiagram, FOCUS_GROUPS } from "./architectureFocus";

const REAL_MMD = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "docs",
    "diagrams",
    "architecture.mmd",
  ),
  "utf8",
);

// A shrunk stand-in for docs/diagrams/architecture.mmd's shape: two
// subgraphs, loose top-level nodes, cross-subgraph edges, a multi-line
// edge label (mirrors the real IntrospectionHealth->OIDC_AS edge), and
// classDef/class styling lines.
const SAMPLE = `flowchart TB
    AdminBrowser["Admin Browser"]

    subgraph UI["demo_api_ui"]
        direction TB
        Login["Login Component"]
        Dashboard["Admin Dashboard"]
    end

    subgraph API["demo_api_server"]
        direction TB
        AuthRoutes["/api/auth"]
    end

    AdminBrowser -->|"HTTPS"| UI
    Login -->|"redirect"| OIDC_AS
    AuthRoutes -->|"validate"| AuthMW
    AuthRoutes -->|"probe
multi-line label"| OIDC_AS

    classDef frontend fill:#eafaf1
    classDef backend fill:#fef9e7
    class UI,Login,Dashboard frontend
    class API,AuthRoutes backend
`;

describe("buildFocusDiagram", () => {
  it("keeps only the selected subgraph's own nodes", () => {
    const result = buildFocusDiagram(SAMPLE, "frontend");
    expect(result).toContain("Login");
    expect(result).toContain("Dashboard");
    expect(result).not.toContain("AuthRoutes");
  });

  it("keeps an edge whose only known endpoint is the focus subgraph itself", () => {
    const result = buildFocusDiagram(SAMPLE, "frontend");
    expect(result).toMatch(/AdminBrowser\s*-->\|"HTTPS"\|\s*UI/);
  });

  it("drops edges where neither endpoint is in the focus", () => {
    const result = buildFocusDiagram(SAMPLE, "frontend");
    expect(result).not.toMatch(/AuthRoutes\s*-->\s*AuthMW/);
  });

  it("joins a multi-line edge label and keeps the edge if one side is known", () => {
    const result = buildFocusDiagram(SAMPLE, "bff");
    expect(result).toMatch(
      /AuthRoutes\s*-->\|"probe multi-line label"\|\s*OIDC_AS/,
    );
  });

  it("filters class-list entries down to ids present in the focus", () => {
    const result = buildFocusDiagram(SAMPLE, "frontend");
    const classLine = result
      .split("\n")
      .find((l) => l.trim().startsWith("class "));
    expect(classLine).toMatch(/^class UI,Login,Dashboard frontend$/);
  });

  it("excludes the frontend UI subgraph from the bff focus", () => {
    const result = buildFocusDiagram(SAMPLE, "bff");
    expect(result).not.toContain("Login Component");
  });

  it("throws for an unknown focus key", () => {
    expect(() => buildFocusDiagram(SAMPLE, "nope")).toThrow();
  });
});

describe("buildFocusDiagram against the real architecture.mmd", () => {
  it.each(Object.keys(FOCUS_GROUPS))(
    "produces a non-trivial diagram for focus %s",
    (focusKey) => {
      const result = buildFocusDiagram(REAL_MMD, focusKey);
      expect(result.startsWith("flowchart TB")).toBe(true);
      // At least one real node and one real edge came through — not just
      // the flowchart header and comment.
      expect(result.split("\n").length).toBeGreaterThan(5);
    },
  );

  it("Frontend & Auth focus excludes BFF-only nodes", () => {
    const result = buildFocusDiagram(REAL_MMD, "frontend");
    expect(result).toContain("Login Component");
    expect(result).not.toContain("pingOneAuthorizeService.js");
  });

  it("PingOne Cloud focus excludes the K8s planned subgraph and Standards legend", () => {
    const result = buildFocusDiagram(REAL_MMD, "pingone");
    expect(result).not.toContain("Kubernetes cluster");
    expect(result).not.toContain("RFC 6749 — OAuth 2.0");
  });

  it("is dramatically smaller than the full source per focus", () => {
    const fullLineCount = REAL_MMD.split("\n").length;
    for (const focusKey of Object.keys(FOCUS_GROUPS)) {
      const result = buildFocusDiagram(REAL_MMD, focusKey);
      expect(result.split("\n").length).toBeLessThan(fullLineCount * 0.6);
    }
  });
});
