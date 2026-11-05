import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import './PingGatewayRoutesPage.css';

/**
 * Explainer: every PingGateway route in ping-gateway/config/routes/, what it
 * enforces, and the gateway-vs-P1AZ division of labor. Claims mirror the route
 * JSON, docs/p1az-vs-gateway-token-checks.md and docs/gateway-enforcement-map.md.
 */

const ROUTES = [
  {
    name: 'mcp-olb-primary (01-mcp-olb.json)',
    path: '^/mcp (main banking route)',
    what: 'The core banking MCP path. PingOne introspection (scope gateway:mcp:invoke), MCP audit + body buffering + tool-argument schema validation, rate limiting (UC18), then the P1AZ decision; on PERMIT a scripted RFC 8693 exchange mints a backend-audience token before proxying to the OLB backend. A privilege bridge filter fronts the chain.',
    uc: 'All main use cases: transfers, RAR, tiers, HITL, A2A, UC16, UC18',
  },
  {
    name: 'mcp-olb-jwks (00-mcp-olb-jwks.json)',
    path: '^/mcp + X-Token-Validation: jwks',
    what: 'The JWKS variant of the main route — local signature validation instead of introspection, selected by BFF flag ff_mcp_gateway_jwks. Same validation chain and P1AZ decision.',
    uc: 'Same as primary, JWKS validation mode',
  },
  {
    name: 'mcp-apikey-primary / mcp-apikey-jwks (00-mcp-apikey*.json)',
    path: '^/mcp/apikey',
    what: 'API-key credential mediation. The api-key route defines its OWN OAuth2ResourceServerFilter because the PingOne introspect client only accepts client_secret_post — the shared rsFilter uses Basic and gets invalid_client. Checks apikey:mcp:invoke, then P1AZ, then dispatch swaps in the vault-held X-API-Key.',
    uc: 'API-key lane with per-tool P1AZ authz',
  },
  {
    name: 'mcp-resource-server-secondary / -jwks (02-, 00-mcp-resource-server*)',
    path: '^/mcp/invest',
    what: 'The SQLite banking resource server route. After the P1AZ decision, OAuth2TokenExchangeFilter exchanges the inbound bearer for scopes/audience of the invest resource, and a HeaderFilter swaps the Authorization header — the inbound token is never forwarded.',
    uc: 'D-05 / audience-exchange demo',
  },
  {
    name: 'mcp-external-door (00-mcp-external-door.json)',
    path: '^/mcp AND Host cmuir-mcp.ping-devops.com',
    what: 'For external agents (ChatGPT, Claude) whose tokens come from oauth-mcp\u2019s own embedded AS via DCR/CIMD — they cannot get a PingOne token. Introspects against oauth-mcp\u2019s RFC 7662 endpoint, requires mcp:invoke (deliberately not the gateway scope), then P1AZ. The Authorization header is NOT exchanged: the gateway authorizes, the MCP server authenticates, neither trusts the other\u2019s word.',
    uc: 'UC-MUSE1 external agent standard lane',
  },
  {
    name: 'mcp-oauth-bootstrap (00-mcp-oauth-bootstrap.json)',
    path: '/.well-known/*, /register, /authorize, /token, /jwks …',
    what: 'Unauthenticated passthrough of the embedded AS metadata and endpoints to oauth-mcp. Deliberately excludes /introspect and /revoke; grants no data access.',
    uc: 'External-agent discovery + registration',
  },
  {
    name: 'mcp-weather-primary (00-mcp-weather.json)',
    path: '^/mcp/weather',
    what: 'Third-party weather MCP with NO token validation and NO P1AZ — the gateway scope policy (tx-weather-scope.groovy + scope-topology.json) is the control. Live scope-policy reconfigure changes the verdict without a redeploy.',
    uc: 'UC30 Austin permit, UC31 Miami deny, UC32 live reconfigure',
  },
  {
    name: 'mcp-brave-primary (00-mcp-brave.json)',
    path: '^/mcp/brave',
    what: 'Third-party Brave search MCP: audit, JWKS validation, transaction-scope stamping, reverse proxy. No P1AZ decision on this route.',
    uc: 'brave-mcp-search-permit / crypto-deny demos',
  },
  {
    name: 'mcp-delegation (03-mcp-delegation.json)',
    path: '^/mcp/delegation',
    what: 'Phase 2 RFC 8693 delegation demo. Own introspection client, own scope/audience; the authorization is a dedicated validator that enforces the act claim — no P1AZ call on this route.',
    uc: 'delegated-access-with-proof (act-claim) use cases',
  },
  {
    name: 'authorize-account-context (03-authorize-account-context.json)',
    path: '^/authorize/account-context (private)',
    what: 'Plumbing, not a demo surface: the P1AZ resolver backend that lets p1az-decision.groovy read account context from the internal resource server, with the caller\u2019s credentials stripped and the service key injected.',
    uc: 'Internal — P1AZ attribute resolution',
  },
  {
    name: 'aam-api-access (04-aam-api-access.json)',
    path: '^/aam/* (only when PG_AAM_SERVICE_URL set)',
    what: 'The stock PingOne Authorize AAM integration — coarse-grained via the built-in PingAuthorizeFilter posting method/path/headers to the Sideband API, unlike the /mcp routes\u2019 fine-grained Decision-Endpoint calls. Gotchas encoded: gatewayServiceUri must be a raw token (not an env expression), and a CaptureDecorator is needed because global streamingEnabled blocks stream reads in scriptable filters.',
    uc: 'Standalone AAM sideband demo',
  },
  {
    name: 'health (00-health.json)',
    path: '^/health',
    what: 'Readiness probe that returns 503 when the real P1AZ backend is unconfigured — the fix for a 2026-07-12 outage where tcpSocket probes passed while P1AZ was down.',
    uc: 'Operations',
  },
];

