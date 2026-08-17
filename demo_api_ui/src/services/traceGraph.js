/**
 * traceGraph.js — Derives a service dependency graph from raw Jaeger trace data.
 *
 * Ported from the ACP workforce portal's classic-script traceGraph.js into an ES
 * module for this demo. The ACP agent/Envoy/SPIRE topology (AGENT_CONFIGS,
 * intra-pod expansion, sidecar re-anchoring, JWKS/LDAP classification) is removed;
 * the generic span-derived node/edge derivation, status/outcome rollup, per-edge
 * aggregation, and cluster collapse are kept. Cluster grouping now comes from
 * SERVICE_CLUSTERS below instead of the deleted per-agent config.
 *
 * Consumes the raw Jaeger response `{ data: [trace, ...] }` — one trace (as
 * returned by `/traces/:id/raw`) or many (as returned by `/overview/raw`,
 * merged into a single graph) — and produces:
 *   buildGraph(jaegerResponse, opts)          → { nodes, edges, totalDurationMs, traceId, isCollapsed: false }
 *   buildCollapsedGraph(jaegerResponse, opts)  → same shape, isCollapsed: true
 */

// Display labels + cluster grouping for this demo's services. Unlisted
// services (future additions) fall through to their raw name in 'Other'.
const DISPLAY_LABELS = {
  'demo-api-server': 'App Backend (BFF)',
  'mcp-gateway': 'Agent Gateway',
  'mcp-server': 'AIDemo MCP Server',
  'mcp-resource-server': 'Investment MCP Server',
  'agent-service': 'AI Agent',
  'hitl-service': 'HITL Service',
  'authz-server': 'Authorization (PDP)',
};

const SERVICE_CLUSTERS = {
  'agent-service': 'Agent Runtime',
  'mcp-gateway': 'Gateway',
  'mcp-server': 'MCP Servers',
  'mcp-resource-server': 'MCP Servers',
  'demo-api-server': 'Core',
  'hitl-service': 'Core',
  'authz-server': 'Ping',
};

const CLUSTER_ORDER = ['Core', 'Agent Runtime', 'Gateway', 'MCP Servers', 'Ping', 'Other'];

function _tagsToObject(tags) {
  const obj = {};
  for (const tag of tags || []) obj[tag.key] = tag.value;
  return obj;
}

function _serviceName(traceData, span) {
  return traceData.processes?.[span.processID]?.serviceName || '?';
}

function _labelFor(rawService) {
  return DISPLAY_LABELS[rawService] || rawService;
}

function _clusterFor(rawService) {
  return SERVICE_CLUSTERS[rawService] || 'Other';
}

function _statusFor(tags, statusCode) {
  const code = typeof statusCode === 'number' ? statusCode : parseInt(statusCode, 10);
  const httpErr = Number.isFinite(code) && code >= 400;
  const otelErr = tags['otel.status_code'] === 'ERROR';
  const flagErr = tags['error'] === true || tags['error'] === 'true';
  return (httpErr || otelErr || flagErr) ? 'error' : 'ok';
}

// Reduced exchangeKind classifier (rule 4): only the kinds this demo's traces
// can produce. `oauth` when the request URL hits an OAuth token/authorize
// endpoint; `authz` when either endpoint service is the local PDP; otherwise
// unset (plain HTTP → solid line). ACP's jwks/ldap/id-jag/ciba branches are gone.
function _classifyExchange(childRaw, parentRaw, tags) {
  const url = tags['http.url'] || tags['url.full'] || tags['http.target'] || tags['url.path'] || '';
  if (/\/as\/token|\/as\/authorize|\/oauth/.test(String(url))) {
    return { role: 'OAuth', protocol: 'OAuth 2.0', kind: 'oauth' };
  }
  if (childRaw === 'authz-server' || parentRaw === 'authz-server') {
    return { role: 'Authorization', protocol: 'HTTPS', kind: 'authz' };
  }
  return { role: 'HTTP', protocol: 'HTTPS', kind: undefined };
}

// External OAuth authorization server (e.g. PingOne) reached by a client span.
// The AS is not instrumented, so it emits no server span and the token-exchange
// call surfaces only as a same-service client span — never a cross-service hop.
// Return the AS host so it can be modelled as an external node + oauth edge, the
// same way ACP synthesized external dependencies (Open-Meteo) from client-span
// URLs. Returns null when the URL is not an OAuth endpoint.
function _oauthEndpointHost(tags) {
  const url = tags['http.url'] || tags['url.full'] || tags['http.target'] || tags['url.path'] || '';
  const s = String(url);
  if (!/\/as\/token|\/as\/authorize|\/oauth/.test(s)) return null;
  try {
    return new URL(s).host || 'OAuth AS';
  } catch {
    return 'OAuth AS';
  }
}

