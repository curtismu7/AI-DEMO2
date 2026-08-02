'use strict';

const {
  buildTraceGraph,
  buildOverviewGraph,
  formatLatencyUs,
  spanHasError,
} = require('../../services/tracingGraph');

/** Minimal Jaeger trace fixture: bff -> gateway (child), gateway span errored. */
function fixtureTrace() {
  return {
    traceID: 'abc123',
    processes: {
      p1: { serviceName: 'demo-api-server' },
      p2: { serviceName: 'mcp-gateway' },
    },
    spans: [
      {
        traceID: 'abc123', spanID: 's1', processID: 'p1',
        operationName: 'POST /api/agent/run',
        startTime: 1000, duration: 50000, references: [], tags: [],
      },
      {
        traceID: 'abc123', spanID: 's2', processID: 'p2',
        operationName: 'mcp:tool',
        startTime: 2000, duration: 12000,
        references: [{ refType: 'CHILD_OF', traceID: 'abc123', spanID: 's1' }],
        tags: [{ key: 'error', type: 'bool', value: true }],
      },
    ],
  };
}

describe('formatLatencyUs', () => {
  it('formats sub-ms, ms, and seconds', () => {
    expect(formatLatencyUs(500)).toBe('<1ms');
    expect(formatLatencyUs(45000)).toBe('45ms');
    expect(formatLatencyUs(1850000)).toBe('1.9s');
  });
});

describe('spanHasError', () => {
  it('detects error tag and otel.status_code, tolerates missing tags', () => {
    expect(spanHasError({ tags: [{ key: 'error', value: true }] })).toBe(true);
    expect(spanHasError({ tags: [{ key: 'error', value: 'true' }] })).toBe(true);
    expect(spanHasError({ tags: [{ key: 'otel.status_code', value: 'ERROR' }] })).toBe(true);
    expect(spanHasError({ tags: [{ key: 'http.status_code', value: 200 }] })).toBe(false);
    expect(spanHasError({})).toBe(false);
  });
});

describe('buildTraceGraph', () => {
  it('maps spans to nodes and parent refs to edges', () => {
    const g = buildTraceGraph(fixtureTrace());
    expect(g.nodes).toEqual([
      { id: 's1', label: 'demo-api-server: POST /api/agent/run', latency: '50ms', status: 'ok' },
      { id: 's2', label: 'mcp-gateway: mcp:tool', latency: '12ms', status: 'error' },
    ]);
    expect(g.edges).toEqual([
      { source: 's1', target: 's2', label: 'mcp:tool' },
    ]);
  });

  it('returns empty graph for null/empty trace', () => {
    expect(buildTraceGraph(null)).toEqual({ nodes: [], edges: [] });
    expect(buildTraceGraph({ spans: [] })).toEqual({ nodes: [], edges: [] });
  });
});

describe('buildOverviewGraph', () => {
  it('aggregates services with friendly labels; error rolls up; latency is p50', () => {
    const g = buildOverviewGraph([fixtureTrace()]);
    expect(g.nodes).toEqual(
      expect.arrayContaining([
        { id: 'demo-api-server', label: 'BFF / API', latency: '50ms', status: 'ok' },
        { id: 'mcp-gateway', label: 'MCP Gateway', latency: '12ms', status: 'error' },
      ]),
    );
    expect(g.edges).toContainEqual(
      { source: 'demo-api-server', target: 'mcp-gateway', label: 'mcp:tool' },
    );
  });

  it('roots the graph with a synthetic Chat UI node when the BFF is present', () => {
    const g = buildOverviewGraph([fixtureTrace()]);
    expect(g.nodes[0]).toEqual({ id: 'chat-ui', label: 'Chat UI', latency: '', status: 'ok' });
    expect(g.edges[0]).toEqual({ source: 'chat-ui', target: 'demo-api-server', label: 'HTTPS' });
  });

  it('derives synthetic peer nodes (PingOne, LLM, Mortgage App) from client-span URLs', () => {
    const t = fixtureTrace();
    t.spans.push(
      {
        traceID: 'abc123', spanID: 's3', processID: 'p1',
        operationName: 'POST /as/token', startTime: 3000, duration: 320000,
        references: [{ refType: 'CHILD_OF', traceID: 'abc123', spanID: 's1' }],
        tags: [{ key: 'http.url', value: 'https://auth.pingone.com/env/as/token' }],
      },
      {
        traceID: 'abc123', spanID: 's4', processID: 'p2',
        operationName: 'POST /v1/chat/completions', startTime: 4000, duration: 900000,
        references: [{ refType: 'CHILD_OF', traceID: 'abc123', spanID: 's2' }],
        tags: [{ key: 'url.full', value: 'http://host.docker.internal:8090/v1/chat/completions' }],
      },
      {
        traceID: 'abc123', spanID: 's5', processID: 'p1',
        operationName: 'GET /api/rates', startTime: 5000, duration: 40000,
        references: [{ refType: 'CHILD_OF', traceID: 'abc123', spanID: 's1' }],
        tags: [
          { key: 'http.url', value: 'http://api-resource-server:8082/api/rates' },
          { key: 'error', value: true },
        ],
      },
    );
    const g = buildOverviewGraph([t]);
    expect(g.nodes).toEqual(
      expect.arrayContaining([
        { id: 'pingone', label: 'PingOne', latency: '320ms', status: 'ok' },
        { id: 'llm', label: 'LLM', latency: '900ms', status: 'ok' },
        { id: 'mortgage-app', label: 'Mortgage App', latency: '40ms', status: 'error' },
      ]),
    );
    expect(g.edges).toEqual(
      expect.arrayContaining([
        { source: 'demo-api-server', target: 'pingone', label: 'POST /as/token' },
        { source: 'mcp-gateway', target: 'llm', label: 'POST /v1/chat/completions' },
        { source: 'demo-api-server', target: 'mortgage-app', label: 'GET /api/rates' },
      ]),
    );
  });

  it('adds no peer nodes when spans carry no URL tags', () => {
    const g = buildOverviewGraph([fixtureTrace()]);
    const ids = g.nodes.map((n) => n.id);
    expect(ids).not.toContain('pingone');
    expect(ids).not.toContain('llm');
    expect(ids).not.toContain('mortgage-app');
  });

  it('dedupes repeated cross-service edges and keeps first label', () => {
    const t = fixtureTrace();
    const t2 = JSON.parse(JSON.stringify(t));
    t2.traceID = 'def456';
    t2.spans[1].operationName = 'mcp:other';
    const g = buildOverviewGraph([t, t2]);
    expect(g.edges.filter((e) => e.target === 'mcp-gateway')).toEqual([
      { source: 'demo-api-server', target: 'mcp-gateway', label: 'mcp:tool' },
    ]);
  });

  it('drops jaeger-all-in-one spans (Jaeger self-instrumentation)', () => {
    const t = fixtureTrace();
    t.processes.p9 = { serviceName: 'jaeger-all-in-one' };
    t.spans.push({
      traceID: 'abc123', spanID: 's9', processID: 'p9',
      operationName: 'getServices', startTime: 9000, duration: 1000,
      references: [{ refType: 'CHILD_OF', traceID: 'abc123', spanID: 's1' }],
      tags: [],
    });
    const g = buildOverviewGraph([t]);
    expect(g.nodes.map((n) => n.id)).not.toContain('jaeger-all-in-one');
    expect(g.edges.some((e) => e.target === 'jaeger-all-in-one')).toBe(false);
  });

  it('returns empty graph for no traces', () => {
    expect(buildOverviewGraph([])).toEqual({ nodes: [], edges: [] });
  });
});
