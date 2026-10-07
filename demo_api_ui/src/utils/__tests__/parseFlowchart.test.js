import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlowchart } from "../parseFlowchart";

describe("parseFlowchart", () => {
  it("reads nested groups, labelled nodes, edge labels, chains and class colours", () => {
    const m = parseFlowchart(`---
title: T
---
flowchart TB
    subgraph API["demo_api_server  (Express)"]
        direction TB
        Auth["/api/auth\\nOAuth"]
        subgraph MW["Middleware"]
            JWT["authenticateToken<br/>JWT"]
        end
    end
    Browser["Browser"]
    Browser -->|"HTTPS"| API
    Browser -- plain label --> Auth
    Auth -.-> JWT --> Out{ok?}
    A & B --> Auth
    classDef backend fill:#fef9e7,stroke:#f39c12,color:#1a252f
    class API,Auth backend`);
    expect(m.groups).toEqual([
      { id: "API", label: "demo_api_server  (Express)", parent: null },
      { id: "MW", label: "Middleware", parent: "API" },
    ]);
    const byId = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
    expect(byId.Auth).toMatchObject({ label: "/api/auth\nOAuth", parent: "API" });
    expect(byId.JWT).toMatchObject({ label: "authenticateToken\nJWT", parent: "MW" });
    expect(byId.Out).toMatchObject({ label: "ok?", shape: "diamond" });
    expect(m.edges).toEqual([
      { from: "Browser", to: "API", label: "HTTPS", dashed: false },
      { from: "Browser", to: "Auth", label: "plain label", dashed: false },
      { from: "Auth", to: "JWT", label: "", dashed: true },
      { from: "JWT", to: "Out", label: "", dashed: false },
      { from: "A", to: "Auth", label: "", dashed: false },
      { from: "B", to: "Auth", label: "", dashed: false },
    ]);
    expect(m.classDefs.backend).toMatchObject({ fill: "#fef9e7", stroke: "#f39c12", color: "#1a252f" });
    expect(m.classOf).toEqual({ API: "backend", Auth: "backend" });
  });

  it("parses the real architecture.mmd without dropping its edges", () => {
    const src = readFileSync(resolve(process.cwd(), "public/architecture/architecture.mmd"), "utf8");
    const m = parseFlowchart(src);
    expect(m.groups.length).toBeGreaterThan(8);
    expect(m.nodes.length).toBeGreaterThan(60);
    expect(m.edges.length).toBeGreaterThanOrEqual(60);
    const ids = new Set([...m.nodes.map((n) => n.id), ...m.groups.map((g) => g.id)]);
    expect(m.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  });
});