// Shared per-span summary pushed onto both node.spans and edge.spans.
function _spanSummary(span, tags, traceData, traceMinStart) {
  const statusCode = tags['http.response.status_code'] ?? tags['http.status_code'];
  return {
    spanID: span.spanID,
    operationName: span.operationName,
    processName: _serviceName(traceData, span),
    durationMs: Math.round((span.duration || 0) / 1000),
    startTimeOffsetMs: Math.round((span.startTime - traceMinStart) / 1000),
    statusCode: statusCode !== undefined ? String(statusCode) : null,
    status: _statusFor(tags, statusCode),
    tags,
  };
}

/**
 * Merge one trace's spans into the shared nodeMap/edgeMap accumulators.
 * Called once per trace in the response; nodeMap/edgeMap persist across
 * calls so a node or edge shared by two traces sums its counts rather than
 * being overwritten. This is the exact per-trace body buildGraph always ran —
 * only the accumulator lifetime changed (was function-local, now shared
 * across N calls).
 */
function _accumulateTrace(traceData, nodeMap, edgeMap, globalMinStart) {
  const spans = traceData.spans || [];
  const spanIndex = {};
  for (const s of spans) spanIndex[s.spanID] = s;

  for (const span of spans) {
    const raw = _serviceName(traceData, span);
    if (!nodeMap[raw]) {
      nodeMap[raw] = {
        id: raw,
        label: _labelFor(raw),
        cluster: _clusterFor(raw),
        isSynthetic: false,
        rawServices: new Set(),
        callCount: 0,
        totalDurationMs: 0,
        operationCounts: {},
        spans: [],
        status: 'ok',
        _hasOk: false,
        _hasError: false,
      };
    }
    const node = nodeMap[raw];
    node.rawServices.add(raw);
    node.callCount++;
    node.totalDurationMs += Math.round((span.duration || 0) / 1000);
    node.operationCounts[span.operationName] = (node.operationCounts[span.operationName] || 0) + 1;

    const tags = _tagsToObject(span.tags);
    const statusCode = tags['http.response.status_code'] ?? tags['http.status_code'];
    const status = _statusFor(tags, statusCode);
    if (status === 'error') node._hasError = true;
    else node._hasOk = true;

    node.spans.push(_spanSummary(span, tags, traceData, globalMinStart));
  }

  for (const span of spans) {
    const childRaw = _serviceName(traceData, span);
    const tags = _tagsToObject(span.tags);

    const asHost = _oauthEndpointHost(tags);
    if (asHost && tags['span.kind'] === 'client') {
      if (!nodeMap[asHost]) {
        nodeMap[asHost] = {
          id: asHost,
          label: _labelFor(asHost),
          cluster: _clusterFor(asHost),
          isSynthetic: true,
          rawServices: [`${asHost} (external)`],
          callCount: 0,
          totalDurationMs: 0,
          operationCounts: {},
          spans: [],
          status: 'ok',
        };
      }
      const oauthKey = `${childRaw}->${asHost}#oauth`;
      if (!edgeMap[oauthKey]) {
        edgeMap[oauthKey] = {
          source: childRaw,
          target: asHost,
          sourceLabel: _labelFor(childRaw),
          targetLabel: _labelFor(asHost),
          role: 'OAuth',
          protocol: 'OAuth 2.0',
          exchangeKind: 'oauth',
          callCount: 0,
          totalDurationMs: 0,
          outcomes: {},
          spans: [],
          isSynthetic: false,
        };
      }
      const oauthEdge = edgeMap[oauthKey];
      oauthEdge.callCount++;
      oauthEdge.totalDurationMs += Math.round((span.duration || 0) / 1000);
      const oauthStatusCode = tags['http.response.status_code'] ?? tags['http.status_code'];
      if (oauthStatusCode !== undefined) {
        const k = String(oauthStatusCode);
        oauthEdge.outcomes[k] = (oauthEdge.outcomes[k] || 0) + 1;
      }
      oauthEdge.spans.push(_spanSummary(span, tags, traceData, globalMinStart));
      continue;
    }

    if (tags['otel.scope.name'] === 'fastmcp') continue;

    const parentRef = (span.references || []).find(r => r.refType === 'CHILD_OF');
    if (!parentRef) continue;
    const parentSpan = spanIndex[parentRef.spanID];
    if (!parentSpan) continue;
    const parentRaw = _serviceName(traceData, parentSpan);
    if (parentRaw === childRaw) continue;

    const meta = _classifyExchange(childRaw, parentRaw, tags);
    const edgeKey = `${parentRaw}->${childRaw}`;
    if (!edgeMap[edgeKey]) {
      edgeMap[edgeKey] = {
        source: parentRaw,
        target: childRaw,
        sourceLabel: _labelFor(parentRaw),
        targetLabel: _labelFor(childRaw),
        role: meta.role,
        protocol: meta.protocol,
        exchangeKind: meta.kind,
        callCount: 0,
        totalDurationMs: 0,
        outcomes: {},
        spans: [],
        isSynthetic: false,
      };
    }
    const edge = edgeMap[edgeKey];
    edge.callCount++;
    edge.totalDurationMs += Math.round((span.duration || 0) / 1000);

    const statusCode = tags['http.response.status_code'] ?? tags['http.status_code'];
    if (statusCode !== undefined) {
      const key = String(statusCode);
      edge.outcomes[key] = (edge.outcomes[key] || 0) + 1;
    }

    edge.spans.push(_spanSummary(span, tags, traceData, globalMinStart));
  }
}

