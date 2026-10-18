/**
 * ReactFlowPocPage — /architecture/reactflow-poc
 *
 * Full architecture demo built on React Flow:
 *   - Complete architecture with custom nodes and nested system boundaries
 *   - Ordered steps with a visible step counter (shared DiagramControls)
 *   - Play / pause / next / back / reset + adjustable speed
 *   - Animated tokens moving along request paths (SVG animateMotion edges)
 *   - Permit / deny / indeterminate / HITL branch scenarios
 *   - Explanatory side panel for the active step + node drill-down on click
 *   - Color-coded PingOne, Vault, MCP, gateway, Resource Server, data layers
 *   - Zoom, pan, minimap, selectable nodes
 *
 * Guided happy path:
 *   User → React UI → BFF → Vault → PingOne → Agent → MCP Gateway
 *   → PingOne Authorize → MCP Server → Resource Server → Reservation Data
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  BaseEdge,
  getSmoothStepPath,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DEFAULT_STEP_MS, DiagramControls, STEP_TIME_OPTIONS } from "./diagram";
import ReactFlowSequenceDiagram from "./ReactFlowSequenceDiagram";
import useDiagramTheme from "./useDiagramTheme";
import { agentFlowDiagram } from "../services/agentFlowDiagramService";
import { useAppEventsSSE } from "../hooks/useAppEventsSSE";
import "./ReactFlowPocPage.css";

// ─── Layer palette (color-coded planes) ─────────────────────────────────────

const LAYERS = {
  identity: { label: "PingOne / Identity", color: "#d20e0f" },
  security: { label: "Security / Policy", color: "#dc2626" },
  runtime: { label: "Runtime / BFF", color: "#004687" },
  vault: { label: "Vault", color: "#ca8a04" },
  mcp: { label: "MCP", color: "#0e7490" },
  resource: { label: "Resource Server", color: "#15803d" },
  data: { label: "Data", color: "#475569" },
};

// Outcome accents for the decision branches.
const OUTCOMES = {
  permit: { label: "PERMIT", color: "#16a34a" },
  deny: { label: "DENY", color: "#dc2626" },
  indeterminate: { label: "INDETERMINATE", color: "#d97706" },
  hitl: { label: "HITL", color: "#d20e0f" },
};

// Per-step wire narrative: one line per hop, styled after the reference
// architecture's "REQUEST NARRATIVE" block — numbered actor→target lines
// with the transport / payload called out inline.
const STEP_NARRATIVE = {
  1: [
    ["Browser", "POST /api/auth/login", "PKCE code_challenge (S256) hashed client-side"],
    ["BFF", "PingOne /as/authorization.par", "pushed authorization request, no token yet"],
    ["PingOne", "DaVinci widget", "user consents; authorization code issued"],
    ["BFF", "session store", "set-cookie booking.sid — browser holds only the cookie"],
  ],
  2: [
    ["BFF", "Vault secret/travel/tokens/maya", "PUT access + refresh tokens (redacted at rest)"],
    ["BFF", "session", "per-hop fetch with X-Vault-Lease: 60s — least privilege"],
  ],
  3: [
    ["UI chip", "POST /api/agent/chat", "context: use-case-chip:book-flight, vertical: travel"],
    ["BFF", "SSE stream", "event: tool_call — book_ticket(UA-875, SFO→NRT, window)"],
  ],
  4: [
    ["Agent", "POST /api/mcp/tool", "JSON-RPC tools/call; BFF holds only the session cookie"],
    ["BFF", "PingOne /as/token", "RFC 8693 token exchange: subject=user, actor=agent, aud=mcp-gateway"],
  ],
  5: [
    ["Gateway", "PingAuthorize sideband", "POST decision context: subject, actor, action, fare, price, mfa_recent"],
  ],
  6: [
    ["Gateway", "MCP Server (WS JSON-RPC)", "Bearer (aud: mcp-gateway) + X-Act-Sub: travel-agent forwarded"],
  ],
  7: [
    ["MCP Server", "Booking API /reservations", "service credential (aud: booking-api), scope bookings:write"],
    ["Booking API", "store", "aud + scope validated BEFORE create; 201 res_8841"],
  ],
  8: [
    ["Booking API", "PNR store", "internal read/write — pnr/maya/*, not token-gated"],
    ["PNR store", "Booking API", "QX7TZP confirmed, seat 18A"],
  ],
  9: [
    ["MCP Server", "Gateway → Agent → UI", "result unwinds the chain; every hop re-validates its token"],
    ["UI", "render", "PNR QX7TZP + token-chain trace recorded for audit"],
  ],
};

// Standing invariants shown beside the narrative (reference-style sidebox).
const INVARIANTS = [
  {
    title: "Token custody",
    color: "#ca8a04",
    text: "Tokens are never exposed to the browser. The BFF is the sole custodian — every browser call is cookie-only, withCredentials: true, no Authorization header.",
  },
  {
    title: "act / may_act claim",
    color: "#0e7490",
    text: "Every delegated MCP token carries act.sub = agent client_id. The gateway and downstream servers read act.sub to know who called the API on the user's behalf.",
  },
  {
    title: "Fail closed",
    color: "#dc2626",
    text: "INDETERMINATE is treated as DENY. If the P1AZ decision service is unreachable, the gateway holds the call — it never fails open.",
  },
  {
    title: "HITL gate",
    color: "#d20e0f",
    text: "High-value or ambiguous requests raise a 428 challenge; the flow pauses until a human approves or denies from the UI.",
  },
];

// ─── Node details (drill-down content) ──────────────────────────────────────

const NODE_DETAILS = {
  user: {
    role: "Human actor",
    detail:
      "Signs in via the browser and drives the demo through chat, use-case chips, and HITL approvals. Never holds an access token.",
  },
  ui: {
    role: "React SPA (demo_api_ui)",
    detail:
      "Renders dashboards, agent chat, and the token-chain trace. Talks only to the BFF over /api/* with a session cookie.",
  },
  bff: {
    role: "Backend-for-Frontend (demo_api_server)",
    detail:
      "Sole browser-token custodian. Owns OIDC/PAR login, session storage, RFC 8693 exchanges, and every /api/* route.",
  },
  vault: {
    role: "Token custody (Vault / LMDB)",
    detail:
      "Stores PingOne tokens and service credentials. Every hop fetches the least-privileged token it needs; nothing sensitive is cached in the browser.",
  },
  pingone: {
    role: "PingOne OIDC provider",
    detail:
      "Issues the user session (PKCE/PAR, DaVinci login widget) and hosts the PingOne Authorize policy decision point.",
  },
  agent: {
    role: "Travel booking agent",
    detail:
      "Plans MCP tool calls on the traveler's behalf — flight search, seat selection, ticket booking. Carries a delegated, narrowed identity — never the user's raw token.",
  },
  gateway: {
    role: "MCP Gateway",
    detail:
      "Validates the agent's token, asks PingOne Authorize for a decision, enforces the outcome, and forwards permitted calls to the MCP Server.",
  },
  authorize: {
    role: "PingOne Authorize (P1AZ)",
    detail:
      "Policy decision point. Evaluates who, what, how much, and MFA state → PERMIT, DENY, INDETERMINATE, or a HITL challenge (428).",
  },
  mcpserver: {
    role: "MCP Server (oauth-mcp)",
    detail:
      "Serves the flight-booking tool surface (search flights, book ticket, choose seat). Validates the forwarded call and invokes the Resource Server with its service credential.",
  },
  resapi: {
    role: "Resource Server (Booking API)",
    detail:
      "Validates audience and scopes on every request before touching reservations. Returns only the fields the token is scoped for.",
  },
  data: {
    role: "Reservation data (flights, seats, PNRs)",
    detail:
      "The flight inventory, seat maps, and booking (PNR) store backing the demo. Read/write only through the Resource Server.",
  },
};

// ─── Custom nodes ───────────────────────────────────────────────────────────

// Per-layer icons (project emoji allowlist) and plane tints.
const LAYER_ICONS = {
  identity: "👤",
  security: "🛡",
  runtime: "⚙",
  vault: "🔐",
  mcp: "🔗",
  resource: "🏦",
  data: "📊",
};

const PLANE_TINTS = {
  "plane-browser": "#d20e0f",
  "plane-runtime": "#004687",
  "plane-pingone": "#d20e0f",
  "plane-oidc": "#d20e0f",
  "plane-mcp": "#0e7490",
  "plane-resource": "#15803d",
};

function PlaneNode({ data }) {
  return (
    <div
      className={`rfp-plane${
        data.tint ? ` rfp-plane--${data.tint}` : ""
      }`}
      style={{ width: "100%", height: "100%" }}
    >
      <span className="rfp-plane__label">{data.label}</span>
    </div>
  );
}

function ArchNode({ data }) {
  const layer = LAYERS[data.layer] || LAYERS.runtime;
  const outcome = data.outcome ? OUTCOMES[data.outcome] : null;
  const icon = LAYER_ICONS[data.layer] || "⚙";
  return (
    <div
      className={`rfp-node rfp-node--${data.state || "idle"}`}
      data-nodeid={data.nodeId}
      style={
        data.state === "active"
          ? { borderColor: layer.color, boxShadow: `0 0 0 3px ${layer.color}33, 0 0 18px ${layer.color}55` }
          : undefined
      }
    >
      <Handle type="target" position={Position.Left} />
      <div className="rfp-node__bar" style={{ background: layer.color }} />
      <div className="rfp-node__row">
        <span className="rfp-node__icon" style={{ color: layer.color }}>
          {icon}
        </span>
        <div>
          <div className="rfp-node__title">{data.label}</div>
          <div className="rfp-node__layer">{layer.label}</div>
        </div>
      </div>
      {data.stateLabel ? (
        <div
          className="rfp-node__state"
          style={{
            color: outcome ? outcome.color : layer.color,
            borderColor: outcome ? outcome.color : layer.color,
          }}
        >
          {data.stateLabel}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { arch: ArchNode, plane: PlaneNode };

// ─── Custom token edge (animated dot along the path) ────────────────────────

function TokenEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, animated, markerEnd }) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      {animated && (
        <>
          {/* flowing dash overlay + glowing traveling token */}
          <path d={path} className="rfp-edge-flow" fill="none" />
          <circle r="6" className="rfp-token">
            <animateMotion dur="1.6s" repeatCount="indefinite" path={path} />
          </circle>
        </>
      )}
    </>
  );
}

