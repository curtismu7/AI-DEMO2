import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import './McpScopeTopologyPage.css';

/**
 * Explainer: scope-topology.json (the root source of truth) and how the MCP
 * gateway + BFF enforce it. Claims mirror scope-topology.json,
 * demo_mcp_gateway/src/auth/*.ts, demo_api_server/services/configStore.js and
 * scripts/topology-verify.sh.
 */

const TOPOLOGY_SECTIONS = [
  { key: 'scopes', what: '~29 scope definitions with description, risk level, resource and category. Source for PingOne scope provisioning and the scope docs.' },
  { key: 'resources', what: 'PingOne resource registrations: uri, role, which env var carries the audience, scopes + mirroredScopes. The MCP Gateway resource mirrors every tool scope — a scope crossing an exchange hop must exist on that hop\u2019s resource or PingOne silently drops it (T-10).' },
  { key: 'apps', what: 'PingOne client apps: type, grant types, granted scopes. Feeds bootstrap provisioning.' },
  { key: 'servers', what: 'Per-service enforcement posture. The gateway entry states the contract: validate inbound aud and per-tool requiredScopes BEFORE credential swap.' },
  { key: 'tools', what: '268 tool entries: requiredScopes + surface (gateway / exchange-only / legacy-alias) + challengeType. 26 consent-gated, 13 step-up-gated tools — the same lists the P1AZ snapshot conditions are generated from.' },
  { key: 'policy.authorization', what: 'The money thresholds in one place: $250 consent, $500 step-up, $2,000/$50,000 tier caps — mirrored into the P1AZ snapshot and the banking manifests.' },
  { key: 'mappedClaims', what: 'Scope→token-attribute mapping: every scope maps may_act, delegated_to, is_delegate so delegation chains survive scope minting.' },
  { key: 'deployment', what: 'Master SoT for the public app URL and the PingGateway resource URI; per-env redirects are derived, not hand-set (WebAuthn rp.id constraint documented in-file).' },
];

const FLOW = [
  ['01', 'Declare', 'A tool declares requiredScopes (+ optional challengeType) in scope-topology.json. Generators add vertical tools from manifests — add-only.'],
  ['02', 'Provision', 'Bootstrap mirrors each scope onto the right PingOne resource (mirroredScopes) and registers it with PingFederate (ensure-tool-scopes.sh).'],
  ['03', 'Exchange', 'The BFF validates the requested scope against the RFC 8707 audience allowlist built from scopes + mirroredScopes — unknown audience fails closed (SCOPE_MISMATCH); a missing mirror is the classic "chip greyed out" bug.'],
  ['04', 'Gate', 'The gateway validates inbound aud === mcpgateway.ping.demo and per-tool requiredScopes BEFORE credential swap, then delegates the coarse decision to PingOne Authorize (or the local scope engine in degraded mode, which must mirror the P1AZ outcome).'],
  ['05', 'Challenge', 'Tools with challengeType produce step-up (strong acr required) or HITL consent challenges; consent grants are single-use and amount-bound.'],
  ['06', 'Dispatch', 'After the gate, the gateway swaps credentials (API-key, or re-exchange to backend audiences) and forwards to the MCP resource server.'],
];

const GUARDS = [
  { name: 'npm run topology:verify', what: '12-step offline no-drift gate: manifests↔topology, schema + referential integrity, P1AZ snapshot --check, PingGateway env parity, mock-AS rule parity, tool-schema drift, audience parity, PaC tool lists, resource-audience env, tool-scope registration, byte-identical PingGateway copy of the topology, Groovy filter params.' },
  { name: 'check-tool-scope-registration.js', what: 'Every requiredScopes string in the MCP resource server\u2019s tools must resolve to a scope/alias in the topology — born when Phase-1 tools shipped invented scopes like healthcare:read.' },
  { name: 'gen:tool-schemas + mcp-tool-schemas.json', what: 'Generated from the gateway\u2019s tool registry to both the repo root and ping-gateway/config/; drift is a verify step.' },
  { name: 'check-mcp-gateway-credential-parity.js', what: 'BFF and gateway .env must carry the SAME token-exchanger client id/secret — the exchange chain must use one client identity.' },
  { name: 'authz:verify + auth-requirements.json', what: 'The per-route auth SoT (public / user / admin levels for 301 routes + 100 use cases). The checker parses the actual JSX guards and fails when the file and the code disagree, on stale use-case ids, and when a use case is more public than its route.' },
  { name: 'scopes:doc', what: 'Renders the manifest to demo_api_server/docs/scope-topology.md — generated docs, never hand-edited.' },
];

export default function McpScopeTopologyPage() {
  return (
    <main className="mcp-topo" data-testid="mcp-scope-topology">
      <PageHeader
        eyebrow="MCP gateway · what we configured"
        title="Scope topology & MCP gateway config"
        summary="scope-topology.json is the root source of truth: it feeds PingOne provisioning, the P1AZ snapshot, the gateway's tool scopes, the token-exchange audience allowlists, and the challenge (consent/step-up) tool lists. This page explains what each section means, the enforcement flow, and the drift guards that keep the copies honest."
        actions={
          <Link className="mcp-topo__secondary" to="/scope-reference">
            Scope reference
          </Link>
        }
      />

      <section className="mcp-topo__section" aria-labelledby="mcp-topo-topology">
        <h2 id="mcp-topo-topology">What scope-topology.json defines</h2>
        <ul className="mcp-topo__rows">
          {TOPOLOGY_SECTIONS.map((s) => (
            <li key={s.key} className="mcp-topo__row">
              <h3><code>{s.key}</code></h3>
              <p>{s.what}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mcp-topo__section" aria-labelledby="mcp-topo-flow">
        <h2 id="mcp-topo-flow">How a tool call flows through it</h2>
        <ol className="mcp-topo__flow">
          {FLOW.map(([n, title, body]) => (
            <li key={n} className="mcp-topo__flow-step">
              <span className="mcp-topo__step-num" aria-hidden="true">{n}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mcp-topo__section" aria-labelledby="mcp-topo-guards">
        <h2 id="mcp-topo-guards">Drift guards</h2>
        <ul className="mcp-topo__rows">
          {GUARDS.map((g) => (
            <li key={g.name} className="mcp-topo__row">
              <h3><code>{g.name}</code></h3>
              <p>{g.what}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
