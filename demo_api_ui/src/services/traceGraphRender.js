/**
 * traceGraphRender.js — Interactive D3 renderer for one trace's service graph.
 *
 * Ported from the ACP workforce portal's inline graph.html `<script>` (the
 * `(function () { … })()` block). Adapted for this demo:
 *   - `import * as d3 from "d3"` replaces the `/js/d3-bundle.js` global (`D3Graph`).
 *   - The dagre compound-cluster layout (which required a dagre bundle not present
 *     here) is replaced by a d3-force column layout keyed on `node.cluster` via
 *     `CLUSTER_ORDER` — the generic cluster machinery the brief calls for. All the
 *     ACP topology constants (SPIRE/ACME/PARTNER clusters, per-agent inner
 *     clusters, filter-chain sub-labels, hide-SPIRE toggle, RANK_HINTS) are gone.
 *   - The tooltip, dim, and zoom machinery are kept close to source but scoped to
 *     `containerEl` (no `document.getElementById`, no `window.*` panel globals).
 *   - The ACP detail panel (openNodePanel/openEdgePanel + spanRow builders) is
 *     replaced by the React side panel in TraceGraphView.jsx: node/edge clicks
 *     invoke the `onNodeClick`/`onEdgeClick` callbacks with the node/edge object.
 *
 * Contract:
 *   renderTraceGraph(containerEl, graphData, { onNodeClick, onEdgeClick }) → { destroy }
 * where `graphData` is a `buildGraph`/`buildCollapsedGraph` result and `destroy()`
 * stops the simulation, drops listeners, and empties `containerEl`.
 */
import * as d3 from "d3";
import { CLUSTER_ORDER } from "./traceGraph";

const NODE_H = 56;
const NODE_MIN_W = 120;
const NODE_PAD_X = 32;

// jsdom (and the browser before first paint) has no SVG text measurement, so we
// never call getComputedTextLength/getBBox — node/label widths are estimated
// from character count. ~7.4px per char at the 13px label size.
const CHAR_W = 7.4;

const STATUS_COLORS = {
  ok: "#10b981",
  error: "#ef4444",
  mixed: "#f59e0b",
};

// Edge dash patterns keyed by exchangeKind (set in traceGraph.js). Reduced from
// the ACP set: jwks/ldap dropped (no SPIRE/PingDS here), oauth/authz kept.
// Absent key → solid line (application data plane).
const EDGE_DASH = {
  oauth: "6 4", // medium dash — OAuth protocol (RFC 8693 exchange / discovery)
  authz: "4 2 1 2", // dash-dot — PDP sideband decision (Gateway → Authorization)
};

// Per-cluster palette (hex copied from the ACP file where a cluster maps
// naturally onto one of its trust domains). Clusters render generically from
// node.cluster; unknown clusters fall back to slate.
const CLUSTER_COLORS = {
  Core: { fill: "#1e293b", stroke: "#64748b", hover: "#94a3b8" },
  "Agent Runtime": { fill: "#1a0a2e", stroke: "#c084fc", hover: "#d8b4fe" },
  Gateway: { fill: "#0d2e2b", stroke: "#14b8a6", hover: "#2dd4bf" },
  "MCP Servers": { fill: "#0f2920", stroke: "#10b981", hover: "#34d399" },
  Ping: { fill: "#1e3a5f", stroke: "#3b82f6", hover: "#60a5fa" },
  Other: { fill: "#1e293b", stroke: "#334155", hover: "#64748b" },
};
const DEFAULT_CLUSTER_COLOR = { fill: "#1e293b", stroke: "#334155", hover: "#64748b" };

