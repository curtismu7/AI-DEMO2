import { buildGraph, buildCollapsedGraph } from "../traceGraph";
import chipFixture from "./fixtures/trace-chip-run.json";
import agentFixture from "./fixtures/trace-agent-run.json";

// The multi-service chip fixture (demo-api-server, mcp-gateway, mcp-server,
// authz-server) carries real cross-service hops and /as/token client spans, so
// it drives every assertion that needs edges. The single-service agent fixture
// drives the "one node, zero edges" case.
describe("traceGraph model", () => {
  test("buildGraph derives one node per service in the live fixture", () => {
    const g = buildGraph(chipFixture, {});
    const services = Object.values(chipFixture.data[0].processes).map((p) => p.serviceName);
    for (const svc of new Set(services)) {
      expect(g.nodes.find((n) => n.id === svc || n.rawServices?.includes(svc))).toBeDefined();
    }
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.isCollapsed).toBe(false);
  });

  test("edges connect known node ids and carry call counts", () => {
    const g = buildGraph(chipFixture, {});
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
      expect(e.callCount).toBeGreaterThan(0);
    }
  });

  test("collapsed graph merges to cluster-level nodes", () => {
    const full = buildGraph(chipFixture, {});
    const collapsed = buildCollapsedGraph(chipFixture, {});
    expect(collapsed.isCollapsed).toBe(true);
    expect(collapsed.nodes.length).toBeLessThanOrEqual(full.nodes.length);
  });

  test("token-exchange edges are classified as oauth exchangeKind", () => {
    const g = buildGraph(chipFixture, {});
    const oauthEdges = g.edges.filter((e) => e.exchangeKind === "oauth");
    // Only asserted when the fixture contains an /as/token call:
    const hasTokenCall = chipFixture.data[0].spans.some((s) =>
      (s.tags || []).some((t) => String(t.value).includes("/as/token")));
    if (hasTokenCall) expect(oauthEdges.length).toBeGreaterThan(0);
  });

  test("single-service trace yields one node and zero cross-service edges", () => {
    const services = new Set(
      Object.values(agentFixture.data[0].processes).map((p) => p.serviceName),
    );
    expect(services.size).toBe(1);
    const g = buildGraph(agentFixture, {});
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toHaveLength(0);
    expect(g.isCollapsed).toBe(false);
  });
});