const edgeTypes = { token: TokenEdge };

// Re-fits the viewport whenever the canvas box changes size (page resize,
// splitter drag, panel collapse). fitView alone only runs on mount, so a
// later resize leaves the graph mis-scaled.
function CanvasFitEffect() {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const el = document.querySelector(".rfp-canvas");
    if (!el) return undefined;
    let lastH = 0;
    let t = null;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height || 0;
      if (Math.abs(h - lastH) < 8 || h < 60) return;
      lastH = h;
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => fitView({ duration: 200, padding: 0.1 }), 150);
    });
    ro.observe(el);
    return () => {
      if (t) window.clearTimeout(t);
      ro.disconnect();
    };
  }, [fitView]);
  return null;
}

// ─── Static architecture: planes + nodes + edges ────────────────────────────

const PLANE_STYLE = {
  borderRadius: 14,
  padding: 0,
};

// Layout: the main chain flows LEFT → RIGHT in numbered columns. Lateral
// calls (Gateway ⇄ PingOne Authorize) go north/south off the chain.
//
//   col0        col1          col2           col3            col4          col5
//   User        React UI      Agent
//                             BFF            Vault
//   [PingOne Authorize]  ←Gateway      MCP Server    Resource Srv   Reservation Data
//                             (PingOne OIDC sits above Gateway's plane row)
const COL_W = 260;
const colX = (col) => col * COL_W;

const BASE_NODES = [
  // ── Plane 1: Browser ──
  {
    id: "plane-browser",
    type: "plane",
    position: { x: 0, y: 0 },
    data: { label: "Browser", tint: "plane-browser" },
    style: { width: 500, height: 150 },
    zIndex: -1,
  },
  {
    id: "user",
    parentId: "plane-browser",
    extent: "parent",
    nodeId: "user",
    type: "arch",
    position: { x: 25, y: 40 },
    data: { label: "User", layer: "identity" },
  },
  {
    id: "ui",
    parentId: "plane-browser",
    extent: "parent",
    nodeId: "ui",
    type: "arch",
    position: { x: 270, y: 40 },
    data: { label: "React UI (demo_api_ui)", layer: "runtime" },
  },

  // ── Plane 2: PingOne cloud (Authorize is the lateral branch, north) ──
  {
    id: "plane-pingone",
    type: "plane",
    position: { x: colX(2), y: -180 },
    data: { label: "PingOne cloud", tint: "plane-pingone" },
    style: { width: 260, height: 150 },
    zIndex: -1,
  },
  {
    id: "authorize",
    parentId: "plane-pingone",
    extent: "parent",
    nodeId: "authorize",
    type: "arch",
    position: { x: 25, y: 40 },
    data: { label: "PingOne Authorize", layer: "security" },
  },

  // ── Plane 3: Demo runtime ──
  {
    id: "plane-runtime",
    type: "plane",
    position: { x: 0, y: 220 },
    data: { label: "Demo runtime — BFF + Vault + Agent", tint: "plane-runtime" },
    style: { width: 1090, height: 150 },
    zIndex: -1,
  },
  {
    id: "bff",
    parentId: "plane-runtime",
    extent: "parent",
    nodeId: "bff",
    type: "arch",
    position: { x: 270, y: 40 },
    data: { label: "BFF (demo_api_server)", layer: "runtime" },
  },
  {
    id: "vault",
    parentId: "plane-runtime",
    extent: "parent",
    nodeId: "vault",
    type: "arch",
    position: { x: 530, y: 40 },
    data: { label: "Vault (token custody)", layer: "vault" },
  },
  {
    id: "agent",
    parentId: "plane-runtime",
    extent: "parent",
    nodeId: "agent",
    type: "arch",
    position: { x: 25, y: 40 },
    data: { label: "Agent", layer: "runtime" },
  },

  // ── Plane 4: PingOne OIDC (provider band) ──
  {
    id: "plane-oidc",
    type: "plane",
    position: { x: colX(3), y: 220 },
    data: { label: "", tint: "plane-oidc" },
    style: { width: 260, height: 150 },
    zIndex: -1,
  },
  {
    id: "pingone",
    parentId: "plane-oidc",
    extent: "parent",
    nodeId: "pingone",
    type: "arch",
    position: { x: 25, y: 40 },
    data: { label: "PingOne (OIDC session)", layer: "identity" },
  },

  // ── Plane 5: MCP layer ──
  {
    id: "plane-mcp",
    type: "plane",
    position: { x: colX(2), y: 440 },
    data: { label: "MCP layer", tint: "plane-mcp" },
    style: { width: 500, height: 150 },
    zIndex: -1,
  },
  {
    id: "gateway",
    parentId: "plane-mcp",
    extent: "parent",
    nodeId: "gateway",
    type: "arch",
    position: { x: 25, y: 40 },
    data: { label: "MCP Gateway", layer: "mcp" },
  },
  {
    id: "mcpserver",
    parentId: "plane-mcp",
    extent: "parent",
    nodeId: "mcpserver",
    type: "arch",
    position: { x: 270, y: 40 },
    data: { label: "MCP Server", layer: "mcp" },
  },

  // ── Plane 6: Resource plane ──
  {
    id: "plane-resource",
    type: "plane",
    position: { x: colX(4), y: 440 },
    data: { label: "Resource plane", tint: "plane-resource" },
    style: { width: 520, height: 150 },
    zIndex: -1,
  },
  {
    id: "resapi",
    parentId: "plane-resource",
    extent: "parent",
    nodeId: "resapi",
    type: "arch",
    position: { x: 25, y: 40 },
    data: { label: "Resource Server (Booking API)", layer: "resource" },
  },
  {
    id: "data",
    parentId: "plane-resource",
    extent: "parent",
    nodeId: "data",
    type: "arch",
    position: { x: 285, y: 40 },
    data: { label: "Reservation Data (PNR store)", layer: "data" },
  },
];

