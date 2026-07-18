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
  it('aggregates services: error rolls up, latency is p50, cross-service edges labeled', () => {
    const g = buildOverviewGraph([fixtureTrace()]);
    expect(g.nodes).toEqual(
      expect.arrayContaining([
        { id: 'demo-api-server', label: 'demo-api-server', latency: '50ms', status: 'ok' },
        { id: 'mcp-gateway', label: 'mcp-gateway', latency: '12ms', status: 'error' },
      ]),
    );
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toEqual([
      { source: 'demo-api-server', target: 'mcp-gateway', label: 'mcp:tool' },
    ]);
  });

  it('dedupes repeated cross-service edges and keeps first label', () => {
    const t = fixtureTrace();
    const t2 = JSON.parse(JSON.stringify(t));
    t2.traceID = 'def456';
    t2.spans[1].operationName = 'mcp:other';
    const g = buildOverviewGraph([t, t2]);
    expect(g.edges).toEqual([
      { source: 'demo-api-server', target: 'mcp-gateway', label: 'mcp:tool' },
    ]);
  });

  it('returns empty graph for no traces', () => {
    expect(buildOverviewGraph([])).toEqual({ nodes: [], edges: [] });
  });
});
