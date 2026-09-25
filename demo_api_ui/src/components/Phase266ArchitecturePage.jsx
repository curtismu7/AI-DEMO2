/**
 * Phase266ArchitecturePage.jsx — /architecture/phase-266
 *
 * Live React Flow render of the Phase 266 three-credential-path architecture:
 *   • Path A (api_key): Gateway calls banking_api_resource_server :8082 via X-API-Key (amber, Phase 267)
 *   • Path B (dual_token): Gateway POSTs to banking_resource_server /identity (teal)
 *   • Path C (oauth_bearer): Gateway GETs banking_resource_server /accounts + /transactions (blue)
 *
 * Converted from the original Mermaid source to the shared StaticFlowDiagram
 * React Flow renderer — same nodes/edges/groups, plus the PathFilterBar
 * dimming now driven by node `path` data instead of SVG tag scraping, and
 * per-node click details.
 */
import { useMemo, useState } from "react";
import { PathFilterBar } from "./diagram";
import StaticFlowDiagram from "./StaticFlowDiagram";
import "./Phase266ArchitecturePage.css";

// Module-level paths constant — consumed by the shared PathFilterBar component
const P266_PATHS = [
  { key: null,  label: "All",                  color: null      },
  { key: "A",   label: "Path A — API-key",      color: "#b45309" },
  { key: "B",   label: "Path B — Dual Token",   color: "#0f766e" },
  { key: "C",   label: "Path C — OAuth Bearer", color: "#1e40af" },
];

