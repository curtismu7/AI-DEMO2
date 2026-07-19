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

// Two-trace merge fixtures: a shared source->target edge across two synthetic
// traces must sum callCount, not overwrite it (first-write-wins would silently
// drop trace 2's calls). Distinguishable, non-symmetric counts (2 + 3 = 5) rule
// out a coincidental pass.
function makeTwoTraceOverview() {
  const mkTrace = (traceID, childCallCount, startBase) => {
    const mkRef = (spanID) => [{ refType: "CHILD_OF", traceID, spanID }];
    const spans = [
      {
        traceID, spanID: `${traceID}-root`, operationName: "GET /mcp",
        references: [], startTime: startBase, duration: 5000, tags: [], logs: [], processID: "p1",
      },
      ...Array.from({ length: childCallCount }, (_, i) => ({
        traceID, spanID: `${traceID}-c${i}`, operationName: `banking-call-${i + 1}`,
        references: mkRef(`${traceID}-root`), startTime: startBase + 1000 + i * 100,
        duration: 200, tags: [], logs: [], processID: "p2",
      })),
    ];
    return {
      traceID, spans,
      processes: { p1: { serviceName: "mcp-gateway" }, p2: { serviceName: "mcp-server" } },
    };
  };
  return {
    data: [
      mkTrace("overviewtraceA00000000000000001", 2, 1_000_000),
      mkTrace("overviewtraceB00000000000000002", 3, 2_000_000),
    ],
  };
}

describe("traceGraph model — multi-trace overview", () => {
  test("merges N traces into one graph: shared edge sums callCount across traces", () => {
    const overview = makeTwoTraceOverview();
    const g = buildGraph(overview, {});
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["mcp-gateway", "mcp-server"]);
    expect(g.edges).toHaveLength(1);
    const edge = g.edges[0];
    expect(edge.source).toBe("mcp-gateway");
    expect(edge.target).toBe("mcp-server");
    expect(edge.callCount).toBe(5); // 2 (trace A) + 3 (trace B)
    expect(edge.avgDurationMs).toBe(Math.round(edge.totalDurationMs / 5));
  });

  test("node callCount sums across traces too", () => {
    const overview = makeTwoTraceOverview();
    const g = buildGraph(overview, {});
    const gateway = g.nodes.find((n) => n.id === "mcp-gateway");
    // 1 root span per trace (2 traces) = 2 calls on mcp-gateway
    expect(gateway.callCount).toBe(2);
    const server = g.nodes.find((n) => n.id === "mcp-server");
    expect(server.callCount).toBe(5); // 2 + 3 child spans
  });

  test("traceId is empty for a multi-trace overview, set for a single trace", () => {
    const overview = makeTwoTraceOverview();
    expect(buildGraph(overview, {}).traceId).toBe("");
    const single = { data: [overview.data[0]] };
    expect(buildGraph(single, {}).traceId).toBe("overviewtraceA00000000000000001");
  });

  test("totalDurationMs spans the full window across all contributing traces", () => {
    const overview = makeTwoTraceOverview();
    const g = buildGraph(overview, {});
    // trace A starts at 1_000_000us, trace B's last child ends at
    // 2_000_000 + 1000 + 200*100 + 200 = 2_021_200us -> window ~1021.2ms
    expect(g.totalDurationMs).toBeGreaterThan(1000);
  });

  test("empty data array yields the same empty-graph shape as today's no-trace case", () => {
    const g = buildGraph({ data: [] }, {});
    expect(g).toEqual({ nodes: [], edges: [], totalDurationMs: 0, traceId: "", isCollapsed: false });
  });

  test("buildCollapsedGraph collapses a multi-trace overview the same way it collapses one trace", () => {
    const overview = makeTwoTraceOverview();
    const full = buildGraph(overview, {});
    const collapsed = buildCollapsedGraph(overview, {});
    expect(collapsed.isCollapsed).toBe(true);
    expect(collapsed.nodes.map((n) => n.id).sort()).toEqual(["Gateway", "MCP Servers"]);
    expect(collapsed.edges).toHaveLength(1);
    expect(collapsed.edges[0].callCount).toBe(5);
  });

  // The synthetic fixtures above prove the merge algebra; this proves it against
  // real captured Jaeger shapes — the two already-committed single-trace
  // fixtures combined into one payload, structurally identical to what
  // /overview/raw actually returns (many real traces, one response).
  test("a real multi-trace overview (both committed fixtures combined) yields nodes from every service in both traces", () => {
    const overview = { data: [agentFixture.data[0], chipFixture.data[0]] };
    const g = buildGraph(overview, {});
    const nodeIds = new Set(g.nodes.map((n) => n.id));
    const agentServices = new Set(
      Object.values(agentFixture.data[0].processes).map((p) => p.serviceName),
    );
    const chipServices = new Set(
      Object.values(chipFixture.data[0].processes).map((p) => p.serviceName),
    );
    // agent-service (from trace-agent-run.json) plus demo-api-server,
    // mcp-gateway, mcp-server, authz-server (from trace-chip-run.json).
    for (const svc of [...agentServices, ...chipServices]) {
      expect(nodeIds.has(svc)).toBe(true);
    }
  });
});
