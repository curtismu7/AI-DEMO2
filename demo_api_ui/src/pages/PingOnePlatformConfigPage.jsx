import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from '../components/pingUi';
import './PingOnePlatformConfigPage.css';

/**
 * Explainer: the PingOne SaaS platform objects this demo provisions — apps,
 * resources, scopes, users, groups, DaVinci, Protect/Verify — grouped by
 * purpose. Claims mirror demo_api_server/services/pingoneProvisionService.js
 * (provisionEnvironment) and demo_api_server/.env.example. Scope-topology.json
 * is the source of truth for scopes/resources; the older matrix docs are
 * historical snapshots.
 *
 * Layout follows the Ping UI Standard on the shared primitives (components/pingUi,
 * docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips, P9 button.
 * Skipped: P6 (not an inspector), P8 (no diagram). The standalone shell bar is not added (the
 * app has its own).
 *
 * Honesty: this is a static lesson. It never calls PingOne, so no chip says "configured" or
 * "present". The chip says where the claim comes from (the provisioning code), or that the
 * object is flag-gated or not provisioned at all, as the text of that row already says.
 *
 * P9, one primary per view state: "PingOne setup" (a link in the header) is the only action and
 * so the only primary. The page has a single state (static text), so there is nothing to choose.
 */

const RESOURCES = [
  { name: 'Demo API', aud: 'enduser.ping.demo', what: 'End-user and admin token audience; also the RFC 8693 subject-token audience. Scopes: read, write, transfer, accounts:read, transactions:read + one per vertical (mortgage:read, gear:read, …).' },
  { name: 'Demo MCP Server', aud: 'mcpserver.ping.demo', what: 'Backend MCP tool-execution audience; holds mcp:invoke.' },
  { name: 'Demo MCP Gateway', aud: 'mcpgateway.ping.demo', what: 'Inbound audience for the MCP Gateway and Exchange #2 target. Mirrors the tool scopes — a scope travelling through an exchange hop must exist on that hop\u2019s resource or PingOne silently drops it.' },
  { name: 'Demo Agent Gateway', aud: 'agentgateway.ping.demo', what: 'Two-Exchange step 1 audience for the AI Agent actor token; carries literal may_act so Exchange #2 emits act.' },
  { name: 'Super Banking A2A MCP Gateway', aud: 'mcpgateway-a2a.ping.demo', what: 'A2A specialists\u2019 Exchange #2 destination, deliberately separate from the shared MCP Gateway so the nested-act composer only touches A2A tokens.' },
  { name: 'A2A Intermediates ×10', aud: 'a2a-intermediate-<app>.ping.demo', what: 'One per specialist (Investment Advisor, Records, Purchase History, …): RFC 8707 audience isolation — a token minted for one specialist cannot be replayed at another.' },
  { name: 'Demo PingGateway MCP', aud: 'https://api.ping.demo:3036/mcp', what: 'PingGateway MCP route audience. A separate /mcp/apikey resource prevents replay of an /mcp token against the API-key route.' },
  { name: 'PingOne API (built-in)', aud: 'https://api.pingone.com', what: 'Management API — the worker app\u2019s audience. Custom p1:* scopes are rejected; workers get rights via role assignment instead.' },
];

