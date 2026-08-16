/**
 * Phase266ArchitecturePage.jsx — /architecture/phase-266
 *
 * Live Mermaid render of the Phase 266 three-credential-path architecture:
 *   • Path A (api_key): Gateway calls banking_api_resource_server :8082 via X-API-Key (amber, Phase 267)
 *   • Path B (dual_token): Gateway POSTs to banking_resource_server /identity (teal)
 *   • Path C (oauth_bearer): Gateway GETs banking_resource_server /accounts + /transactions (blue)
 *
 * The diagram is rendered client-side via mermaid@11 — no PNG export step.
 * The mermaid source matches the diagram presented at plan-approval time.
 */
import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { PathFilterBar } from "./diagram";
import DiagramExportBar from "./DiagramExportBar";
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

// Node identifier strings from the Mermaid source that map to each path.
// tagPathNodes() checks whether a <g>'s text content *contains* one of these
// strings. More specific strings first to avoid substring false-positives.
const PATH_NODE_MAP = {
  A: ["ApiResourceServer", "PathInfo"],
  B: ["Identity", "InternalIdToken"],
  C: ["Accounts", "Transactions", "BankingDb"],
  shared: ["User", "SPA", "Gateway", "PingOne", "Session"],
};

/**
 * Walk all <g> elements in the rendered Mermaid SVG and stamp data-path
 * attributes so CSS can dim/highlight nodes by path selection.
 * Called once after mermaid.render() injects the SVG.
 */
function tagPathNodes(container) {
  const groups = container.querySelectorAll("g");
  groups.forEach((g) => {
    const text = g.textContent || "";
    for (const [path, identifiers] of Object.entries(PATH_NODE_MAP)) {
      if (identifiers.some((id) => text.includes(id))) {
        g.setAttribute("data-path", path);
        break; // first match wins
      }
    }
  });
}


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

export default function Phase266ArchitecturePage() {
  const containerRef = useRef(null);
  const [source, setSource] = useState(MERMAID_SOURCE);
  const [renderError, setRenderError] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const renderIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setRenderError(null);
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
      flowchart: { htmlLabels: true, useMaxWidth: true, curve: "basis" },
    });

    async function render() {
      try {
        const id = `phase266-architecture-svg-${++renderIdRef.current}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          tagPathNodes(containerRef.current);
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err?.message || "Mermaid render failed");
        }
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const wrapperClass = [
    "p266-arch-diagram-wrapper",
    selectedPath ? "p266-path-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="p266-arch-page">
      <header className="p266-arch-header">
        <span className="p266-arch-eyebrow">Phase 266</span>
        <h1>Three Credential Paths — Architecture</h1>
        <p className="p266-arch-subtitle">
          One Gateway, three credential mechanisms. Live Mermaid render —
          matches the diagram approved before execution.
        </p>
        <p className="p266-arch-subtitle">
          Scope: this view is intentionally limited to the Phase 266
          credential-disposition paths. The investment MCP server
          (banking_mcp_resource_server) and HITL consent service (banking_hitl_service)
          are out of scope here — see the Flow and Token Flow pages for those.
        </p>
        <p className="p266-arch-subtitle">
          <strong>Historical snapshot.</strong> The diagram below is kept verbatim
          from Phase 266's plan-approval time, including its original{" "}
          <code>banking_*</code> service naming (this repo's directories/containers
          are now <code>demo_*</code>/<code>ai-demo-*</code>). For the current
          service topology, see{" "}
          <a href="/architecture/overview">Architecture Overview</a>.
        </p>
      </header>

      <PathFilterBar paths={P266_PATHS} selectedPath={selectedPath} onSelect={setSelectedPath} className="p266-filter-bar" />

      <DiagramExportBar
        source={source}
        sourceFilename="phase266-architecture.mmd"
        onSourceChange={(s) => { setSource(s); setSelectedPath(null); }}
      />

      <section
        className={wrapperClass}
        {...(selectedPath ? { "data-selected-path": selectedPath } : {})}
      >
        {renderError ? (
          <div className="p266-arch-error">
            <strong>Diagram failed to render:</strong> {renderError}
          </div>
        ) : (
          <div ref={containerRef} className="p266-arch-diagram" />
        )}
      </section>

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
