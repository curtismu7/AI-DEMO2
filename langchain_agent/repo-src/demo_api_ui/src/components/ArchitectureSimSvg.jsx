// demo_api_ui/src/components/ArchitectureSimSvg.jsx
import { memo } from 'react';

/**
 * Hand-coded SVG architecture diagram for the simulation page.
 *
 * viewBox: 0 0 1100 520
 * Node size: 130 × 52 px
 * Label font: 13px bold (name) + 10px (subtitle)
 *
 * Node IDs match architecture-sim-scenarios.js:
 *   n-browser, n-bff, n-mcp-gw, n-mcp-server, n-mcp-invest,
 *   n-agent, n-pingone, n-pingauthorize, n-hitl, n-mortgage, n-resource-server
 *
 * Edge IDs: e-{source}-{dest} e.g. e-browser-bff, e-bff-mcpgw, …
 */

// ── Layout constants ─────────────────────────────────────────────────────────
const NW = 130;  // node width
const NH = 52;   // node height
const NR = 7;    // border-radius

// Column x-origins
const COL = {
  browser:  20,
  bff:      200,
  mcpGw:    400,
  services: 620,
  external: 830,
};

// Row y-origins
const ROW = {
  top:    30,
  mid:   180,
  lower: 330,
  bot:   420,
};

// Node centre helpers
function cx(x) { return x + NW / 2; }
function cy(y) { return y + NH / 2; }

// Y level for edges that must cross above the resource-server row (ROW.lower = 330).
// n-mortgage bottom = ROW.mid + NH + 10 + NH = 294; resource server top = 330.
// ABOVE_RS sits in the clear gap between them.
const ABOVE_RS = 308;

// ── Colour palette ───────────────────────────────────────────────────────────
const STATE_STYLES = {
  idle: {
    fill: '#f1f5f9', stroke: '#cbd5e1', textFill: '#475569',
    shadow: 'none',
  },
  active: {
    fill: '#fffbeb', stroke: '#f59e0b', textFill: '#92400e',
    shadow: 'drop-shadow(0 0 8px rgba(245,158,11,0.6))',
  },
  done: {
    fill: '#f0fdf4', stroke: '#22c55e', textFill: '#166534',
    shadow: 'none',
  },
  blocked: {
    fill: '#fef2f2', stroke: '#ef4444', textFill: '#991b1b',
    shadow: 'drop-shadow(0 0 8px rgba(239,68,68,0.5))',
  },
};