const mkEdge = (id, source, target, label) => ({
  id,
  source,
  target,
  type: "token",
  label,
  animated: false,
});

const BASE_EDGES = [
  mkEdge("e-user-ui", "user", "ui", "browser"),
  mkEdge("e-ui-bff", "ui", "bff", "/api/*"),
  mkEdge("e-bff-vault", "bff", "vault", "store/fetch tokens"),
  mkEdge("e-bff-pingone", "bff", "pingone", "OIDC / PAR"),
  mkEdge("e-ui-agent", "ui", "agent", "chat / chip"),
  mkEdge("e-agent-gateway", "agent", "gateway", "MCP tool call"),
  mkEdge("e-gateway-authorize", "gateway", "authorize", "policy decision"),
  mkEdge("e-gateway-mcpserver", "gateway", "mcpserver", "forwarded call"),
  mkEdge("e-mcpserver-resapi", "mcpserver", "resapi", "service API key"),
  mkEdge("e-resapi-data", "resapi", "data", "read/write"),
];

// ─── Wire-level HTTP detail per step ────────────────────────────────────────
// Illustrative requests/responses mirroring what the demo BFF/gateway
// actually emit. Secrets redacted; claims are the ones that matter.

const STEP_WIRE = {
  1: {
    req: {
      method: "POST",
      url: "/api/auth/login",
      note: "Browser → BFF. PKCE + PAR: the code_challenge is hashed client-side.",
      body: {
        client_id: "booking-bff",
        redirect_uri: "https://local.ping-devops.com:4000/api/auth/callback",
        code_challenge: "E9Melhoa2Ow…",
        code_challenge_method: "S256",
        scope: "openid profile bookings",
      },
    },
    res: {
      status: 302,
      note: "BFF → PingOne /as/authorization.par. After consent, callback sets the session:",
      body: {
        "set-cookie": "booking.sid=s%3A9f2c…; HttpOnly; Secure; SameSite=Lax",
        token_in_session: "access + refresh + id_token (browser never sees these)",
      },
    },
  },
  2: {
    req: {
      method: "PUT",
      url: "https://vault.internal/v1/secret/travel/tokens/maya",
      note: "BFF → Vault. Store the exchange under the traveler's path.",
      body: {
        data: {
          access_token: "eyJhbGciOiJSUzI1…(redacted)",
          refresh_token: "rt_4b1f…(redacted)",
          aud: "booking-bff",
          expires_in: 7200,
        },
      },
    },
    res: {
      status: 204,
      note: "Later hops fetch with a short lease:",
      body: {
        "X-Vault-Lease": "60s",
        aud: "booking-bff",
        scope: "openid profile bookings",
      },
    },
  },
  3: {
    req: {
      method: "POST",
      url: "/api/agent/chat",
      note: "React UI → BFF. Use-case chip fires the agent with the prompt.",
      body: {
        message: "Book UA-875 SFO → NRT on Oct 14, window seat",
        context: { vertical: "travel", origin: "use-case-chip:book-flight" },
      },
    },
    res: {
      status: 200,
      note: "SSE stream opens; agent plans a tool call:",
      body: {
        event: "tool_call",
        tool: "book_ticket",
        args: { flight: "UA-875", from: "SFO", to: "NRT", date: "2026-10-14", seat: "window" },
      },
    },
  },
  4: {
    req: {
      method: "POST",
      url: "/api/mcp/tool",
      note: "Agent → BFF. JSON-RPC envelope; BFF holds only the session cookie.",
      body: {
        jsonrpc: "2.0",
        id: "req-17",
        method: "tools/call",
        params: {
          name: "book_ticket",
          arguments: { flight: "UA-875", date: "2026-10-14", seat_pref: "window" },
        },
      },
    },
    res: {
      status: 202,
      note: "BFF → PingOne /as/token (RFC 8693). Subject = user, actor = agent:",
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: "eyJ…(user token from Vault)",
        actor_token: "eyJ…(travel-agent client token)",
        audience: "mcp-gateway",
        scope: "mcp:call flights:search",
      },
    },
  },
  5: {
    req: {
      method: "POST",
      url: "https://auth.pingone.com/{env}/pingauthorize",
      note: "Gateway → P1AZ sideband. Raw decision context, no token material:",
      body: {
        subject: "user_maya_chen",
        actor: "travel-agent",
        action: "BookTicket",
        resource: "flight/UA-875/SFO-NRT",
        fare_class: "economy",
        price_usd: 1240,
        mfa_recent: true,
      },
    },
    res: {
      status: 200,
      note: "Policy decision with obligation:",
      body: { decision: "PERMIT", obligations: [{ type: "audit", log: "full-chain" }] },
    },
  },
  6: {
    req: {
      method: "POST",
      url: "wss://mcp-gateway/session-17",
      note: "Gateway forwards the JSON-RPC call downstream with the exchanged token:",
      body: {
        Authorization: "Bearer eyJ…(aud: mcp-gateway)",
        "X-Act-Sub": "travel-agent",
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "book_ticket", arguments: { flight: "UA-875" } },
      },
    },
    res: {
      status: 200,
      note: "Permit path → forwarded. DENY here instead returns:",
      body: {
        error: { code: -32001, message: "agent_mcp_scope_denied", data: { required_scopes: ["bookings:write"] } },
      },
    },
  },
  7: {
    req: {
      method: "POST",
      url: "https://booking-api.internal/reservations",
      note: "MCP Server → Booking API with its own service credential:",
      body: {
        Authorization: "Bearer eyJ…(aud: booking-api)",
        "X-Client-Id": "mcp-server",
        body: { flight: "UA-875", traveler: "maya_chen", seat_pref: "window" },
      },
    },
    res: {
      status: 201,
      note: "Resource Server validated aud + scope before creating anything:",
      body: { id: "res_8841", aud: "booking-api", scope_used: "bookings:write" },
    },
  },
  8: {
    req: {
      method: "GET",
      url: " reservations://pnr/maya/8841",
      note: "Resource Server → reservation store (internal, not token-gated):",
      body: { op: "read", keys: ["pnr/maya/*"], lease: "n/a" },
    },
    res: {
      status: 200,
      note: "PNR record written for the booking:",
      body: { pnr: "QX7TZP", flights: ["UA-875 SFO-NRT 2026-10-14"], seat: "18A", status: "confirmed" },
    },
  },
  9: {
    req: {
      method: "(return path)",
      url: "data → resapi → mcpserver → gateway → agent → ui",
      note: "Response unwinds the same chain; each hop re-validates its hop-scoped token.",
      body: { trace: ["resapi", "mcpserver", "gateway", "agent"], masked_fields: ["passenger_dob"] },
    },
    res: {
      status: 200,
      note: "UI renders the result + token-chain trace records every hop:",
      body: {
        jsonrpc: "2.0",
        id: "req-17",
        result: { pnr: "QX7TZP", flight: "UA-875", seat: "18A", status: "confirmed" },
      },
    },
  },
};