const MERMAID_SOURCE = `flowchart TB
    classDef user fill:#e0e7ff,stroke:#3730a3,color:#1e1b4b,stroke-width:2px
    classDef bff fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:2px
    classDef gw fill:#fef3c7,stroke:#b45309,color:#78350f,stroke-width:3px
    classDef as fill:#fce7f3,stroke:#9d174d,color:#831843,stroke-width:2px
    classDef rs fill:#d1fae5,stroke:#047857,color:#064e3b,stroke-width:2px
    classDef db fill:#e5e7eb,stroke:#374151,color:#111827,stroke-width:2px
    classDef aspirational stroke-dasharray: 5 5,fill:#fef9c3,stroke:#a16207,color:#713f12
    classDef mortgage fill:#fef3c7,stroke:#b45309,color:#78350f,stroke-width:3px

    User([User<br/>browser])
    SPA["SPA<br/>banking_api_ui :4000<br/>───────────────<br/>3 result pages:<br/>• ResourceServerPage (blue)<br/>• ApiKeyPathPage (amber)<br/>• AccessIdTokenPathPage (teal)"]

    subgraph BFF ["banking_api_server :3001 (BFF + traffic terminus)"]
        Session[("Express session<br/>oauthTokens.accessToken<br/>oauthTokens.idToken")]
        InternalIdToken["/internal/id-token<br/>───────────<br/>secret-gated<br/>server-to-server"]
        PathInfo["/api/path/apikey-info<br/>───────────<br/>masked apiKey last4<br/>(Path A info marker)"]

        subgraph RS ["banking_resource_server<br/>(routes/resourceServer.js + authenticateToken)"]
            Summary["GET /summary<br/>existing — untouched"]
            Identity["POST or GET /identity<br/>───────────<br/>decodes access+id tokens<br/>act-chain audit log<br/>scrubRawJwts walker"]
            Accounts["GET /accounts<br/>───────────<br/>reads LMDB"]
            Transactions["GET /transactions<br/>───────────<br/>reads LMDB"]
        end

        BankingDb[("banking_api_server/<br/>data/persistent/lmdb/<br/>banking_accounts + banking_transactions<br/>───────────<br/>seeded from store.js<br/>on first boot")]
    end

    Gateway{"banking_mcp_gateway :3005<br/><b>TRAFFIC COP</b><br/>━━━━━━━━━━━━━<br/>routeTool(name) →<br/>credentialPath<br/>━━━━━━━━━━━━━<br/>selectCredentialForBackend()<br/>━━━━━━━━━━━━━<br/>synthesizes _meta.tokenEvents"}

    PingOne["PingOne AS<br/>━━━━━━━━━━<br/>RFC 8693 /token<br/>RFC 7662 /introspect<br/>RFC 7517 /jwks"]

    ApiResourceServer["banking_api_resource_server :8082<br/>━━━━━━━━━━━━━<br/>X-API-Key gate<br/>GET /mortgage<br/>━━━━━━━━━━━━━<br/>returns dummy mortgage record<br/>(no OAuth involved)"]:::mortgage

    User -- "1. OIDC login<br/>(OIDC Core)" --> SPA
    SPA -- "session cookie" --> Session
    Session -- "id_token persisted<br/>(oauthUser.js:471)" --> Session

    SPA -- "2. 'show my profile card'<br/>via bffAxios → BankingAgent" --> Gateway

    Gateway -- "3. RFC 8693 token exchange<br/>━━━━━━━━━━━━━━━<br/>grant_type=token-exchange<br/>subject_token=user-bearer<br/>actor=gateway-client (Basic auth)<br/>audience=banking_resource_server" --> PingOne
    PingOne -- "exchanged token<br/>━━━━━━━━━━━━━━━<br/>aud=banking_resource_server<br/>act.client_id=gateway-client<br/>(JAG audit trail)" --> Gateway

    Gateway -- "fetches id_token<br/>(server-to-server,<br/>secret-gated)" --> InternalIdToken
    InternalIdToken --> Session

    Gateway == "<b>Path A: api_key</b><br/>━━━━━━━━━━━━━<br/>GET /mortgage<br/>X-API-Key: SERVICE_KEY<br/>X-User-Sub: user<br/>(no OAuth bearer)" ==> ApiResourceServer
    ApiResourceServer -- "mortgage record<br/>(JSON)" --> Gateway
    Gateway -- "Path A response<br/>credentialPath: api_key<br/>+ masked last4" --> SPA
    SPA -- "navigate(/path/mortgage,<br/>state: mortgagePayload)" --> PathInfo

    Gateway == "<b>Path B: dual_token</b><br/>━━━━━━━━━━━━━━<br/>POST /api/resource-server/identity<br/>Authorization: Bearer EXCHANGED<br/>body: {jsonrpc, params:{idToken}}" ==> Identity

    Gateway == "<b>Path C: oauth_bearer</b><br/>━━━━━━━━━━━━━━<br/>GET /api/resource-server/accounts<br/>Authorization: Bearer EXCHANGED" ==> Accounts
    Gateway == "GET /api/resource-server/transactions<br/>Authorization: Bearer EXCHANGED" ==> Transactions

    Accounts -- "bankingDb.getAccountsByUserId<br/>(parameterized SQL)" --> BankingDb
    Transactions -- "bankingDb.getTransactionsByUserId<br/>(parameterized SQL)" --> BankingDb

    Identity -. "authenticateToken middleware<br/>━━━━━━━━━━━━<br/>RFC 7515 sig (JWKS)<br/>RFC 8707 aud check<br/>optional RFC 7662 introspect" .-> PingOne
    Accounts -. "same validation" .-> PingOne
    Transactions -. "same validation" .-> PingOne

    Identity -- "claims only<br/>(sanitizeClaims +<br/>scrubRawJwts)<br/>NO raw JWT" --> Gateway
    Accounts -- "LMDB rows" --> Gateway
    Transactions -- "LMDB rows" --> Gateway
    Gateway -- "_meta.credentialPath +<br/>_meta.tokenEvents" --> SPA

    SPA -. "existing<br/>(unchanged)" .-> Summary

    class User user
    class SPA bff
    class Gateway gw
    class PingOne as
    class RS,Identity,Accounts,Transactions,Summary rs
    class Session,InternalIdToken,PathInfo bff
    class BankingDb db
`;

// Node → credential-path mapping (drives the PathFilterBar dimming). Shared
// nodes have no path and stay at full opacity under every selection.
const PATH_NODE_MAP = {
  A: ["ApiResourceServer", "PathInfo"],
  B: ["Identity", "InternalIdToken"],
  C: ["Accounts", "Transactions", "BankingDb"],
};