export default function PingGatewayRoutesPage() {
  return (
    <main className="pg-routes" data-testid="pinggateway-routes">
      <PageHeader
        eyebrow="PingGateway · what we configured"
        title="PingGateway routes & AAM config"
        summary="Every route in ping-gateway/config/routes/, what it enforces, and the split of labor between gateway checks and PingOne Authorize. Route selection is by the JSON name field, not the filename — that is why the JWKS variants sort ahead of the primaries."
        actions={
          <Link className="pg-routes__secondary" to="/privilege-gateway-topologies">
            Gateway topologies
          </Link>
        }
      />

      <section className="pg-routes__section" aria-labelledby="pg-routes-labor">
        <h2 id="pg-routes-labor">Gateway vs. P1AZ — who checks what</h2>
        <p>
          P1AZ never sees the token: it receives a flat map of string parameters and decides
          whether a genuine token with those facts may do the thing. The gateway (or BFF) verifies
          everything about whether the token is genuine and live — signature, expiry, revocation,
          DPoP. Five checks the P1AZ DSL cannot express (ISO-vs-epoch time, set membership) are
          enforced at the gateway as local backstops before the PDP call: temporal, per-tool
          scope, RAR payee, D-05 multi-audience, tier flattening. On the gateway, DENY,
          INDETERMINATE, error, timeout, or an unconfigured backend all fail closed.
        </p>
        <p className="pg-routes__ref">
          <span aria-hidden="true">🔍</span>{' '}
          <code>docs/p1az-vs-gateway-token-checks.md · docs/gateway-enforcement-map.md (generated)</code>
        </p>
      </section>

      <section className="pg-routes__section" aria-labelledby="pg-routes-list">
        <h2 id="pg-routes-list">The routes</h2>
        <ul className="pg-routes__rows">
          {ROUTES.map((r) => (
            <li key={r.name} className="pg-routes__row">
              <h3>{r.name}</h3>
              <p className="pg-routes__path">{r.path}</p>
              <p>{r.what}</p>
              <p className="pg-routes__uc">{r.uc}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="pg-routes__section" aria-labelledby="pg-routes-top">
        <h2 id="pg-routes-top">Gateway-level config</h2>
        <p>
          <code>admin.json</code>: production mode, connectors on 8080 (plain) and 8443 (TLS,
          PKCS12 store, alias api.ping.demo), and OpenTelemetry tracing to Jaeger — IG was the
          missing component in the distributed trace. <code>config.json</code>: the shared heap
          every route references — SecretsStore, PingOne introspection handler + resolver, the
          global rsFilter (default scope mcp:invoke), token-exchange endpoint + 401 failure
          handlers, and the JSON audit service.
        </p>
      </section>
    </main>
  );
}