const APPS = [
  { name: 'Demo AI App - User Login', type: 'WEB_APP (public PKCE)', use: 'Customer (end-user) BFF login. No secret since 2026-08-24. Gets the Agent Consent agreement and the Agent-Consent-Login sign-on policy.' },
  { name: 'Demo AI App - Admin Login', type: 'WEB_APP, secret + PKCE', use: 'Staff/admin BFF login; also the exchange client for admin delegation. Token 7200s / refresh 86400s; callbacks on all known origins.' },
  { name: 'Demo AI App - Token Exchanger', type: 'WEB_APP', use: 'The RFC 8693 actor for the BFF→gateway exchange; Exchange #2 actor in two-exchange. Aliased as AGENT_OAUTH_CLIENT_ID.' },
  { name: 'Demo AI App - MCP Gateway', type: 'WEB_APP', use: 'The gateway\u2019s re-exchange client (Exchange #2: gateway → MCP server). The gateway exits at startup if its credentials are missing.' },
  { name: 'Demo AI App - AI Agent Actor', type: 'WEB_APP', use: 'Two-Exchange step 1 actor: user→agent delegation (act.sub) with PAR intent binding. Client id is pinned in docs/PINGONE_APP_CONFIG.md.' },
  { name: 'Demo AI App - MCP Server Client', type: 'WEB_APP (deliberately not WORKER)', use: 'The MCP server process\u2019s client identity; introspects gateway tokens. A WORKER type would silently lose resource grants and fail every introspection with active:false.' },
  { name: 'Demo AI App - Agent Actor', type: 'WORKER', use: 'Agent service internal auth (client_credentials).' },
  { name: 'Demo AI App - {Vertical} Specialist Agent ×10', type: 'WEB_APP', use: 'A2A specialists (Agent 2); each granted only its derived narrow scope.' },
  { status: 'Set up in console', name: 'Demo AI App - CIBA (+ CIBA SMS)', type: 'OIDC Web App, CIBA grant only, basic auth', use: 'Real CIBA banking approvals. Each delivery channel (email/SMS) is its own app with its own DaVinci flow policy; fails closed when unset.' },
  { name: 'PingOne MCP Server', type: 'WORKER, PKCE', use: 'Dev tooling: AI assistants → hosted PingOne MCP. MUST be WORKER — a native-app token only carries self-service p1 scopes and the hosted MCP denies admin tools.' },
  { name: 'Claude Code - Banking Gateway', type: 'NATIVE_APP, PKCE', use: 'Claude Code → the local MCP Gateway over MCP OAuth.' },
  { name: 'Hosted-access app', type: 'OIDC web', use: 'SE hosted front-door registration client; the groups claim is wired onto it.' },
  { status: 'Opt-in script', name: 'Autonomous agents (Fraud Watch, Balance Sweep)', type: 'WEB_APP', use: 'Created by npm run pingone:provision-autonomous-agents --apply.' },
];

const USERS_GROUPS = [
  { name: 'demoUser / demoAdmin / demoDelegate', what: 'Three seeded users (population default, permissive "Demo Password Policy"). demoDelegate carries the isDelegate custom attribute; demoUser and demoAdmin also get Management-API role assignments so interactive logins are not denied "no role assignments".' },
  { name: 'Custom schema: isDelegate, mayAct, delegatedTo, a2aTenantId, agentRestrictions, bankingPrincipalUserId', what: 'The token claims (may_act, delegated_to, is_delegate, a2a_tenant_id, act) read these via ${user.…} resource-attribute mappings — ${…} evaluates; #{…} would be emitted verbatim.' },
  { status: 'From vertical manifests', name: 'Vertical groups (UC9 + UC21)', what: 'AI_Demo_Privileged (privileged-tool access), AI_Demo_Delegates, and per-vertical tier groups (e.g. Banking_PremiumTier → PrivateBanking, $50,000 cap; default Standard, $2,000 cap, restricted tools). demoUser is in the privileged + tier groups; demoDelegate deliberately is not. Live membership lookup wins over the manifest; enforcement gated by ff_authorize_group_policy.' },
  { name: 'Hosted-access groups', what: 'Hosted Registration Complete / Pending (+ optional approver group), with a groups claim on the hosted-access app.' },
  { status: 'Resolver, not an object', name: 'Admin role — NOT groups', what: 'The 4-signal admin resolver uses an allowlist, population id, custom claim, and role-claim resolver — role is re-earned from IdP signals each login, never read from a store. Groups matter for UC9/UC21 tool policy only.' },
];

const DV_PROTECT = [
  { status: 'Set up in console', name: 'DaVinci CIBA flow policies', what: 'Each CIBA app (email / SMS) carries a DaVinci flow policy in its Policies tab. Widget and Orchestration SDK login policies are exported as PINGONE_DAVINCI_LOGIN_POLICY_ID_V1 / PINGONE_DAVINCI_SDK_POLICY_ID.' },
  { status: 'Flag off by default', name: 'DaVinci orchestration showcase (flag off by default)', what: 'Transaction step-up decided by a DaVinci flow: PingOne SSO → Protect risk score → branch → MFA + fraud-queue alert → Authorize → webhook back to the BFF. Fails closed to the hand-coded MFA flow on any DaVinci error.' },
  { status: 'Not provisioned', name: 'PingOne Protect', what: 'No Protect objects are provisioned — risk policies live in the tenant console. The demo consumes POST /environments/{envId}/riskEvaluations (targetResourceId required) inside the orchestration chain and the step-up/consent paths.' },
  { status: 'Flag-gated or external', name: 'PingOne Verify / MFA / Recognize', what: 'Verify: flag-off identity proofing against a policy id, only server-read SUCCESS records completion. MFA: policy id + Multi_factor acr drives the device picker (SMS/email/passkey; passkeys need the ping-devops.com RP id). Recognize: external SDK tenant via api key.' },
];

