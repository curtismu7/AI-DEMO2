// demo_api_ui/src/components/education/EnterpriseManagedAuthPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

const SPEC_URL = 'https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization';
const EXT_ID = 'io.modelcontextprotocol/enterprise-managed-authorization';

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700, color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Note({ children }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: '3px solid #6366f1', borderRadius: 6, padding: '10px 14px', margin: '0.75rem 0', fontSize: '0.84rem', color: '#475569', lineHeight: 1.55 }}>
      {children}
    </div>
  );
}

function FlowStep({ num, label, children }) {
  return (
    <div style={{ display: 'flex', gap: '12px', marginBottom: '0.9rem' }}>
      <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 700 }}>
        {num}
      </div>
      <div>
        <p style={{ margin: '0 0 0.2rem', fontWeight: 700, fontSize: '0.875rem', color: '#1e293b' }}>{label}</p>
        <p style={{ margin: 0, fontSize: '0.84rem', color: '#475569', lineHeight: 1.55 }}>{children}</p>
      </div>
    </div>
  );
}

function CrossLink({ panelId, tabId, children }) {
  const { open } = useEducationUI();
  return (
    <button
      type="button"
      onClick={() => open(panelId, tabId)}
      style={{
        display: 'inline-block',
        background: 'rgba(99,102,241,0.08)',
        border: '1px solid rgba(99,102,241,0.35)',
        color: '#4338ca',
        borderRadius: 6,
        padding: '6px 10px',
        margin: '4px 6px 4px 0',
        fontSize: '0.82rem',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function OverviewContent() {
  return (
    <>
      <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        <strong>Enterprise-Managed Authorization</strong> is an MCP extension (
        <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>{EXT_ID}</code>
        ) that lets organizations control MCP server access <em>centrally</em> through their existing identity provider (IdP) — instead of each employee authorizing each MCP server individually.
      </p>

      <Note>
        <strong>Spec:</strong>{' '}
        <a href={SPEC_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
          MCP Enterprise-Managed Authorization ↗
        </a>
        {' '}— extensions are opt-in and never active by default.
      </Note>

      <Section title="Consumer vs enterprise model">
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          In a standard MCP deployment, every user independently OAuth-authorizes every MCP client to every MCP server. That works for personal apps; in enterprises it creates friction and gaps:
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.65 }}>
          <li>Employees should not need to understand authorization details for dozens of internal MCP servers.</li>
          <li>Security teams cannot enforce consistent policy if each user consents independently.</li>
          <li>Onboarding requires many per-service authorizations; offboarding requires revoking each one.</li>
        </ul>
      </Section>

      <Section title="What changes with enterprise-managed auth">
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          The enterprise IdP (Okta, Azure AD, PingOne, corporate SSO) becomes the authoritative decision-maker. It maintains a registry of approved MCP servers and policies. Employees sign in once with corporate credentials; the IdP issues an{' '}
          <strong>ID-JAG</strong> (Identity Assertion JWT Authorization Grant) that the MCP client exchanges for an MCP access token — without sending the user through the MCP Authorization Server&apos;s consent screen.
        </p>
      </Section>

      <Section title="When to use it">
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.65 }}>
          <li>Corporate MCP rollout where IT manages all business application access.</li>
          <li>Centralized add/revoke from one admin console (group membership, conditional access).</li>
          <li>Compliance needs an auditable authorization trail for MCP server access.</li>
          <li>SSO-only employee experience — no per-server OAuth prompts.</li>
        </ul>
      </Section>
    </>
  );
}

function HowItWorksContent() {
  return (
    <>
      <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        The IdP sits between the MCP client and the MCP Authorization Server. The client never redirects the user to the MCP AS authorization endpoint when enterprise-managed auth is required.
      </p>

      <FlowStep num={1} label="User signs in to MCP client via enterprise IdP">
        Browser redirect to IdP; user authenticates with corporate SSO. Client stores the resulting OpenID ID Token (or SAML assertion).
      </FlowStep>
      <FlowStep num={2} label="Client requests ID-JAG from enterprise IdP">
        Server-to-server call using the identity assertion. IdP evaluates policy (groups, roles, conditional access) against its MCP server registry.
      </FlowStep>
      <FlowStep num={3} label="Client exchanges ID-JAG at MCP Authorization Server token endpoint">
        Grant type uses the JWT bearer profile. MCP AS validates signature against IdP JWKS, checks <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>aud</code>, <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>iss</code>, <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>exp</code>, and maps <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>sub</code> to a local account.
      </FlowStep>
      <FlowStep num={4} label="Client calls MCP Resource Server with MCP access token">
        Standard bearer token on MCP tool/API calls until expiry or IdP-side revocation.
      </FlowStep>

      <Section title="Key properties">
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.65 }}>
          <li><strong>Centralized policy</strong> — approved MCP servers and who may access them live in IdP admin tools.</li>
          <li><strong>Single sign-on</strong> — one corporate login; no repeated MCP AS consent for approved servers.</li>
          <li><strong>Policy enforcement</strong> — unauthorized employees get an error at the IdP; the client never receives a token.</li>
          <li><strong>Centralized revocation</strong> — disable the user or policy at the IdP; effect is immediate across clients.</li>
        </ul>
      </Section>

      <CrossLink panelId={EDU.ID_JAG} tabId="overview">ID-JAG / Cross-App Access deep dive</CrossLink>
    </>
  );
}