function WireDetailCard({ wire }) {
  if (!wire) return null;
  return (
    <div className="rfp-wire" data-testid="rfp-wire">
      <div className="rfp-wire__col">
        <div className="rfp-wire__head rfp-wire__head--req">
          → Request · {wire.req.method}{" "}
          <code className="rfp-wire__url">{wire.req.url}</code>
        </div>
        <p className="rfp-wire__note">{wire.req.note}</p>
        <pre className="rfp-wire__json">{JSON.stringify(wire.req.body, null, 2)}</pre>
      </div>
      <div className="rfp-wire__col">
        <div className="rfp-wire__head rfp-wire__head--res">
          ← Response · {wire.res.status}
        </div>
        <p className="rfp-wire__note">{wire.res.note}</p>
        <pre className="rfp-wire__json">{JSON.stringify(wire.res.body, null, 2)}</pre>
      </div>
    </div>
  );
}

// ─── Sample tokens (illustrative JWTs shown per step) ───────────────────────
// These are the claims each hop actually carries in the demo. Decoded payload
// only — never render a real token value here.

const SAMPLE_TOKENS = {
  1: {
    name: "Session cookie",
    kind: "cookie",
    claims: { sid: "sess_9f2c…", sub: "user_maya_chen", amr: ["pwd", "mfa"] },
    note: "Browser holds only an opaque session id — no access token.",
  },
  2: {
    name: "PingOne access token (at rest)",
    kind: "vault",
    claims: {
      aud: "booking-bff",
      sub: "user_maya_chen",
      scope: "openid profile bookings",
      vault_path: "secret/travel/tokens/maya",
    },
    note: "Stored in Vault; the BFF fetches per-hop.",
  },
  3: {
    name: "Travel agent identity (no user token)",
    kind: "agent",
    claims: { client_id: "travel-agent", act: { sub: "user_maya_chen" } },
    note: "Agent carries its own client identity with the traveler as actor.",
  },
  4: {
    name: "Exchanged token (RFC 8693)",
    kind: "exchange",
    claims: {
      aud: "mcp-gateway",
      client_id: "travel-agent",
      act: { sub: "user_maya_chen" },
      scope: "mcp:call flights:search",
    },
    highlight: "scope",
    note: "Audience narrowed to the gateway; scope trimmed to this call.",
  },
  5: {
    name: "Policy request context",
    kind: "policy",
    claims: {
      subject: "user_maya_chen",
      action: "BookTicket",
      resource: "flight/UA-875/SFO-NRT",
      fare_class: "economy",
      price_usd: 1240,
    },
    note: "Authorize evaluates who/what/which-fare/price — not a token.",
  },
  6: {
    name: "Downstream service token",
    kind: "service",
    claims: {
      aud: "mcp-server",
      client_id: "mcp-gateway",
      scope: "mcp:call flights:search",
    },
    highlight: "aud",
    note: "Re-exchanged for the MCP Server audience on PERMIT.",
  },
  7: {
    name: "Resource Server token",
    kind: "service",
    claims: {
      aud: "booking-api",
      client_id: "mcp-server",
      scope: "bookings:read",
    },
    highlight: "aud",
    note: "Final audience: the Booking API, read-only scope.",
  },
  8: {
    name: "No token — internal read",
    kind: "data",
    claims: { store: "reservations", keys: "pnr/maya/*" },
    note: "Data plane access is behind the Resource Server, not token-gated.",
  },
  9: {
    name: "Response (no token)",
    kind: "data",
    claims: { pnr: "QX7TZP", flights: 2, seat: "18A", status: "confirmed" },
    note: "Only fields the token was scoped for travel back.",
  },
};

function SampleTokenCard({ token, outcome }) {
  if (!token) return null;
  return (
    <div className="rfp-token-card" data-testid="rfp-sample-token">
      <div className="rfp-token-card__head">
        <span className="rfp-token-card__badge" data-kind={token.kind}>
          {token.kind}
        </span>
        <span className="rfp-token-card__name">{token.name}</span>
      </div>
      <pre className="rfp-token-card__claims">
        {Object.entries(token.claims).map(([k, v]) => (
          <div
            key={k}
            className={
              k === token.highlight
                ? "rfp-token-card__claim rfp-token-card__claim--hl"
                : "rfp-token-card__claim"
            }
          >
            <span className="rfp-token-card__key">{k}</span>
            <span className="rfp-token-card__val">
              {typeof v === "object" ? JSON.stringify(v) : String(v)}
            </span>
          </div>
        ))}
      </pre>
      <div className="rfp-token-card__note">{token.note}</div>
      {outcome === "hitl" && token.kind === "policy" ? (
        <div className="rfp-token-card__warn">
          ✋ HITL: challenge raised (428) — consent required before proceeding.
        </div>
      ) : null}
      {outcome === "deny" && token.kind === "policy" ? (
        <div className="rfp-token-card__deny">
          ❌ DENY: request refused — downstream token never issued.
        </div>
      ) : null}
    </div>
  );
}