/**
 * Build nodes and edges from the raw Jaeger response — one trace or many.
 * Returns { nodes, edges, totalDurationMs, traceId, isCollapsed: false }.
 * traceId is set only when the response carries exactly one trace.
 */
function buildGraph(jaegerResponse, opts = {}) {
  const traces = (Array.isArray(jaegerResponse?.data) ? jaegerResponse.data : []).filter(Boolean);
  if (traces.length === 0) {
    return { nodes: [], edges: [], totalDurationMs: 0, traceId: '', isCollapsed: false };
  }

  let globalMinStart = Infinity;
  let globalMaxEnd = -Infinity;
  for (const traceData of traces) {
    for (const s of traceData.spans || []) {
      if (s.startTime < globalMinStart) globalMinStart = s.startTime;
      const end = s.startTime + s.duration;
      if (end > globalMaxEnd) globalMaxEnd = end;
    }
  }
  if (!Number.isFinite(globalMinStart)) globalMinStart = 0;

  const nodeMap = {};
  const edgeMap = {};
  for (const traceData of traces) {
    _accumulateTrace(traceData, nodeMap, edgeMap, globalMinStart);
  }

  for (const node of Object.values(nodeMap)) {
    node.rawServices = [...node.rawServices].sort();
    node.spans.sort((a, b) => a.startTimeOffsetMs - b.startTimeOffsetMs);
    if (node._hasError && node._hasOk) node.status = 'mixed';
    else if (node._hasError) node.status = 'error';
    else node.status = 'ok';
    delete node._hasOk;
    delete node._hasError;
  }

  for (const edge of Object.values(edgeMap)) {
    edge.avgDurationMs = edge.callCount > 0
      ? Math.round(edge.totalDurationMs / edge.callCount)
      : 0;
    edge.spans.sort((a, b) => a.startTimeOffsetMs - b.startTimeOffsetMs);
  }

  const totalDurationMs = (Number.isFinite(globalMaxEnd) && globalMaxEnd > globalMinStart)
    ? Math.round((globalMaxEnd - globalMinStart) / 1000)
    : 0;
  const nodes = Object.values(nodeMap);
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = Object.values(edgeMap).filter(
    e => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  return {
    nodes,
    edges,
    totalDurationMs,
    traceId: traces.length === 1 ? (traces[0].traceID || '') : '',
    isCollapsed: false,
  };
}

/**
 * Build a simplified graph where each service is collapsed to its cluster node.
 * The collapsed node id IS the cluster name (from SERVICE_CLUSTERS). Intra-cluster
 * edges are dropped; inter-cluster edges are re-mapped and aggregated.
 */
function buildCollapsedGraph(jaegerResponse, opts = {}) {
  const traces = (Array.isArray(jaegerResponse?.data) ? jaegerResponse.data : []).filter(Boolean);
  if (traces.length === 0) return { nodes: [], edges: [], totalDurationMs: 0, traceId: '', isCollapsed: true };

  const full = buildGraph(jaegerResponse, opts);
  const { nodes: fullNodes, edges: fullEdges, totalDurationMs, traceId } = full;

  // Map each full-graph node id (raw service or external host) to its cluster,
  // already resolved onto node.cluster in buildGraph.
  const rawToCluster = {};
  for (const n of fullNodes) rawToCluster[n.id] = n.cluster;

  const clusterNodeMap = {};
  for (const n of fullNodes) {
    const cid = n.cluster;
    if (!clusterNodeMap[cid]) {
      clusterNodeMap[cid] = {
        id: cid,
        label: cid,
        cluster: cid,
        isSynthetic: false,
        isCollapsedCluster: true,
        rawServices: [],
        callCount: 0,
        totalDurationMs: 0,
        operationCounts: {},
        spans: [],
        status: 'ok',
        _hasOk: false,
        _hasError: false,
      };
    }
    const cn = clusterNodeMap[cid];
    cn.rawServices.push(...(n.rawServices || []));
    cn.callCount += n.callCount || 0;
    cn.totalDurationMs += n.totalDurationMs || 0;
    if (n.status === 'error') cn._hasError = true;
    else if (n.status === 'mixed') { cn._hasError = true; cn._hasOk = true; }
    else cn._hasOk = true;
  }

  const collapsedNodes = Object.values(clusterNodeMap);
  for (const cn of collapsedNodes) {
    cn.status = (cn._hasError && cn._hasOk) ? 'mixed' : cn._hasError ? 'error' : 'ok';
    delete cn._hasOk;
    delete cn._hasError;
  }

  // Edge collapse — kept from the source: re-map each edge's endpoints to their
  // cluster, drop intra-cluster edges, and let the busiest member deterministically
  // win the displayed role/protocol/exchangeKind (independent of span order).
  const collapsedEdgeMap = {};
  for (const edge of fullEdges) {
    const src = rawToCluster[edge.source] || edge.source;
    const tgt = rawToCluster[edge.target] || edge.target;
    if (src === tgt) continue;

    const key = `${src}->${tgt}`;
    if (!collapsedEdgeMap[key]) {
      collapsedEdgeMap[key] = {
        source: src,
        target: tgt,
        sourceLabel: src,
        targetLabel: tgt,
        role: edge.role,
        protocol: edge.protocol,
        // Carry the dash kind through the collapse so OAuth/authz edges render
        // dashed in collapsed mode too.
        exchangeKind: edge.exchangeKind,
        callCount: edge.callCount,
        totalDurationMs: edge.totalDurationMs,
        avgDurationMs: edge.avgDurationMs,
        outcomes: { ...edge.outcomes },
        spans: [...edge.spans],
        isSynthetic: edge.isSynthetic || false,
        // Track the busiest member so a heavier member wins the displayed
        // role/protocol instead of first-writer-wins by span order.
        _roleCallCount: edge.callCount,
      };
    } else {
      const ce = collapsedEdgeMap[key];
      if (edge.callCount > ce._roleCallCount) {
        ce.role = edge.role;
        ce.protocol = edge.protocol;
        ce.exchangeKind = edge.exchangeKind;
        ce._roleCallCount = edge.callCount;
      }
      ce.callCount += edge.callCount;
      ce.totalDurationMs += edge.totalDurationMs;
      ce.isSynthetic = ce.isSynthetic && (edge.isSynthetic || false);
      for (const [code, count] of Object.entries(edge.outcomes || {})) {
        ce.outcomes[code] = (ce.outcomes[code] || 0) + count;
      }
      ce.spans.push(...edge.spans);
    }
  }

  for (const edge of Object.values(collapsedEdgeMap)) {
    edge.avgDurationMs = edge.callCount > 0 ? Math.round(edge.totalDurationMs / edge.callCount) : 0;
    edge.spans.sort((a, b) => a.startTimeOffsetMs - b.startTimeOffsetMs);
    delete edge._roleCallCount;
  }

  const collapsedNodeIds = new Set(collapsedNodes.map(n => n.id));
  const collapsedEdges = Object.values(collapsedEdgeMap).filter(
    e => collapsedNodeIds.has(e.source) && collapsedNodeIds.has(e.target)
  );

  return { nodes: collapsedNodes, edges: collapsedEdges, totalDurationMs, traceId, isCollapsed: true };
}

export { buildGraph, buildCollapsedGraph, SERVICE_CLUSTERS, CLUSTER_ORDER };