function PingOneContent() {
  return (
    <>
      <Section title="PingOne as enterprise IdP">
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          PingOne is a natural enterprise IdP in this architecture: corporate workforce SSO, group/role assignments, MFA step-up, and admin APIs for provisioning. Enterprise-managed MCP auth maps cleanly to patterns customers already use for SaaS SSO.
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.65 }}>
          <li><strong>Workforce SSO</strong> — employees authenticate once; PingOne issues OIDC ID tokens the MCP client retains.</li>
          <li><strong>Policy surface</strong> — populations, groups, and sign-on policies gate who may obtain ID-JAGs for which MCP resource servers.</li>
          <li><strong>MCP Authorization Server</strong> — often PingOne (or PingGateway in front of MCP) validates ID-JAGs and issues resource tokens with audience bound to the MCP server.</li>
          <li><strong>Account linking</strong> — MCP AS maps IdP <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>sub</code> (stable) and optional <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>email</code> to local identities.</li>
        </ul>
      </Section>

      <Section title="Ping sales narrative">
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          Enterprise-managed authorization turns MCP from &ldquo;every employee clicks through OAuth for every server&rdquo; into &ldquo;IT publishes approved MCP servers; employees use corporate SSO.&rdquo; PingOne + PingGateway + PingOne Authorize cover identity, token issuance, and fine-grained tool policy — the same stack this demo uses, extended to the MCP extension model.
        </p>
      </Section>

      <CrossLink panelId={EDU.PINGGATEWAY_MCP} tabId="overview">PingGateway MCP security</CrossLink>
      {' '}
      <CrossLink panelId={EDU.PINGONE_AUTHORIZE} tabId="what">PingOne Authorize</CrossLink>
    </>
  );
}