const EDGE_COLORS = {
  idle:    '#cbd5e1',
  active:  '#f59e0b',
  done:    '#22c55e',
  blocked: '#ef4444',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SimNode({ id, x, y, label, sub, state = 'idle', tooltip }) {
  const s = STATE_STYLES[state] ?? STATE_STYLES.idle;
  const isActive  = state === 'active';
  const isDone    = state === 'done';
  const isBlocked = state === 'blocked';

  return (
    <g id={id} style={{ filter: isActive || isBlocked ? s.shadow : 'none' }}>
      {tooltip && <title>{tooltip}</title>}
      <rect
        x={x} y={y} width={NW} height={NH} rx={NR} ry={NR}
        fill={s.fill} stroke={s.stroke} strokeWidth={isActive || isDone || isBlocked ? 2 : 1.5}
      >
        {isActive && (
          <animate
            attributeName="stroke-opacity"
            values="1;0.4;1" dur="1s"
            repeatCount="indefinite"
          />
        )}
      </rect>
      <text x={cx(x)} y={y + (sub ? 20 : 28)} textAnchor="middle"
            fontSize={13} fontWeight={700} fill={s.textFill} fontFamily="system-ui,sans-serif">
        {label}
      </text>
      {sub && (
        <text x={cx(x)} y={y + 37} textAnchor="middle"
              fontSize={10} fill={s.textFill} fontFamily="system-ui,sans-serif" opacity={0.8}>
          {sub}
        </text>
      )}
      {isDone    && <text x={x + NW - 4} y={y - 2} fontSize={13} textAnchor="end">&#x2705;</text>}
      {isBlocked && <text x={x + NW - 4} y={y - 2} fontSize={13} textAnchor="end">&#x274C;</text>}
    </g>
  );
}

function SimEdge({ id, x1, y1, x2, y2, state = 'idle', markerId }) {
  const color = EDGE_COLORS[state] ?? EDGE_COLORS.idle;
  const isActive = state === 'active';

  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);

  return (
    <line
      id={id}
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={color} strokeWidth={isActive ? 2.5 : 1.5}
      markerEnd={`url(#${markerId})`}
      strokeDasharray={isActive ? len : undefined}
      strokeDashoffset={isActive ? len : undefined}
    >
      {isActive && (
        <animate
          attributeName="stroke-dashoffset"
          from={len} to={0}
          dur="0.7s"
          fill="freeze"
          key={`${id}-sweep`}
        />
      )}
    </line>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function ArchitectureSimSvg({ nodeStates = {}, edgeStates = {} }) {
  function ns(id) { return nodeStates[id] ?? 'idle'; }
  function es(id) { return edgeStates[id] ?? 'idle'; }

  function arrowId(state) {
    if (state === 'active')  return 'arr-active';
    if (state === 'done')    return 'arr-done';
    if (state === 'blocked') return 'arr-blocked';
    return 'arr-idle';
  }

  return (
    <svg
      viewBox="0 0 1100 520"
      width="100%"
      style={{ display: 'block', minWidth: 700 }}
      aria-label="Banking demo architecture diagram"
    >
      <defs>
        <marker id="arr-idle"    markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={EDGE_COLORS.idle}/>
        </marker>
        <marker id="arr-active"  markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={EDGE_COLORS.active}/>
        </marker>
        <marker id="arr-done"    markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={EDGE_COLORS.done}/>
        </marker>
        <marker id="arr-blocked" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={EDGE_COLORS.blocked}/>
        </marker>
      </defs>

      {/* ── Background labels ───────────────────────────────────────── */}
      <text x={cx(COL.browser)} y={ROW.top - 10} textAnchor="middle"
            fontSize={10} fill="#94a3b8" fontFamily="system-ui,sans-serif">Client</text>
      <text x={cx(COL.bff)} y={ROW.top - 10} textAnchor="middle"
            fontSize={10} fill="#94a3b8" fontFamily="system-ui,sans-serif">BFF</text>
      <text x={cx(COL.mcpGw)} y={ROW.top - 10} textAnchor="middle"
            fontSize={10} fill="#94a3b8" fontFamily="system-ui,sans-serif">MCP Layer</text>
      <text x={cx(COL.services)} y={ROW.top - 10} textAnchor="middle"
            fontSize={10} fill="#94a3b8" fontFamily="system-ui,sans-serif">Services</text>
      <text x={cx(COL.external)} y={ROW.top - 10} textAnchor="middle"
            fontSize={10} fill="#94a3b8" fontFamily="system-ui,sans-serif">PingOne / Authz</text>

      {/* ── Edges (drawn behind nodes) ─────────────────────────────── */}

      {/* browser ↔ bff */}
      <SimEdge id="e-browser-bff"
        x1={COL.browser + NW} y1={cy(ROW.top)}
        x2={COL.bff}          y2={cy(ROW.top)}
        state={es('e-browser-bff')} markerId={arrowId(es('e-browser-bff'))} />

      {/* bff → mcp-gw */}
      <SimEdge id="e-bff-mcpgw"
        x1={COL.bff + NW}  y1={cy(ROW.top)}
        x2={COL.mcpGw}     y2={cy(ROW.top)}
        state={es('e-bff-mcpgw')} markerId={arrowId(es('e-bff-mcpgw'))} />

      {/* mcp-gw → mcp-server */}
      <SimEdge id="e-mcpgw-mcpserver"
        x1={COL.mcpGw + NW}   y1={cy(ROW.top)}
        x2={COL.services}      y2={cy(ROW.top)}
        state={es('e-mcpgw-mcpserver')} markerId={arrowId(es('e-mcpgw-mcpserver'))} />

      {/* mcp-gw → mortgage */}
      <SimEdge id="e-mcpgw-mortgage"
        x1={cx(COL.mcpGw)}  y1={ROW.top + NH}
        x2={cx(COL.mcpGw)}  y2={ROW.mid + NH + 10}
        state={es('e-mcpgw-mortgage')} markerId="arr-idle" />
      <SimEdge id="e-mcpgw-mortgage-h"
        x1={cx(COL.mcpGw)}  y1={cy(ROW.mid + NH + 10)}
        x2={COL.services}   y2={cy(ROW.mid + NH + 10)}
        state={es('e-mcpgw-mortgage')} markerId={arrowId(es('e-mcpgw-mortgage'))} />

      {/* mcp-gw → resource-server */}
      <SimEdge id="e-mcpgw-resourceserver"
        x1={COL.mcpGw + NW}   y1={cy(ROW.lower)}
        x2={COL.services}      y2={cy(ROW.lower)}
        state={es('e-mcpgw-resourceserver')} markerId={arrowId(es('e-mcpgw-resourceserver'))} />

      {/* bff → pingone */}
      <SimEdge id="e-bff-pingone"
        x1={cx(COL.bff)}   y1={ROW.top + NH}
        x2={cx(COL.bff)}   y2={ROW.mid}
        state={es('e-bff-pingone')} markerId="arr-idle" />
      <SimEdge id="e-bff-pingone-h"
        x1={cx(COL.bff)}     y1={cy(ROW.mid)}
        x2={COL.external}    y2={cy(ROW.mid)}
        state={es('e-bff-pingone')} markerId={arrowId(es('e-bff-pingone'))} />

      {/* mcp-gw → pingone */}
      <SimEdge id="e-mcpgw-pingone"
        x1={cx(COL.mcpGw)}  y1={ROW.top + NH}
        x2={cx(COL.mcpGw)}  y2={ROW.mid + 15}
        state={es('e-mcpgw-pingone')} markerId="arr-idle" />
      <SimEdge id="e-mcpgw-pingone-h"
        x1={cx(COL.mcpGw)}   y1={cy(ROW.mid) + 15}
        x2={COL.external}    y2={cy(ROW.mid) + 15}
        state={es('e-mcpgw-pingone')} markerId={arrowId(es('e-mcpgw-pingone'))} />

      {/* bff → pingauthorize (3 segments — routes above resource-server row at ABOVE_RS) */}
      <SimEdge id="e-bff-pingauth"
        x1={cx(COL.bff)}  y1={ROW.top + NH}
        x2={cx(COL.bff)}  y2={ABOVE_RS}
        state={es('e-bff-pingauth')} markerId="arr-idle" />
      <SimEdge id="e-bff-pingauth-h"
        x1={cx(COL.bff)}      y1={ABOVE_RS}
        x2={cx(COL.external)} y2={ABOVE_RS}
        state={es('e-bff-pingauth')} markerId="arr-idle" />
      <SimEdge id="e-bff-pingauth-v2"
        x1={cx(COL.external)}  y1={ABOVE_RS}
        x2={cx(COL.external)}  y2={ROW.lower}
        state={es('e-bff-pingauth')} markerId={arrowId(es('e-bff-pingauth'))} />

      {/* bff → hitl */}
      <SimEdge id="e-bff-hitl"
        x1={cx(COL.bff)}  y1={ROW.top + NH}
        x2={cx(COL.bff)}  y2={ROW.bot}
        state={es('e-bff-hitl')} markerId="arr-idle" />
      <SimEdge id="e-bff-hitl-h"
        x1={cx(COL.bff)}    y1={cy(ROW.bot)}
        x2={COL.services}   y2={cy(ROW.bot)}
        state={es('e-bff-hitl')} markerId={arrowId(es('e-bff-hitl'))} />

      {/* mcp-gw → pingauthorize (3 segments — routes above resource-server row at ABOVE_RS)
          The Ping Agent Gateway calls the PingOne Authorization Server for every tool/call:
          first RFC 7662 introspect, then policy decision (PERMIT/DENY/INDETERMINATE).
          The edge is deliberately routed above the resource-server row so it is
          visually clear the connection is Gateway → PingOne Authorization Server, not via the Resource Server. */}
      <SimEdge id="e-mcpgw-pingauth"
        x1={cx(COL.mcpGw)+12}  y1={ROW.top + NH}
        x2={cx(COL.mcpGw)+12}  y2={ABOVE_RS}
        state={es('e-mcpgw-pingauth')} markerId="arr-idle" />
      <SimEdge id="e-mcpgw-pingauth-h"
        x1={cx(COL.mcpGw)+12}  y1={ABOVE_RS}
        x2={cx(COL.external)}   y2={ABOVE_RS}
        state={es('e-mcpgw-pingauth')} markerId="arr-idle" />
      <SimEdge id="e-mcpgw-pingauth-v2"
        x1={cx(COL.external)}  y1={ABOVE_RS}
        x2={cx(COL.external)}  y2={ROW.lower}
        state={es('e-mcpgw-pingauth')} markerId={arrowId(es('e-mcpgw-pingauth'))} />

      {/* mcp-gw → hitl (gateway creates HITL challenge after INDETERMINATE) */}
      <SimEdge id="e-mcpgw-hitl"
        x1={cx(COL.mcpGw)+24}  y1={ROW.top + NH}
        x2={cx(COL.mcpGw)+24}  y2={cy(ROW.bot)}
        state={es('e-mcpgw-hitl')} markerId="arr-idle" />
      <SimEdge id="e-mcpgw-hitl-h"
        x1={cx(COL.mcpGw)+24}  y1={cy(ROW.bot)}
        x2={COL.services}       y2={cy(ROW.bot)}
        state={es('e-mcpgw-hitl')} markerId={arrowId(es('e-mcpgw-hitl'))} />

      {/* ── Nodes ──────────────────────────────────────────────────── */}
      {/* Row 1: main request path */}
      <SimNode id="n-browser"  x={COL.browser}  y={ROW.top} label="Browser"       sub="port 4000"
        tooltip="User's browser — holds only an httpOnly session cookie; no tokens are ever stored client-side"
        state={ns('n-browser')} />
      <SimNode id="n-bff"      x={COL.bff}      y={ROW.top} label="BFF"           sub="demo_api_server :3001"
        tooltip="Backend For Frontend — sole OAuth token custodian; resolves session cookie to access token; never exposes tokens to the browser"
        state={ns('n-bff')} />
      <SimNode id="n-mcp-gw"   x={COL.mcpGw}   y={ROW.top} label="Ping Agent Gateway"   sub=":3005"
        tooltip="Ping Agent Gateway (:3005) — central enforcement point; forwards BFF-issued token unchanged (no re-exchange); introspects token then consults PingOne Authorization Server before every tool call; validates aud (D-05 anti-bypass)"
        state={ns('n-mcp-gw')} />
      <SimNode id="n-mcp-server" x={COL.services} y={ROW.top} label="MCP Server"  sub=":8080"
        tooltip="MCP Server (:8080) — executes banking tools; validates token aud and scopes per tool; checks act claim for delegated agent authority"
        state={ns('n-mcp-server')} />

      {/* Row 2: parallel services */}
      <SimNode id="n-agent"      x={COL.mcpGw}    y={ROW.mid} label="Agent Service" sub=":3006 / :8888"
        tooltip="Agent Service — LangChain (:8888) / OpenAI Agents (:8891) / Mastra (:8892) / Pydantic AI (:8893) / LM Studio (:3006); translates natural language to MCP tool calls"
        state={ns('n-agent')} />
      <SimNode id="n-mcp-invest" x={COL.services} y={ROW.mid} label="MCP Invest"    sub=":8081"
        tooltip="MCP Invest (:8081) — investment and portfolio tools; separate MCP server instance for financial data"
        state={ns('n-mcp-invest')} />
      <SimNode id="n-mortgage"   x={COL.services} y={ROW.mid + NH + 10} label="Mortgage Svc" sub=":8082"
        tooltip="Mortgage Service (:8082) — legacy service using API key auth; reached via Ping Agent Gateway Path A (api_key disposition); not PingOne-aware"
        state={ns('n-mortgage')} />
      <SimNode id="n-pingone"    x={COL.external} y={ROW.mid} label="PingOne"        sub="OAuth AS"
        tooltip="PingOne — OAuth 2.0 Authorization Server and Identity Provider; issues tokens, validates may_act for RFC 8693 token exchange, enforces PKCE"
        state={ns('n-pingone')} />

      {/* Row 3: lower services */}
      <SimNode id="n-resource-server" x={COL.services} y={ROW.lower} label="Resource Server" sub="/api/resource-server"
        tooltip="Resource Server (/api/resource-server) — validates access tokens independently; serves banking data; used in Path B (dual-token) and Path C (oauth_bearer) dispositions"
        state={ns('n-resource-server')} />
      <SimNode id="n-pingauthorize"   x={COL.external} y={ROW.lower} label="PingOne Authorization Server"    sub=":9001 (mock)"
        tooltip="PingOne Authorization Server — policy decision point (PDP); returns PERMIT, DENY, or INDETERMINATE for every MCP tool call; demo uses mock at :9001 (configurable via PINGAUTHORIZE_ENDPOINT)"
        state={ns('n-pingauthorize')} />

      {/* Row 4: HITL */}
      <SimNode id="n-hitl" x={COL.services} y={ROW.bot} label="HITL Service" sub=":3009"
        tooltip="HITL Service (:3009) — Human-In-The-Loop consent; creates time-limited challenges after PingOne Authorization Server INDETERMINATE signals; binds each challenge to userId + agentId + tool"
        state={ns('n-hitl')} />
    </svg>
  );
}

export default memo(ArchitectureSimSvg);