// ─── Live agent run → node highlighting ─────────────────────────────────────
// Maps agentFlowDiagramService phase values (emitted by the floating agent's
// real MCP tool runs) onto this diagram's node ids.
const PHASE_TO_NODES = {
  request_accepted: [{ id: "agent" }, { id: "bff" }],
  resolving_access_token: [{ id: "bff" }, { id: "vault" }],
  access_token_ready: [{ id: "vault" }, { id: "bff" }],
  access_token_error: [{ id: "bff", outcome: "deny" }],
  no_bearer_token_branch: [{ id: "bff" }],
  no_bearer_no_user: [{ id: "bff", outcome: "deny" }],
  authorize_gate_begin: [{ id: "gateway" }, { id: "authorize" }],
  authorize_permitted: [{ id: "authorize", outcome: "permit" }, { id: "gateway", outcome: "permit" }],
  authorize_denied: [{ id: "authorize", outcome: "deny" }, { id: "gateway" }],
  authorize_gate_skipped: [{ id: "authorize" }],
  authorize_unavailable: [{ id: "authorize", outcome: "indeterminate" }, { id: "gateway", outcome: "indeterminate" }],
  authorize_internal_error: [{ id: "authorize", outcome: "indeterminate" }],
  introspection_begin: [{ id: "pingone" }],
  introspection_active_ok: [{ id: "pingone", outcome: "permit" }],
  introspection_inactive: [{ id: "pingone", outcome: "deny" }],
  mcp_remote_begin: [{ id: "gateway" }, { id: "mcpserver" }],
  mcp_remote_done: [{ id: "mcpserver", outcome: "permit" }, { id: "resapi", outcome: "permit" }, { id: "data", outcome: "permit" }],
  mcp_remote_tool_error: [{ id: "mcpserver", outcome: "deny" }],
  mcp_remote_unreachable: [{ id: "mcpserver", outcome: "indeterminate" }],
  local_tool_start: [{ id: "mcpserver" }],
  local_tool_done: [{ id: "mcpserver", outcome: "permit" }],
  mfa_challenge_initiated: [{ id: "authorize", outcome: "hitl" }, { id: "ui", outcome: "hitl" }],
  mfa_challenge_completed: [{ id: "ui", outcome: "permit" }],
  mfa_challenge_failed: [{ id: "ui", outcome: "deny" }],
  authorize_denied_hitl: [{ id: "authorize", outcome: "hitl" }, { id: "ui", outcome: "hitl" }],
  gateway_step_up_required: [{ id: "authorize", outcome: "hitl" }, { id: "ui", outcome: "hitl" }],
};

// Edges to animate for a set of active nodes: connect consecutive hops along
// the canonical chain if both endpoints are active.
const CHAIN_ORDER = [
  "user",
  "ui",
  "bff",
  "pingone",
  "vault",
  "agent",
  "gateway",
  "authorize",
  "mcpserver",
  "resapi",
  "data",
];

const EDGE_FOR_PAIR = {
  "user|ui": "e-user-ui",
  "ui|bff": "e-ui-bff",
  "bff|pingone": "e-bff-pingone",
  "bff|vault": "e-bff-vault",
  "ui|agent": "e-ui-agent",
  "agent|gateway": "e-agent-gateway",
  "gateway|authorize": "e-gateway-authorize",
  "gateway|mcpserver": "e-gateway-mcpserver",
  "mcpserver|resapi": "e-mcpserver-resapi",
  "resapi|data": "e-resapi-data",
};

function livePhaseToStep(snap) {
  const entries = PHASE_TO_NODES[snap.phase];
  if (!entries || entries.length === 0) return null;
  const path = entries.map((e) => e.id);
  const outcome = entries.find((e) => e.outcome)?.outcome;
  const activeEdges = [];
  for (let i = 0; i + 1 < path.length; i += 1) {
    const fwd = `${path[i]}|${path[i + 1]}`;
    if (EDGE_FOR_PAIR[fwd]) activeEdges.push(EDGE_FOR_PAIR[fwd]);
  }
  return {
    id: -1,
    title: snap.toolName
      ? `${snap.toolName} — ${snap.phase}`
      : `Live run — ${snap.phase}`,
    path,
    edges: activeEdges,
    stateLabels: Object.fromEntries(
      entries.filter((e) => e.outcome).map((e) => [e.id, e.outcome.toUpperCase()])
    ),
    outcome,
    explain: `Live agent run in progress (phase: ${snap.phase}). This is the real floating agent executing an MCP tool call through the BFF, gateway, and PingOne Authorize — nodes light as each hop completes.`,
  };
}

// ─── Guided steps (happy path = 9 steps, shared with the compare page) ──────

const STEPS = [
  {
    id: 1,
    title: "Login and PingOne session",
    path: ["user", "ui", "bff", "pingone"],
    edges: ["e-user-ui", "e-ui-bff", "e-bff-pingone"],
    stateLabels: { pingone: "session issued" },
    explain:
      "The user signs in through the React UI. The BFF brokers the OIDC flow with PingOne (PKCE/PAR) and establishes the browser session. The browser never sees an access token — the BFF is the sole token custodian.",
  },
  {
    id: 2,
    title: "Vault and BFF token custody",
    path: ["bff", "vault"],
    edges: ["e-bff-vault"],
    stateLabels: { vault: "tokens stored", bff: "custodian" },
    explain:
      "The BFF stores the PingOne tokens in Vault-backed custody. Every later hop fetches the least-privileged token it needs from here; nothing sensitive is cached in the browser.",
  },
  {
    id: 3,
    title: "Agent receives the request",
    path: ["ui", "agent"],
    edges: ["e-ui-agent"],
    stateLabels: { agent: "tool call planned" },
    explain:
      "A use-case chip or chat message in the React UI triggers the Agent, which plans an MCP tool call (e.g. search flights SFO → NRT, book a ticket, pick a seat) on the traveler's behalf.",
  },
  {
    id: 4,
    title: "Agent token exchange (RFC 8693)",
    path: ["agent", "gateway"],
    edges: ["e-agent-gateway"],
    stateLabels: { gateway: "validate" },
    explain:
      "The Agent presents its identity to the MCP Gateway. A delegated, narrowed token (RFC 8693 exchange) is used so the Agent only carries the scopes this single call requires.",
  },
  {
    id: 5,
    title: "MCP Gateway validates the call",
    path: ["gateway", "authorize"],
    edges: ["e-gateway-authorize"],
    stateLabels: { authorize: "evaluating policy" },
    explain:
      "The Gateway forwards the request context to PingOne Authorize, which evaluates policy (who is booking, which fare class, ticket price, MFA state) before the call may proceed.",
  },
  {
    id: 6,
    title: "PingOne Authorize decision — PERMIT",
    path: ["authorize", "gateway", "mcpserver"],
    edges: ["e-gateway-authorize", "e-gateway-mcpserver"],
    stateLabels: { authorize: "PERMIT", gateway: "forward" },
    outcome: "permit",
    explain:
      "PERMIT: the call continues to the MCP Server. The other branches (DENY / INDETERMINATE / HITL) are in the scenario picker — switch scenarios to watch them play out.",
  },
  {
    id: 7,
    title: "MCP Server → Resource Server",
    path: ["mcpserver", "resapi"],
    edges: ["e-mcpserver-resapi"],
    stateLabels: { mcpserver: "invoke", resapi: "validate token" },
    explain:
      "The MCP Server invokes the Booking API with its service credential. The Resource Server validates the audience and scopes before touching data.",
  },
  {
    id: 8,
    title: "Reservation returned",
    path: ["resapi", "data"],
    edges: ["e-resapi-data"],
    stateLabels: { data: "read/write" },
    explain:
      "The Resource Server reads or writes the reservation store and returns only the fields the exchanged token is scoped for.",
  },
  {
    id: 9,
    title: "Result back to the user",
    path: ["data", "resapi", "mcpserver", "gateway", "agent", "ui"],
    edges: [
      "e-resapi-data",
      "e-mcpserver-resapi",
      "e-gateway-mcpserver",
      "e-agent-gateway",
      "e-ui-agent",
    ],
    stateLabels: { ui: "render result" },
    explain:
      "The response travels back through the same chain. The UI renders the result, and the token-chain trace records every hop for audit.",
  },
];

