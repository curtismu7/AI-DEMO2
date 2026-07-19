import { buildGraph, buildCollapsedGraph } from "../traceGraph";
import chipFixture from "./fixtures/trace-chip-run.json";
import agentFixture from "./fixtures/trace-agent-run.json";

// Synthetic trace for the collapse-merge branch: neither committed fixture puts
// two services in the same SERVICE_CLUSTERS bucket, so buildCollapsedGraph's
// busiest-member-wins edge merge (traceGraph.js ~363-413) never runs against
// them. mcp-server and mcp-invest both map to 'MCP Servers', so a gateway that
// calls each of them produces two full-graph edges
// (mcp-gateway->mcp-server, mcp-gateway->mcp-invest) that must collapse into
// one Gateway->MCP Servers edge with summed callCount. mcp-server gets 3
// calls and mcp-invest gets 2 so the merge is exercised with distinguishable,
// non-symmetric counts (3 + 2 = 5), not a coincidental match.
function makeClusterMergeTrace() {
  const traceID = "clustermerge0000000000000000001";
  const mkRef = (spanID) => [{ refType: "CHILD_OF", traceID, spanID }];
  const spans = [
    {
      traceID,
      spanID: "gw-root",
      operationName: "GET /mcp",
      references: [],
      startTime: 1000000,
      duration: 5000,
      tags: [],
      logs: [],
      processID: "p1",
    },
    ...["srv1", "srv2", "srv3"].map((id, i) => ({
      traceID,
      spanID: id,
      operationName: `banking-call-${i + 1}`,
      references: mkRef("gw-root"),
      startTime: 1001000 + i * 100,
      duration: 200,
      tags: [],
      logs: [],
      processID: "p2",
    })),
    ...["inv1", "inv2"].map((id, i) => ({
      traceID,
      spanID: id,
      operationName: `invest-call-${i + 1}`,
      references: mkRef("gw-root"),
      startTime: 1002000 + i * 100,
      duration: 200,
      tags: [],
      logs: [],
      processID: "p3",
    })),
  ];
  return {
    data: [
      {
        traceID,
        spans,
        processes: {
          p1: { serviceName: "mcp-gateway" },
          p2: { serviceName: "mcp-server" },
          p3: { serviceName: "mcp-invest" },
        },
      },
    ],
  };
}

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

  test("collapse merges same-cluster edges, summing callCount from both full-graph edges", () => {
    const trace = makeClusterMergeTrace();
    const full = buildGraph(trace, {});
    const collapsed = buildCollapsedGraph(trace, {});

    const serverEdge = full.edges.find((e) => e.source === "mcp-gateway" && e.target === "mcp-server");
    const investEdge = full.edges.find((e) => e.source === "mcp-gateway" && e.target === "mcp-invest");
    expect(serverEdge?.callCount).toBe(3);
    expect(investEdge?.callCount).toBe(2);
    expect(full.edges.length).toBe(2);

    // Both targets map to the 'MCP Servers' cluster, so the two full-graph
    // edges must collapse into a single Gateway->MCP Servers edge.
    expect(collapsed.edges.length).toBeLessThan(full.edges.length);
    expect(collapsed.edges.length).toBe(1);

    const mergedEdge = collapsed.edges[0];
    expect(mergedEdge.source).toBe("Gateway");
    expect(mergedEdge.target).toBe("MCP Servers");
    expect(mergedEdge.callCount).toBe(serverEdge.callCount + investEdge.callCount);
  });
});