function InThisDemoContent() {
  return (
    <>
      <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderLeft: '3px solid #ea580c', borderRadius: 6, padding: '10px 14px', margin: '0 0 1rem', fontSize: '0.84rem', color: '#7c2d12', lineHeight: 1.55 }}>
        <strong>⚠️ This demo does not enable the enterprise-managed authorization extension today.</strong>{' '}
        It demonstrates the <em>user-consent + RFC 8693 token exchange</em> path that consumer and hybrid deployments use.
      </div>

      <Section title="What this demo does today">
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.65 }}>
          <li>User logs in via PingOne OAuth (Auth Code + PKCE) to the BFF.</li>
          <li>User explicitly connects the AI agent / MCP path (consent-oriented flow).</li>
          <li>BFF performs <strong>RFC 8693 token exchange</strong> (user token + agent actor) to mint MCP-scoped access tokens.</li>
          <li>PingGateway or demo MCP gateway validates tokens; PingOne Authorize enforces tool policy.</li>
        </ul>
      </Section>

      <Section title="What enterprise-managed auth would add">
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.65 }}>
          <li>MCP client declares <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>{EXT_ID}</code> in <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>initialize</code> capabilities.</li>
          <li>Org admin configures IdP endpoints; employees skip per-server MCP AS redirects.</li>
          <li>Client obtains ID-JAG from PingOne and exchanges it at the MCP AS — no browser hop to MCP consent.</li>
          <li>IT revokes MCP access centrally when offboarding users.</li>
        </ul>
      </Section>

      <Section title="Closest demo building blocks">
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          These panels cover the mechanics that enterprise-managed auth builds on:
        </p>
        <CrossLink panelId={EDU.TOKEN_EXCHANGE} tabId="why">RFC 8693 Token Exchange</CrossLink>
        <CrossLink panelId={EDU.ID_JAG} tabId="how-it-works">ID-JAG flow</CrossLink>
        <CrossLink panelId={EDU.AGENT_GATEWAY} tabId="overview">Agent / MCP Gateway</CrossLink>
        <CrossLink panelId={EDU.MCP_PROTOCOL} tabId="what">MCP Protocol</CrossLink>
      </Section>
    </>
  );
}

function ImplementContent() {
  return (
    <>
      <Section title="MCP client requirements">
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.65 }}>
          <li>Declare extension in <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>initialize</code> → <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>capabilities.extensions</code>.</li>
          <li>Authenticate users via enterprise IdP SSO; persist ID Token or SAML assertion.</li>
          <li>On server signal, request ID-JAG from IdP and exchange at MCP AS token endpoint — do not redirect user to MCP AS authorize URL.</li>
          <li>Support org-level IdP configuration (admin settings, not per-user).</li>
          <li>Handle scope errors gracefully when IdP-issued tokens carry restricted scopes.</li>
        </ul>
        <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: '12px', borderRadius: 6, fontSize: '0.78rem', overflow: 'auto', marginTop: '0.75rem' }}>
{`{
  "capabilities": {
    "extensions": {
      "${EXT_ID}": {}
    }
  }
}`}
        </pre>
      </Section>

      <Section title="MCP server / Authorization Server">
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.65 }}>
          <li>Advertise enterprise-managed auth in authorization metadata when required.</li>
          <li>Validate ID-JAG JWTs (JWKS, <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>aud</code>, <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>iss</code>, <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>exp</code>, replay).</li>
          <li>Map IdP claims to permissions; link accounts via stable <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>sub</code>.</li>
          <li>Optional: publish resource descriptor so IdP admins can register the MCP server.</li>
        </ul>
      </Section>

      <Note>
        Client support varies by MCP client implementation. Enterprise rollout typically requires IT configuration in addition to client application support. See the{' '}
        <a href={SPEC_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>client matrix ↗</a>{' '}
        in the MCP docs.
      </Note>
    </>
  );
}

const tabs = [
  { id: 'overview', label: 'Overview', content: <OverviewContent /> },
  { id: 'how-it-works', label: 'How It Works', content: <HowItWorksContent /> },
  { id: 'pingone', label: 'PingOne / IdP', content: <PingOneContent /> },
  { id: 'in-this-demo', label: 'In This Demo', content: <InThisDemoContent /> },
  { id: 'implement', label: 'Implementation', content: <ImplementContent /> },
];

/** Enterprise-Managed Authorization MCP extension — education drawer */
export default function EnterpriseManagedAuthPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Enterprise-Managed Authorization (MCP)"
      tabs={tabs}
      initialTabId={initialTabId}
      width="clamp(380px, 55vw, 760px)"
    />
  );
}