// ─── Branch scenarios (override the decision step) ──────────────────────────

const denyStep = {
  id: 6,
  title: "PingOne Authorize decision — DENY",
  path: ["authorize", "gateway"],
  edges: ["e-gateway-authorize"],
  stateLabels: { authorize: "DENY", gateway: "blocked" },
  outcome: "deny",
  explain:
    "DENY: policy refuses the booking (e.g. first-class ticket over the traveler's spend limit, or the agent lacks the bookings:write scope). The Gateway stops the flow — nothing reaches the MCP Server or the Booking API, and the agent receives a policy-denied error.",
};

const indeterminateStep = {
  id: 6,
  title: "PingOne Authorize decision — INDETERMINATE",
  path: ["authorize", "gateway"],
  edges: ["e-gateway-authorize"],
  stateLabels: { authorize: "INDETERMINATE", gateway: "fail-closed" },
  outcome: "indeterminate",
  explain:
    "INDETERMINATE: policy cannot decide (e.g. the P1AZ decision service is unreachable or the rule set is ambiguous for this fare class). The Gateway fails closed — the booking is treated as denied rather than allowed through.",
};

const hitlDecisionStep = {
  id: 6,
  title: "PingOne Authorize decision — HITL challenge (428)",
  path: ["authorize", "gateway", "ui"],
  edges: ["e-gateway-authorize", "e-ui-agent"],
  stateLabels: { authorize: "CHALLENGE", gateway: "paused" },
  outcome: "hitl",
  explain:
    "HITL: policy demands a human decision (e.g. a business-class ticket over $2,000, or an award booking without recent MFA). The Gateway pauses the flow and raises a 428 consent challenge back to the UI.",
};

const hitlConsentStep = {
  id: 7,
  title: "User approves the consent challenge",
  path: ["ui", "agent", "gateway"],
  edges: ["e-ui-agent", "e-agent-gateway"],
  stateLabels: { ui: "consent given", gateway: "resumed" },
   token: {
    name: "Consent receipt",
    kind: "consent",
    claims: {
      challenge: "chg_428_a1",
      subject: "user_maya_chen",
      approved_by: "user_maya_chen",
      booking: "UA-875 SFO-NRT business $2,400",
      mfa: "step-up satisfied",
    },
    note: "Approval flows back through the Agent to the Gateway.",
  },
  explain:
    "The traveler reviews the step-up challenge in the UI (business-class fare over the auto-approve limit) and approves. The consent receipt flows back through the Agent to the Gateway, which resumes the paused booking with the decision satisfied.",
};

function buildScenarioSteps(scenario) {
  if (scenario === "deny") {
    return [...STEPS.slice(0, 5), denyStep];
  }
  if (scenario === "indeterminate") {
    return [...STEPS.slice(0, 5), indeterminateStep];
  }
  if (scenario === "hitl") {
    return [
      ...STEPS.slice(0, 5),
      hitlDecisionStep,
      hitlConsentStep,
      ...STEPS.slice(6).map((s, i) => ({ ...s, id: i + 8 })),
    ];
  }
  return STEPS;
}

const SCENARIOS = [
  { value: "permit", label: "Happy path — PERMIT" },
  { value: "deny", label: "Branch — DENY" },
  { value: "indeterminate", label: "Branch — INDETERMINATE" },
  { value: "hitl", label: "Branch — HITL (428 + consent)" },
];

// Token shown for a step: the step's own token, else the happy-path token
// keyed by the original step id (HITL consent carries its own).
const tokenForStep = (step) => step?.token || SAMPLE_TOKENS[step?.id] || null;