const FROM_CODE = 'From provisioning code';

const SECTIONS = [
  { id: 'resources', title: 'Resource servers (audiences)', intro: 'One resource per audience, so every exchange hop mints a token that is only valid at its intended destination.', rows: RESOURCES, key: 'aud', keyLabel: 'Audience' },
  { id: 'apps', title: 'Applications', intro: 'Everything non-worker is client_secret_post; only the worker is basic. PingOne\u2019s "AI Agents" product surface is deliberately not used — agents are ordinary WEB_APPs.', rows: APPS, key: 'type', keyLabel: 'Type' },
  { id: 'users-groups', title: 'Users, schema and groups', intro: '', rows: USERS_GROUPS, key: null },
  { id: 'davinci-protect', title: 'DaVinci, Protect, Verify', intro: '', rows: DV_PROTECT, key: null },
];

// Kept outside the JSX: the pattern check reads a tag's attributes as text, so a link written inside the
// PageHeader `actions` prop would be counted as a second primary.
const setupLink = (
  <Link className="pu-btn pu-btn--primary p1platform__setup" to="/pingone-setup">
    PingOne setup
  </Link>
);

export default function PingOnePlatformConfigPage() {
  return (
    <PingPage className="p1platform" data-testid="pingone-platform-config">
      <SimBanner data-testid="p1platform-banner">
        <strong>STATIC LESSON, NOT A LIVE CHECK</strong> — this page is written from{' '}
        <code>pingoneProvisionService.js</code>, <code>.env.example</code> and the CIBA setup notes. It never calls PingOne, so it
        cannot show what exists in the PingOne environment you are signed in to, and it needs no sign-in.
      </SimBanner>

      <PageHeader
        eyebrow="PingOne · what we configured"
        title="PingOne platform config"
        summary="The PingOne SaaS objects this demo provisions: resource servers, OAuth apps, scopes, users, groups, and the DaVinci/Protect wiring. Most of it is created by bootstrapPingOne (npm run rebuild-pingone wipes and re-runs it); the chip on each card says where that object comes from. scope-topology.json is the source of truth for scopes and resources."
        actions={setupLink}
      />

      <PageFrame>
        {SECTIONS.map((s, index) => (
          <Section
            key={s.id}
            id={`p1platform-${s.id}`}
            kicker={`Group ${index + 1} of ${SECTIONS.length}`}
            title={s.title}
            lede={s.intro || undefined}
          >
            <ul className="pu-card-grid p1platform__rows" role="list">
              {s.rows.map((r) => (
                <li key={r.name}>
                  <Card title={r.name}>
                    <p className="pu-status-line">
                      <StatusChip tone="neutral">{r.status || FROM_CODE}</StatusChip>
                    </p>
                    {s.key ? (
                      <KvList items={[{ label: s.keyLabel, value: <code>{r[s.key]}</code>, mono: true }]} />
                    ) : null}
                    <p className="p1platform__what">{r.what}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </Section>
        ))}

        <Section id="p1platform-caveats" kicker="Limits" title="Caveats">
          <CardGrid>
            <Card tone="warn" title="Older docs use an older scope vocabulary">
              <p className="pu-status-line">
                <StatusChip tone="warn">Historical</StatusChip>
              </p>
              <p className="p1platform__what">
                docs/PINGONE_RESOURCES_AND_SCOPES_MATRIX.md and PINGONE_APP_CONFIG.md predate
                scope-topology.json — their scope vocabulary is historical; cite scope-topology.json.
              </p>
            </Card>
            <Card tone="neutral" title="Claims are wired per resource, not per app">
              <p className="pu-status-line">
                <StatusChip tone="neutral">Per resource</StatusChip>
              </p>
              <p className="p1platform__what">
                The token claims (may_act, act, delegated_to, …) are wired per RESOURCE, not per app —
                app-level tokenCustomization endpoints do not exist in PingOne.
              </p>
            </Card>
          </CardGrid>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