// ─── Graph data (converted from MERMAID_SOURCE) ─────────────────────────────

const P266_GROUPS = {
  bff: { label: "banking_api_server :3001 (BFF + traffic terminus)", bg: "#1e40af" },
  rs: { label: "banking_resource_server (authenticateToken)", bg: "#047857" },
};

const P266_NODES = [
  { id: "User", group: "bff", label: "User / browser", x: 0, y: 40 },
  {
    id: "SPA", group: "bff", label: "SPA — banking_api_ui :4000",
    sub: ["3 result pages:", "ResourceServerPage (blue)", "ApiKeyPathPage (amber)", "AccessIdTokenPathPage (teal)"],
    x: 0, y: 160,
  },
  {
    id: "Session", group: "bff", label: "Express session",
    sub: ["oauthTokens.accessToken", "oauthTokens.idToken"],
    x: 0, y: 330,
  },
  { id: "InternalIdToken", group: "bff", label: "/internal/id-token", sub: ["secret-gated", "server-to-server"], path: "B", x: 0, y: 460 },
  { id: "PathInfo", group: "bff", label: "/api/path/apikey-info", sub: ["masked apiKey last4", "(Path A info marker)"], path: "A", x: 0, y: 470 },

  { id: "Summary", group: "rs", label: "GET /summary", sub: ["existing — untouched"], x: 260, y: 40 },
  { id: "Identity", group: "rs", label: "POST or GET /identity", sub: ["decodes access+id tokens", "act-chain audit log", "scrubRawJwts walker"], path: "B", x: 260, y: 160 },
  { id: "Accounts", group: "rs", label: "GET /accounts", sub: ["reads LMDB"], path: "C", x: 260, y: 300 },
  { id: "Transactions", group: "rs", label: "GET /transactions", sub: ["reads LMDB"], path: "C", x: 260, y: 430 },

  { id: "BankingDb", group: "bff", label: "LMDB store", sub: ["data/persistent/lmdb/", "banking_accounts +", "banking_transactions"], path: "C", x: 0, y: 610 },

  {
    id: "Gateway", group: "bff", label: "banking_mcp_gateway :3005 — TRAFFIC COP",
    sub: ["routeTool(name) → credentialPath", "selectCredentialForBackend()", "synthesizes _meta.tokenEvents"],
    x: 520, y: 160,
  },
  { id: "PingOne", group: "bff", label: "PingOne AS", sub: ["RFC 8693 /token", "RFC 7662 /introspect", "RFC 7517 /jwks"], x: 520, y: 470 },
  {
    id: "ApiResourceServer", group: "bff", label: "banking_api_resource_server :8082",
    sub: ["X-API-Key gate", "GET /mortgage", "(no OAuth involved)"],
    path: "A", x: 520, y: 620,
  },
];