function applyStep(nodes, edges, step) {  const active = new Set(step ? step.path : []);
  const activeEdges = new Set(step ? step.edges : []);
  return {
    nodes: nodes.map((n) => {
      if (n.type !== "arch") return n;
      const isActive = active.has(n.id);
      const stateLabel =
        isActive && step && step.stateLabels && step.stateLabels[n.id]
          ? step.stateLabels[n.id]
          : undefined;
      return {
        ...n,
        data: {
          ...n.data,
          state: isActive ? "active" : "idle",
          stateLabel,
          outcome: isActive && step ? step.outcome : undefined,
        },
      };
    }),
    edges: edges.map((e) => ({ ...e, animated: activeEdges.has(e.id) })),
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export const POC_LAYERS = LAYERS;
export const POC_STEPS = STEPS;
export { buildScenarioSteps };

export default function ReactFlowPocPage({ initialView = "flow" }) {
  // Dragged layouts persist per-browser so a hand-tuned demo arrangement
  // survives reloads. Version the key so shipped layout changes don't collide
  // with a stale saved arrangement.
  // v2: shipped geometry changed (taller nodes, wider columns) — a v1 saved
  // layout would place nodes at stale coordinates, off the fitView box.
  // v3: resource plane widened + nodes re-spaced to fix overlap.
  const LAYOUT_KEY = "rfp-poc-layout-v3";

  const loadSavedLayout = () => {
    try {
      const raw = window.localStorage.getItem(LAYOUT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

  const savedLayout = useRef(loadSavedLayout());

  const withSavedLayout = useCallback(
    (nodes) =>
      savedLayout.current
        ? nodes.map((n) => {
            const pos = savedLayout.current[n.id];
            return pos ? { ...n, position: pos } : n;
          })
        : nodes,
    []
  );

  const [baseNodes, setBaseNodes, onBaseNodesChange] = useNodesState(() =>
    withSavedLayout(BASE_NODES)
  );
  const [baseEdges, setBaseEdges] = useEdgesState(BASE_EDGES);
  const [scenario, setScenario] = useState("permit");
  const [stepIndex, setStepIndex] = useState(-1);
  const [simulating, setSimulating] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [view, setView] = useState(initialView);
  const { dark, toggle: toggleTheme } = useDiagramTheme();

  // Bottom pane: draggable height + collapsible, persisted per browser.
  // Default is compact (260px) so the diagram keeps most of the viewport;
  // the user can drag the splitter for more, or collapse it entirely.
  const PANEL_KEY = "rfp-poc-panel-v2";
  const [panelHeight, setPanelHeight] = useState(() => {
    try {
      const v = window.localStorage.getItem(PANEL_KEY);
      return v ? Number(v) || 260 : 260;
    } catch {
      return 260;
    }
  });
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(`${PANEL_KEY}-collapsed`) === "1";
    } catch {
      return false;
    }
  });
  const pageRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!dragRef.current) return undefined;
    const onMove = (e) => {
      const page = pageRef.current;
      if (!page) return;
      const rect = page.getBoundingClientRect();
      const next = Math.min(Math.max(rect.bottom - e.clientY, 120), rect.height - 320);
      setPanelHeight(Math.round(next));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      try {
        window.localStorage.setItem(PANEL_KEY, String(panelHeight));
      } catch {
        // best-effort persistence
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "row-resize";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
    };
  }, [dragRef.current, panelHeight, PANEL_KEY]);

  const startPanelDrag = (e) => {
    e.preventDefault();
    dragRef.current = true;
  };

  const togglePanel = () => {
    setPanelCollapsed((prev) => {
      try {
        window.localStorage.setItem(`${PANEL_KEY}-collapsed`, prev ? "0" : "1");
      } catch {
        // best-effort
      }
      return !prev;
    });
  };

  const [liveMode, setLiveMode] = useState(false);
  const [liveStep, setLiveStep] = useState(null);
  const liveStepRef = useRef(null);
  liveStepRef.current = liveStep;
  const timerRef = useRef(null);

  const steps = useMemo(() => buildScenarioSteps(scenario), [scenario]);

  const showStep = useCallback(
    (index) => {
      const step = index >= 0 && index < steps.length ? steps[index] : null;
      const applied = applyStep(baseNodes, baseEdges, step);
      setBaseNodes(applied.nodes);
      setBaseEdges(applied.edges);
      setStepIndex(index);
    },
    [baseNodes, baseEdges, steps, setBaseNodes, setBaseEdges]
  );

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const playFrom = useCallback(
    (index) => {
      clearTimer();
      setSimulating(true);
      setPaused(false);
      showStep(index);
      if (index < steps.length - 1) {
        timerRef.current = window.setTimeout(() => playFrom(index + 1), stepMs);
      } else {
        setSimulating(false);
      }
    },
    [showStep, stepMs, steps.length]
  );

  const onSimulate = () => playFrom(0);
  const onPause = () => {
    clearTimer();
    setPaused(true);
  };
  const onResume = () => {
    if (stepIndex < steps.length - 1) {
      setPaused(false);
      timerRef.current = window.setTimeout(() => playFrom(stepIndex + 1), stepMs);
    } else {
      setPaused(false);
      setSimulating(false);
    }
  };
  const onNext = () => showStep(Math.min(stepIndex + 1, steps.length - 1));
  const onPrev = () => showStep(Math.max(stepIndex - 1, 0));
  const onReset = () => {
    clearTimer();
    setSimulating(false);
    setPaused(false);
    showStep(-1);
  };
  const onScenarioChange = (next) => {
    clearTimer();
    setSimulating(false);
    setPaused(false);
    setScenario(next);
    setSelectedNodeId(null);
    // Re-apply with the new scenario's steps on the next render tick.
    window.setTimeout(() => showStep(-1), 0);
  };

  const onNodeDragStop = useCallback(
    (_, node) => {
      savedLayout.current = {
        ...(savedLayout.current || {}),
        [node.id]: node.position,
      };
      try {
        window.localStorage.setItem(
          LAYOUT_KEY,
          JSON.stringify(savedLayout.current)
        );
      } catch {
        // Persisting the layout is best-effort; dragging still works.
      }
    },
    [LAYOUT_KEY]
  );

  const onLayoutReset = () => {
    savedLayout.current = null;
    try {
      window.localStorage.removeItem(LAYOUT_KEY);
    } catch {
      // ignore
    }
    setBaseNodes(withSavedLayout(BASE_NODES));
  };

  const onNodeClick = useCallback((_, node) => {
    if (node.type === "arch") setSelectedNodeId(node.id);
  }, []);

  // Live mode: subscribe to the real agent-run feed (same service the
  // floating agent populates via SSE) and light nodes per phase. The node /
  // edge arrays are read through refs — putting them in the dependency list
  // re-subscribes on every setNodes call, which re-applies and loops forever
  // ("Maximum update depth exceeded").
  const baseNodesRef = useRef(baseNodes);
  baseNodesRef.current = baseNodes;
  const baseEdgesRef = useRef(baseEdges);
  baseEdgesRef.current = baseEdges;

  useEffect(() => {
    if (!liveMode) {
      setLiveStep(null);
      return undefined;
    }
    const unsub = agentFlowDiagram.subscribe((snap) => {
      if (!snap || snap.phase === "idle") {
        setLiveStep(null);
        return;
      }
      const step = livePhaseToStep(snap);
      if (!step) return;
      setLiveStep(step);
      const applied = applyStep(
        baseNodesRef.current,
        baseEdgesRef.current,
        step
      );
      setBaseNodes(applied.nodes);
      setBaseEdges(applied.edges);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode]);

  useAppEventsSSE(() => {}, { enabled: liveMode });

  const activeStep =
    liveMode && liveStep ? liveStep : stepIndex >= 0 ? steps[stepIndex] : null;
  const selectedDetail = selectedNodeId ? NODE_DETAILS[selectedNodeId] : null;
  const selectedNode =
    selectedNodeId && BASE_NODES.find((n) => n.id === selectedNodeId);

  const layerLegend = useMemo(
    () => Object.entries(LAYERS).map(([key, l]) => ({ key, ...l })),
    []
  );

  const scenarioExtra = (
    <label className="rfp-scenario">
      Scenario
      <select
        value={scenario}
        onChange={(e) => onScenarioChange(e.target.value)}
        data-testid="rfp-scenario-select"
      >
        {SCENARIOS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
  const layoutResetExtra = (
    <button
      type="button"
      className="rfp-layout-reset"
      onClick={onLayoutReset}
      title="Restore the shipped diagram layout"
      data-testid="rfp-layout-reset"
    >
      ↺ Reset layout
    </button>
  );

  const themeBtn = (
    <button
      type="button"
      className="rfp-theme-btn"
      onClick={toggleTheme}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      data-testid="rfp-theme-toggle"
    >
      {dark ? "☀️ Light" : "🌙 Dark"}
    </button>
  );

  const liveBtn = (
    <button
      type="button"
      className={
        liveMode ? "rfp-live-btn rfp-live-btn--on" : "rfp-live-btn"
      }
      onClick={() => {
        const next = !liveMode;
        setLiveMode(next);
        if (next) {
          clearTimer();
          setSimulating(false);
          setPaused(false);
          setSelectedNodeId(null);
        } else {
          showStep(-1);
        }
      }}
      title={
        liveMode
          ? "Switch back to the guided tour"
          : "Follow the real floating-agent runs as they execute"
      }
      data-testid="rfp-live-toggle"
    >
      ⚡ {liveMode ? "Live — watching agent" : "Go live"}
    </button>
  );

  const viewToggle = (
    <div className="rfp-view-toggle" role="tablist" data-testid="rfp-view-toggle">
      <button
        type="button"
        role="tab"
        aria-selected={view === "flow"}
        className={view === "flow" ? "rfp-view-btn rfp-view-btn--on" : "rfp-view-btn"}
        onClick={() => setView("flow")}
      >
        Flow
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "sequence"}
        className={view === "sequence" ? "rfp-view-btn rfp-view-btn--on" : "rfp-view-btn"}
        onClick={() => setView("sequence")}
      >
        Sequence
      </button>
    </div>
  );

  const bottomControls = (
    <div className="rfp-panel__controls" data-testid="rfp-panel-controls">
      <span className="rfp-panel__controls-label">Step controls</span>
      <DiagramControls
        currentStep={stepIndex < 0 ? 0 : stepIndex + 1}
        totalSteps={steps.length}
        isSimulating={simulating}
        isPaused={paused}
        onSimulate={onSimulate}
        onPrev={onPrev}
        onPause={onPause}
        onResume={onResume}
        onNext={onNext}
        onStop={onReset}
        onReset={onReset}
        stepTimeOptions={STEP_TIME_OPTIONS}
        stepMs={stepMs}
        onSetStepMs={setStepMs}
      />
    </div>
  );

  const topToolbar = (
    <DiagramControls
      extra={
        <>
          {scenarioExtra}
          {layoutResetExtra}
          {viewToggle}
          {themeBtn}
          {liveBtn}
        </>
      }
    />
  );

  return (
    <div
      className={`rfp-page${dark ? " rfp-dark" : ""}`}
      data-testid="reactflow-poc-page"
      ref={pageRef}
    >
      <div className="rfp-header">
        <h2>Airline booking — interactive security architecture</h2>
        <p>
          The complete air-booking architecture with nested system boundaries
          underneath, a guided animated token path on top — Maya books flight
          UA-875 SFO → NRT through her travel agent. Pick a scenario to see the
          PERMIT, DENY, INDETERMINATE, and HITL branches play out; click any
          node to drill into what it does.
        </p>
        <div className="rfp-legend">
          {layerLegend.map((l) => (
            <span key={l.key} className="rfp-legend__item">
              <span
                className="rfp-legend__swatch"
                style={{ background: l.color }}
              />
              {l.label}
            </span>
          ))}
        </div>
        <div className="rfp-legend rfp-legend--outcomes">
          {Object.entries(OUTCOMES).map(([key, o]) => (
            <span key={key} className="rfp-legend__item">
              <span
                className="rfp-legend__swatch"
                style={{ background: o.color }}
              />
              {o.label}
            </span>
          ))}
        </div>
      </div>

      {topToolbar}

      <div className="rfp-body">
        <div className="rfp-canvas">
          {view === "flow" ? (
            <ReactFlow
              nodes={baseNodes}
              onNodesChange={onBaseNodesChange}
              nodesDraggable
              edges={baseEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              onNodeDragStop={onNodeDragStop}
              fitView
              minZoom={0.3}
              proOptions={{ hideAttribution: true }}
            >
              <CanvasFitEffect />
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
              <Controls />
              <MiniMap
                pannable
                zoomable
                nodeColor={(n) =>
                  n.type === "arch"
                    ? (LAYERS[n.data?.layer] || LAYERS.runtime).color
                    : "#e2e8f0"
                }
              />
            </ReactFlow>
          ) : (
            <ReactFlowSequenceDiagram
              steps={steps}
              activeStepIndex={stepIndex}
              outcome={activeStep ? activeStep.outcome : null}
            />
          )}
        </div>
      </div>

      <div
        className={`rfp-splitter${panelCollapsed ? " rfp-splitter--collapsed" : ""}`}
        onPointerDown={panelCollapsed ? undefined : startPanelDrag}
        title={panelCollapsed ? undefined : "Drag to resize the detail pane"}
        data-testid="rfp-splitter"
      >
        <span className="rfp-splitter__grip" />
        <button
          type="button"
          className="rfp-splitter__toggle"
          onClick={togglePanel}
          title={panelCollapsed ? "Show the detail pane" : "Hide the detail pane"}
          data-testid="rfp-panel-toggle"
        >
          {panelCollapsed ? "▲" : "▼"}
        </button>
      </div>

      <aside
        className={`rfp-panel${panelCollapsed ? " rfp-panel--collapsed" : ""}`}
        style={panelCollapsed ? undefined : { height: panelHeight }}
        data-testid="rfp-explain-panel"
      >
        {panelCollapsed ? null : (
          <>
            {bottomControls}
            {selectedDetail && selectedNode ? (
              <div className="rfp-panel__scroll">
                <h3>{selectedNode.data.label}</h3>
                <div
                  className="rfp-panel__layer"
                  style={{
                    color: (LAYERS[selectedNode.data.layer] || LAYERS.runtime)
                      .color,
                  }}
                >
                  {(LAYERS[selectedNode.data.layer] || LAYERS.runtime).label}
                </div>
                <p>
                  <strong>{selectedDetail.role}.</strong> {selectedDetail.detail}
                </p>
                <button
                  type="button"
                  className="rfp-panel__back"
                  onClick={() => setSelectedNodeId(null)}
                >
                  ← Back to step {activeStep ? activeStep.id : "—"}
                </button>
              </div>
            ) : (
              <div className="rfp-panel__scroll">
                <div className="rfp-panel__cols">
                  <div className="rfp-panel__story">
                    {activeStep ? (
                      <>
                        <h3>
                          {activeStep.id > 0 ? `Step ${activeStep.id}: ${activeStep.title}` : activeStep.title}
                        </h3>
                        {activeStep.outcome ? (
                          <div
                            className="rfp-panel__outcome"
                            style={{
                              borderColor: OUTCOMES[activeStep.outcome].color,
                              color: OUTCOMES[activeStep.outcome].color,
                            }}
                          >
                            {OUTCOMES[activeStep.outcome].label}
                          </div>
                        ) : null}
                        <p>{activeStep.explain}</p>
                        {STEP_NARRATIVE[activeStep.id] ? (
                          <ol className="rfp-panel__narrative">
                            {STEP_NARRATIVE[activeStep.id].map(([from, to, note], i) => (
                              <li key={i} className="rfp-panel__narrative-line">
                                <span className="rfp-panel__narrative-from">{from}</span>
                                <span className="rfp-panel__narrative-arrow">→</span>
                                <span className="rfp-panel__narrative-to">
                                  <code>{to}</code>
                                </span>
                                <span className="rfp-panel__narrative-note">{note}</span>
                              </li>
                            ))}
                          </ol>
                        ) : null}
                        <div className="rfp-panel__path">
                          {activeStep.path.join(" → ")}
                        </div>
                        <p className="rfp-panel__hint">
                          Click any node in the diagram to drill into what it does.
                        </p>
                      </>
                    ) : (
                      <>
                        <h3>Guided tour</h3>
                        <p>
                          Choose a scenario (PERMIT / DENY / INDETERMINATE / HITL),
                          then press Simulate to walk the token path step by step,
                          or use Next/Prev to move manually. Each step highlights
                          the nodes and edges involved and explains what happens.
                        </p>
                      </>
                    )}
                  </div>
                  <div className="rfp-panel__token">
                    <SampleTokenCard
                      token={tokenForStep(activeStep)}
                      outcome={activeStep ? activeStep.outcome : null}
                    />
                    <WireDetailCard
                      wire={activeStep && activeStep.id > 0 ? STEP_WIRE[activeStep.id] : null}
                    />
                    <div className="rfp-panel__invariants" data-testid="rfp-invariants">
                      {INVARIANTS.map((inv) => (
                        <div key={inv.title} className="rfp-panel__invariant" style={{ borderLeftColor: inv.color }}>
                          <div className="rfp-panel__invariant-title">
                            {inv.title}
                          </div>
                          <p className="rfp-panel__invariant-text">{inv.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