function clusterColor(cluster) {
  return CLUSTER_COLORS[cluster] || DEFAULT_CLUSTER_COLOR;
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Tooltip HTML builders (kept from source; field names adapted to Task 4's
// node/edge shape: node.totalSpans → node.spans.length, node.aggregateStatus →
// node.status; the ✗ dingbat swapped for the allowlisted ✕). ──────────────────
function outcomeBreakdownHtml(spans) {
  let okN = 0;
  let errN = 0;
  const okCodes = {};
  for (const s of spans || []) {
    if (s.status === "error") errN++;
    else okN++;
    if (s.statusCode) okCodes[s.statusCode] = (okCodes[s.statusCode] || 0) + 1;
  }
  const parts = [];
  if (okN > 0) {
    const codeStr = Object.keys(okCodes).filter((c) => /^[12]/.test(c)).sort().join(", ") || "ok";
    parts.push(`<span style="color:#10b981">✓ ${escHtml(codeStr)} ×${okN}</span>`);
  }
  if (errN > 0) {
    parts.push(`<span style="color:#ef4444">✕ errors ×${errN}</span>`);
  }
  return parts.join("  ");
}

function nodeTooltipHtml(node) {
  const ops = Object.entries(node.operationCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([op, n]) => `  ${escHtml(op)}  ×${n}`)
    .join("\n");
  const breakdown = outcomeBreakdownHtml(node.spans);
  const totalSpans = (node.spans || []).length;
  return `<strong>${escHtml(node.label)}</strong>
<span class="tracing-graph-tooltip-muted">${escHtml((node.rawServices || []).join(", "))}</span>
<hr class="tracing-graph-tooltip-hr">Spans: ${totalSpans}  ·  Total: ${node.totalDurationMs}ms${ops ? "\n" + ops : ""}${breakdown ? "\n" + breakdown : ""}
<hr class="tracing-graph-tooltip-hr"><span class="tracing-graph-tooltip-muted" style="font-size:10px">Click for span detail →</span>`;
}

function edgeTooltipHtml(edge) {
  const breakdown = outcomeBreakdownHtml(edge.spans);
  const srcLabel = edge.sourceLabel || edge.source;
  const tgtLabel = edge.targetLabel || edge.target;
  return `<strong>${escHtml(srcLabel)} → ${escHtml(tgtLabel)}</strong>
<hr class="tracing-graph-tooltip-hr">${escHtml(edge.role)}  ·  <span class="tracing-graph-tooltip-muted">${escHtml(edge.protocol)}</span>
Calls: ${edge.callCount}  ·  Avg: ${edge.avgDurationMs}ms${breakdown ? "\n" + breakdown : ""}
<hr class="tracing-graph-tooltip-hr"><span class="tracing-graph-tooltip-muted" style="font-size:10px">Click for span detail →</span>`;
}

// Trim a segment aimed from (fromX,fromY) toward a node centre so the arrowhead
// lands on the node's rectangle border instead of its centre.
function borderPoint(node, fromX, fromY) {
  const cx = node._cx;
  const cy = node._cy;
  const dx = fromX - cx;
  const dy = fromY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = node._w / 2 + 2;
  const hh = node._h / 2 + 2;
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * Render the trace graph into `containerEl`.
 * @param {HTMLElement} containerEl empty host element owned by the renderer.
 * @param {object} graphData buildGraph/buildCollapsedGraph result.
 * @param {{ onNodeClick?: Function, onEdgeClick?: Function }} handlers
 * @returns {{ destroy: () => void }}
 */
export function renderTraceGraph(containerEl, graphData, { onNodeClick, onEdgeClick } = {}) {
  const nodes = (graphData && graphData.nodes) || [];
  const edges = (graphData && graphData.edges) || [];

  // ── Tooltip (scoped to containerEl; positioned in the viewport via fixed) ──
  const tooltip = document.createElement("div");
  tooltip.className = "tracing-graph-tooltip tracing-graph-hidden";
  tooltip.setAttribute("data-tooltip", "");
  containerEl.appendChild(tooltip);

  function showTooltip(html, event) {
    tooltip.innerHTML = html;
    tooltip.classList.remove("tracing-graph-hidden");
    positionTooltip(event);
  }
  function positionTooltip(event) {
    const pad = 14;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    const w = tooltip.offsetWidth || 240;
    const h = tooltip.offsetHeight || 80;
    if (x + w > vw - 8) x = event.clientX - w - pad;
    if (y + h > vh - 8) y = event.clientY - h - pad;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }
  function hideTooltip() {
    tooltip.classList.add("tracing-graph-hidden");
  }

  // ── Node sizing (estimated — no DOM text measurement in jsdom) ────────────
  for (const node of nodes) {
    node._w = Math.max(NODE_MIN_W, Math.ceil(String(node.label).length * CHAR_W) + NODE_PAD_X + 12);
    node._h = NODE_H;
  }

  // ── Column layout by cluster (CLUSTER_ORDER), positions via d3-force ───────
  const presentClusters = [...new Set(nodes.map((n) => n.cluster))].sort(
    (a, b) => CLUSTER_ORDER.indexOf(a) - CLUSTER_ORDER.indexOf(b),
  );
  const colOf = {};
  presentClusters.forEach((c, i) => {
    colOf[c] = i;
  });
  const COL_W = 240;
  const canvasH = containerEl.clientHeight || 480;

  const colFill = {};
  const colCount = {};
  for (const n of nodes) colCount[colOf[n.cluster]] = (colCount[colOf[n.cluster]] || 0) + 1;
  for (const n of nodes) {
    const ci = colOf[n.cluster];
    colFill[ci] = colFill[ci] || 0;
    n.x = COL_W / 2 + ci * COL_W;
    n.y = canvasH / 2 + (colFill[ci] - (colCount[ci] - 1) / 2) * 100;
    colFill[ci]++;
  }

  const simulation = d3
    .forceSimulation(nodes)
    .force("x", d3.forceX((n) => COL_W / 2 + colOf[n.cluster] * COL_W).strength(1))
    .force("y", d3.forceY(canvasH / 2).strength(0.06))
    .force("collide", d3.forceCollide((n) => n._h / 2 + 26).strength(0.9))
    .force("charge", d3.forceManyBody().strength(-90))
    .stop();
  for (let i = 0; i < 220; i++) simulation.tick();

  for (const n of nodes) {
    n._cx = n.x;
    n._cy = n.y;
  }

  // ── Compute layout bounds → viewBox (default 900×480 when empty) ──────────
  const nodeById = {};
  for (const n of nodes) nodeById[n.id] = n;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n._cx - n._w / 2);
    minY = Math.min(minY, n._cy - n._h / 2);
    maxX = Math.max(maxX, n._cx + n._w / 2);
    maxY = Math.max(maxY, n._cy + n._h / 2);
  }
  const M = 60;
  let vbX = 0;
  let vbY = 0;
  let vbW = 900;
  let vbH = 480;
  if (Number.isFinite(minX)) {
    vbX = minX - M;
    vbY = minY - M;
    vbW = Math.max(maxX - minX + M * 2, 200);
    vbH = Math.max(maxY - minY + M * 2, 160);
  }

  // ── SVG scaffold ──────────────────────────────────────────────────────────
  const svgSel = d3
    .select(containerEl)
    .append("svg")
    .attr("class", "tracing-graph-svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  const svgEl = svgSel.node();

  // Arrow markers — one per palette stroke used, plus a hover marker.
  const markerColors = new Set([DEFAULT_CLUSTER_COLOR.stroke, "#94a3b8"]);
  for (const c of presentClusters) markerColors.add(clusterColor(c).stroke);
  const defs = svgSel.append("defs");
  const markerId = (hex) => `tg-arrow-${hex.replace("#", "")}`;
  for (const hex of markerColors) {
    defs
      .append("marker")
      .attr("id", markerId(hex))
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 9)
      .attr("refY", 0)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", hex);
  }

  const zoomGroup = svgSel.append("g").attr("class", "tracing-graph-zoom-group");

  // ── Dim machinery (kept from source; scoped to this render's selections) ──
  let allNodeGroups = null;
  let allEdgeGroups = null;
  function setDimmed(keepNodeIds, keepEdgeKeys) {
    if (!allNodeGroups || !allEdgeGroups) return;
    allNodeGroups.each(function () {
      const sel = d3.select(this);
      sel.classed("tracing-graph-dimmed", !keepNodeIds.has(sel.attr("data-node-id")));
    });
    allEdgeGroups.each(function () {
      const sel = d3.select(this);
      sel.classed("tracing-graph-dimmed", !keepEdgeKeys.has(sel.attr("data-edge-key")));
    });
  }
  function clearDimmed() {
    if (!allNodeGroups || !allEdgeGroups) return;
    allNodeGroups.classed("tracing-graph-dimmed", false);
    allEdgeGroups.classed("tracing-graph-dimmed", false);
  }

  // ── Edges (drawn before nodes so they sit underneath) ─────────────────────
  const edgeLayer = zoomGroup.append("g").attr("class", "tracing-graph-edges");
  for (const edge of edges) {
    const src = nodeById[edge.source];
    const tgt = nodeById[edge.target];
    if (!src || !tgt) continue;
    edge._key = `${edge.source}->${edge.target}`;

    const stroke = clusterColor(tgt.cluster).stroke;
    const isSyntheticEdge = !!edge.isSynthetic;
    const strokeW = isSyntheticEdge ? 1 : Math.min(5, 1.5 + Math.log2((edge.callCount || 0) + 1) * 0.6);
    // Dash encodes the exchange kind (oauth/authz); synthetic infra edges get a
    // short dash; plain application traffic stays solid.
    const dash = EDGE_DASH[edge.exchangeKind] ?? (isSyntheticEdge ? "5 4" : null);

    const s = borderPoint(src, tgt._cx, tgt._cy);
    const t = borderPoint(tgt, src._cx, src._cy);
    const pathD = `M${s.x},${s.y}L${t.x},${t.y}`;

    const eg = edgeLayer
      .append("g")
      .attr("class", "tracing-graph-edge-group")
      .attr("data-edge-key", edge._key);

    const pathEl = eg
      .append("path")
      .attr("class", "tracing-graph-edge-path")
      .attr("d", pathD)
      .attr("fill", "none")
      .attr("stroke", stroke)
      .attr("stroke-width", strokeW)
      .attr("stroke-dasharray", dash)
      .attr("marker-end", `url(#${markerId(stroke)})`);

    // Edge label — role over protocol, at the segment midpoint. Background sized
    // from a character estimate (no getBBox in jsdom).
    const midX = (s.x + t.x) / 2;
    const midY = (s.y + t.y) / 2;
    const labelG = eg.append("g").attr("class", "tracing-graph-edge-label").attr("transform", `translate(${midX},${midY})`);
    const labelW = Math.max(String(edge.role || "").length, String(edge.protocol || "").length) * 6.2 + 12;
    labelG
      .append("rect")
      .attr("class", "tracing-graph-edge-label-bg")
      .attr("x", -labelW / 2)
      .attr("y", -12)
      .attr("width", labelW)
      .attr("height", 24)
      .attr("rx", 3)
      .attr("fill", "#0f172a");
    labelG
      .append("text")
      .attr("text-anchor", "middle")
      .attr("y", -1)
      .attr("fill", "#e2e8f0")
      .attr("font-size", "11px")
      .text(edge.role);
    labelG
      .append("text")
      .attr("text-anchor", "middle")
      .attr("y", 9)
      .attr("fill", "#64748b")
      .attr("font-size", "9px")
      .text(edge.protocol);

    eg.on("mouseenter", function (event) {
      pathEl.attr("stroke", "#94a3b8").attr("stroke-width", strokeW + 1).attr("marker-end", `url(#${markerId("#94a3b8")})`);
      showTooltip(edgeTooltipHtml(edge), event);
    })
      .on("mousemove", (event) => positionTooltip(event))
      .on("mouseleave", function () {
        pathEl.attr("stroke", stroke).attr("stroke-width", strokeW).attr("marker-end", `url(#${markerId(stroke)})`);
        hideTooltip();
      })
      .on("click", function (event) {
        event.stopPropagation();
        hideTooltip();
        setDimmed(new Set([edge.source, edge.target]), new Set([edge._key]));
        if (onEdgeClick) onEdgeClick(edge);
      });
  }

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const nodeLayer = zoomGroup.append("g").attr("class", "tracing-graph-nodes");
  for (const node of nodes) {
    const colors = clusterColor(node.cluster);
    const ng = nodeLayer
      .append("g")
      .attr("class", "tracing-graph-node-group")
      .attr("data-node-id", node.id)
      .attr("transform", `translate(${node._cx - node._w / 2},${node._cy - node._h / 2})`);

    const rect = ng
      .append("rect")
      .attr("class", "tracing-graph-node-rect")
      .attr("width", node._w)
      .attr("height", node._h)
      .attr("rx", 8)
      .attr("fill", colors.fill)
      .attr("stroke", colors.stroke)
      .attr("stroke-width", 1.5);

    ng.append("text")
      .attr("class", "tracing-graph-node-label")
      .attr("x", node._w / 2)
      .attr("y", node._h / 2)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", "#f1f5f9")
      .attr("font-size", "13px")
      .attr("font-weight", "500")
      .text(node.label);

    // Status dot — top-right.
    ng.append("circle")
      .attr("cx", node._w - 9)
      .attr("cy", 9)
      .attr("r", 4)
      .attr("fill", STATUS_COLORS[node.status] || STATUS_COLORS.ok)
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 1.5);

    if (node.isCollapsedCluster) {
      // Collapsed cluster meta-nodes are not clickable for detail — just hover.
      ng.on("mouseenter", () => rect.attr("stroke", colors.hover).attr("stroke-width", 2)).on(
        "mouseleave",
        () => rect.attr("stroke", colors.stroke).attr("stroke-width", 1.5),
      );
    } else {
      ng.on("mouseenter", function (event) {
        rect.attr("stroke", colors.hover).attr("stroke-width", 2);
        showTooltip(nodeTooltipHtml(node), event);
      })
        .on("mousemove", (event) => positionTooltip(event))
        .on("mouseleave", function () {
          rect.attr("stroke", colors.stroke).attr("stroke-width", 1.5);
          hideTooltip();
        })
        .on("click", function (event) {
          event.stopPropagation();
          hideTooltip();
          setDimmed(new Set([node.id]), new Set());
          if (onNodeClick) onNodeClick(node);
        });
    }
  }

  allNodeGroups = zoomGroup.selectAll("g.tracing-graph-node-group");
  allEdgeGroups = zoomGroup.selectAll("g.tracing-graph-edge-group");

  // Click on empty canvas clears the highlight.
  svgSel.on("click", () => clearDimmed());

  // ── Zoom + controls ───────────────────────────────────────────────────────
  const zoomBehavior = d3
    .zoom()
    .scaleExtent([0.25, 3])
    .on("zoom", (event) => zoomGroup.attr("transform", event.transform));
  svgSel.call(zoomBehavior);

  const controls = document.createElement("div");
  controls.className = "tracing-graph-zoom";
  const mkBtn = (label, title, handler) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tracing-graph-zoom-btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", handler);
    controls.appendChild(b);
  };
  mkBtn("+", "Zoom in", () => svgSel.transition().duration(150).call(zoomBehavior.scaleBy, 1.3));
  mkBtn("−", "Zoom out", () => svgSel.transition().duration(150).call(zoomBehavior.scaleBy, 1 / 1.3));
  mkBtn("Reset", "Reset zoom", () => svgSel.transition().duration(200).call(zoomBehavior.transform, d3.zoomIdentity));
  containerEl.appendChild(controls);

  function destroy() {
    try {
      simulation.stop();
    } catch (_) {
      /* no-op */
    }
    svgSel.on(".zoom", null);
    svgSel.on("click", null);
    hideTooltip();
    // Removing the DOM subtree drops every d3/DOM listener attached above.
    while (containerEl.firstChild) containerEl.removeChild(containerEl.firstChild);
  }

  return { destroy };
}