const P266_EDGES = [
  ["User", "SPA", "1. OIDC login (OIDC Core)"],
  ["SPA", "Session", "session cookie"],
  ["SPA", "Gateway", "2. 'show my profile card' via bffAxios → BankingAgent"],
  ["Gateway", "PingOne", "3. RFC 8693 token exchange — subject=user bearer, actor=gateway-client, aud=banking_resource_server"],
  ["PingOne", "Gateway", "exchanged token — aud=banking_resource_server, act.client_id=gateway-client"],
  ["Gateway", "InternalIdToken", "fetches id_token (secret-gated)"],
  ["InternalIdToken", "Session", null],
  ["Gateway", "ApiResourceServer", "Path A: api_key — GET /mortgage, X-API-Key + X-User-Sub (no OAuth bearer)", { dashed: false, color: "#b45309" }],
  ["ApiResourceServer", "Gateway", "mortgage record (JSON)", { color: "#b45309" }],
  ["Gateway", "SPA", "Path A response — credentialPath: api_key + masked last4", { color: "#b45309" }],
  ["SPA", "PathInfo", "navigate(/path/mortgage, state: mortgagePayload)", { color: "#b45309" }],
  ["Gateway", "Identity", "Path B: dual_token — POST /identity, Bearer EXCHANGED + idToken body", { color: "#0f766e" }],
  ["Gateway", "Accounts", "Path C: oauth_bearer — GET /accounts, Bearer EXCHANGED", { color: "#1e40af" }],
  ["Gateway", "Transactions", "GET /transactions, Bearer EXCHANGED", { color: "#1e40af" }],
  ["Accounts", "BankingDb", "getAccountsByUserId (parameterized SQL)"],
  ["Transactions", "BankingDb", "getTransactionsByUserId (parameterized SQL)"],
  ["Identity", "PingOne", "authenticateToken — RFC 7515 sig (JWKS), RFC 8707 aud, optional RFC 7662", { dashed: true }],
  ["Accounts", "PingOne", "same validation", { dashed: true }],
  ["Transactions", "PingOne", "same validation", { dashed: true }],
  ["Identity", "Gateway", "claims only (sanitizeClaims + scrubRawJwts), NO raw JWT"],
  ["Accounts", "Gateway", "LMDB rows"],
  ["Transactions", "Gateway", "LMDB rows"],
  ["Gateway", "SPA", "_meta.credentialPath + _meta.tokenEvents"],
  ["SPA", "Summary", "existing (unchanged)", { dashed: true }],
];

// Per-node click detail (teaching values).
const P266_NODE_DETAILS = {
  Gateway: "Route tool name → credential path, exchange the user bearer (RFC 8693, actor=gateway-client), and stamp _meta.credentialPath + _meta.tokenEvents on the response.",
  PingOne: "Issues and exchanges tokens: RFC 8693 /token, RFC 7662 /introspect, RFC 7517 JWKS.",
  Identity: "Path B target. Decodes access + id tokens, writes the act-chain audit log, and scrubs raw JWTs from the response body.",
  Accounts: "Path C target. LMDB-backed account read behind authenticateToken.",
  Transactions: "Path C target. LMDB-backed transaction read behind authenticateToken.",
  ApiResourceServer: "Path A target. X-API-Key gate, no OAuth — the one credential path that skips OAuth entirely.",
  InternalIdToken: "Secret-gated server-to-server endpoint the gateway uses to fetch the id_token for Path B.",
  Session: "Express session holds oauthTokens; the browser holds only the cookie.",
  BankingDb: "LMDB persistence seeded from store.js on first boot.",
};


const SPEC_HOPS = [
  { label: "OIDC Core 1.0", summary: "id_token issuance + claims (§3.1.3.7)" },
  {
    label: "RFC 6750",
    summary: "Bearer in Authorization header; RS validates aud/exp/sig",
  },
  {
    label: "RFC 8693",
    summary:
      "Token exchange — gateway swaps user bearer for backend-scoped token",
  },
  {
    label: "RFC 8707",
    summary: "Audience binding — exchanged token aud must match RS",
  },
  { label: "RFC 7515/7517/8414", summary: "JWKS-based local validation by RS" },
  {
    label: "RFC 7662",
    summary: "Optional introspection layer when ff_introspection_required=true",
  },
  {
    label: "RFC 9728",
    summary:
      "Protected Resource Metadata (gateway publishes /.well-known/oauth-protected-resource)",
  },
  {
    label: "draft-ietf-oauth-identity-chaining",
    summary: 'act-claim audit trail — proves "gateway-agent acted for user"',
  },
  {
    label: "MCP 2025-11-25",
    summary:
      "Gateway MUST exchange tokens before forwarding to downstream resource",
  },
];

const FLOWCHART_OPTS = { htmlLabels: true, useMaxWidth: true, curve: "basis" };

export default function Phase266ArchitecturePage() {
  const [selectedPath, setSelectedPath] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  const nodeDetail = selectedNode
    ? P266_NODE_DETAILS[selectedNode.id] ||
      `${selectedNode.data.label} — participant in the Phase 266 flow.`
    : null;

  return (
    <div className="p266-arch-page">
      <header className="p266-arch-header">
        <span className="p266-arch-eyebrow">Phase 266</span>
        <h1>Three Credential Paths — Architecture</h1>
        <p className="p266-arch-subtitle">
          One Gateway, three credential mechanisms. Live React Flow render —
          same graph as the Mermaid original, now interactive: filter by path
          and click any node for its role.
        </p>
        <p className="p266-arch-subtitle">
          Scope: this view is intentionally limited to the Phase 266
          credential-disposition paths. The investment MCP server
          (banking_mcp_resource_server) and HITL consent service (banking_hitl_service)
          are out of scope here — see the Flow and Token Flow pages for those.
        </p>
        <p className="p266-arch-subtitle">
          <strong>Historical snapshot.</strong> The diagram below is kept from
          Phase 266's plan-approval time, including its original{" "}
          <code>banking_*</code> service naming (this repo's directories/containers
          are now <code>demo_*</code>/<code>ai-demo-*</code>). For the current
          service topology, see{" "}
          <a href="/architecture/overview">Architecture Overview</a>.
        </p>
      </header>

      <PathFilterBar paths={P266_PATHS} selectedPath={selectedPath} onSelect={(p) => { setSelectedPath(p); setSelectedNode(null); }} className="p266-filter-bar" />

      <section
        className={[
          "p266-arch-diagram-wrapper",
          selectedPath ? "p266-path-active" : "",
        ].filter(Boolean).join(" ")}
        {...(selectedPath ? { "data-selected-path": selectedPath } : {})}
      >
        <StaticFlowDiagram
          NODES={P266_NODES}
          EDGES={P266_EDGES}
          GROUPS={P266_GROUPS}
          selectedPath={selectedPath}
          onNodeClick={(node) => setSelectedNode(selectedNode?.id === node.id ? null : node)}
          testId="p266-flow-diagram"
          height={640}
        />
      </section>

      {nodeDetail && (
        <div className="p266-arch-node-detail" role="status">
          <strong>{selectedNode.data.label}</strong>
          <p>{nodeDetail}</p>
        </div>
      )}

      <section className="p266-arch-spec-section">
        <h2>Specs exercised by this flow</h2>
        <p className="p266-arch-spec-intro">
          Phase 266 is spec-compliant end-to-end. Every hop in the diagram cites
          a specific IETF / OIDC / MCP standard:
        </p>
        <dl className="p266-arch-spec-list">
          {SPEC_HOPS.map((s) => (
            <div key={s.label} className="p266-arch-spec-row">
              <dt>{s.label}</dt>
              <dd>{s.summary}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="p266-arch-notes">
        <h2>Key architectural decisions</h2>
        <ul>
          <li>
            <strong>Gateway = traffic cop.</strong> Single point that decides
            routing, performs RFC 8693 exchange, and emits{" "}
            <code>_meta.credentialPath</code> +<code>_meta.tokenEvents</code> so
            the SPA renders the right surface and the audit chain is visible.
          </li>
          <li>
            <strong>Inbound user bearer is NEVER forwarded unchanged.</strong>{" "}
            Paths B and C both go through PingOne RFC 8693 first; the new
            token's
            <code>aud=banking_resource_server</code> and{" "}
            <code>act.client_id=gateway-client</code>.
          </li>
          <li>
            <strong>id_token never reaches the browser as raw JWT.</strong>{" "}
            Decoded server-side via <code>sanitizeClaims</code>;{" "}
            <code>scrubRawJwts</code> walker on the response body as
            defense-in-depth.
          </li>
          <li>
            <strong>
              Existing <code>/summary</code> route preserved untouched.
            </strong>{" "}
            <code>ResourceServerPage.jsx</code> continues to use it; new
            LMDB-backed
            <code>/accounts</code> + <code>/transactions</code> routes are
            siblings.
          </li>
          <li>
            <strong>Audit trail per request.</strong> Every successful{" "}
            <code>/identity</code> call logs an <code>INTROSPECTION</code>
            -category event with <code>{"{ sub, aud, act, may_act }"}</code> —
            explicitly NOT PII (no name/email/picture).
          </li>
        </ul>
      </section>
    </div>
  );
}
