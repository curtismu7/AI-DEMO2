// banking_api_ui/src/components/education/IdJagPanel.js
import EducationDrawer from '../shared/EducationDrawer';

/* ─── Primitives ──────────────────────────────────────────────────────────── */

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

function Note({ children, color = '#6366f1' }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: `3px solid ${color}`, borderRadius: 6, padding: '10px 14px', margin: '0.75rem 0', fontSize: '0.84rem', color: '#475569', lineHeight: 1.55 }}>
      {children}
    </div>
  );
}

function Warn({ children }) {
  return (
    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderLeft: '3px solid #ea580c', borderRadius: 6, padding: '10px 14px', margin: '0.75rem 0', fontSize: '0.84rem', color: '#7c2d12', lineHeight: 1.55 }}>
      <strong>⚠️ Not Supported:</strong> {children}
    </div>
  );
}

function Partial({ children }) {
  return (
    <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderLeft: '3px solid #ca8a04', borderRadius: 6, padding: '10px 14px', margin: '0.75rem 0', fontSize: '0.84rem', color: '#78350f', lineHeight: 1.55 }}>
      <strong>⚡ Partial Support:</strong> {children}
    </div>
  );
}

function Supported({ children }) {
  return (
    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderLeft: '3px solid #16a34a', borderRadius: 6, padding: '10px 14px', margin: '0.75rem 0', fontSize: '0.84rem', color: '#14532d', lineHeight: 1.55 }}>
      <strong>✅ Supported:</strong> {children}
    </div>
  );
}

function Term({ name, mono, href, children }) {
  return (
    <div style={{ marginBottom: '1.1rem' }}>
      <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}>
        {mono ? <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 3, fontSize: '0.88rem' }}>{name}</code> : name}
        {href && (
          <>
            {' '}
            <a href={href} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '0.78rem', fontWeight: 400, color: '#2563eb', marginLeft: 4 }}>
              draft ↗
            </a>
          </>
        )}
      </p>
      <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>{children}</p>
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

function CompareRow({ feature, rfc8693, idjag }) {
  return (
    <tr>
      <td style={{ padding: '7px 10px', fontSize: '0.83rem', color: '#374151', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{feature}</td>
      <td style={{ padding: '7px 10px', fontSize: '0.83rem', color: '#374151', borderBottom: '1px solid #f1f5f9' }}>{rfc8693}</td>
      <td style={{ padding: '7px 10px', fontSize: '0.83rem', color: '#374151', borderBottom: '1px solid #f1f5f9' }}>{idjag}</td>
    </tr>
  );
}

/* ─── Tab: Overview ───────────────────────────────────────────────────────── */

function OverviewContent() {
  return (
    <>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        <strong style={{ color: '#1e293b' }}>ID-JAG</strong> is the technical acronym for the{' '}
        <strong>Identity Assertion JWT Authorization Grant</strong>, an emerging IETF standard.
        While the IETF draft carries the technical name, the marketing term most often used is{' '}
        <strong style={{ color: '#2563eb' }}>Cross-App Access (XAA)</strong>.
      </p>

      <Note>
        <strong>Draft reference:</strong>{' '}
        <a href="https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
          draft-ietf-oauth-identity-assertion-authz-grant
        </a>
        {' '}— IETF OAuth Working Group, active draft (not yet an RFC).
        The grant type URI is{' '}
        <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>
          urn:ietf:params:oauth:grant-type:jwt-bearer
        </code>
        {' '}(re-using RFC 7523 framing with new semantics).
      </Note>

      <Section title="Why it Exists — the Cross-App Problem">
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          Modern enterprises run many applications, each with its own OAuth Authorization Server or tenant. When a user is already authenticated in App A and an agent, service, or second app (App B) needs to act on their behalf — without sending the user through a browser redirect again — there is no clean standards-based path. The options today are all compromises:
        </p>
        <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.4rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.7 }}>
          <li>Share a long-lived service account token (breaks least-privilege)</li>
          <li>Forward the user's access token directly (breaks audience isolation)</li>
          <li>Use RFC 8693 Token Exchange (requires deep AS trust configuration)</li>
          <li>Re-authenticate the user silently (only works same-AS, breaks cross-tenant)</li>
        </ul>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          ID-JAG defines a standardised way for an application holding a user's JWT (an ID token or access token) to present that JWT as an <em>identity assertion</em> to a target Authorization Server and receive a new, audience-scoped token — all server-to-server, no user interaction required.
        </p>
      </Section>

      <Section title="Marketing vs. Technical Name">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 14px' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '0.875rem', color: '#1d4ed8' }}>XAA — Cross-App Access</p>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#1e40af', lineHeight: 1.5 }}>
              The marketing / product term. Used in vendor docs (Okta, PingIdentity, Microsoft Entra). Customer-facing. Focuses on the <em>outcome</em>: seamless access across applications without re-login.
            </p>
          </div>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 14px' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '0.875rem', color: '#15803d' }}>ID-JAG — Identity Assertion JWT Authorization Grant</p>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#14532d', lineHeight: 1.5 }}>
              The technical IETF draft name. Used in standards work and protocol implementation. Focuses on the <em>mechanism</em>: a JWT assertion exchanged at a token endpoint.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Key Actors">
        <Term name="Asserting Party (AP)">
          The application that holds the user's current JWT and presents it as an identity assertion. In an agentic context this is typically the orchestrating agent or BFF.
        </Term>
        <Term name="Identity Provider (IdP / AS)">
          The Authorization Server at the target application that evaluates the incoming JWT, applies its own policies, and issues a new scoped token. PingOne acts in this role.
        </Term>
        <Term name="Subject">
          The end user whose identity is being asserted. They are represented in the JWT by their <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>sub</code> claim — they are never redirected.
        </Term>
        <Term name="Relying Party / Resource Server">
          The API or service that will accept the new token issued by the target AS. It never sees the original assertion JWT.
        </Term>
      </Section>
    </>
  );
}

/* ─── Tab: How It Works ───────────────────────────────────────────────────── */

function HowItWorksContent() {
  return (
    <>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        ID-JAG uses the existing OAuth 2.0 token endpoint with a special grant type. The assertion JWT is presented directly — no browser involvement.
      </p>

      <Section title="Token Request — HTTP Shape">
        <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: '14px 16px', borderRadius: 8, fontSize: '0.78rem', lineHeight: 1.7, overflowX: 'auto', margin: '0 0 0.75rem' }}>
{`POST /oauth2/token HTTP/1.1
Host: auth.target-app.example.com
Content-Type: application/x-www-form-urlencoded

grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer
&assertion=<JWT signed by asserting party>
&scope=read%3Aaccounts
&client_id=app-b-client
&client_secret=...`}
        </pre>
        <Note>
          The <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>assertion</code> is the JWT carrying the user's identity — typically an OIDC ID token or a purpose-built identity assertion JWT. The target AS must be configured to trust the issuer of this JWT.
        </Note>
      </Section>

      <Section title="The Assertion JWT — Required Claims">
        <div style={{ overflowX: 'auto', marginBottom: '0.75rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: '#1e293b' }}>Claim</th>
                <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: '#1e293b' }}>Required</th>
                <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: '#1e293b' }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['iss', 'Yes', 'Issuer — the asserting party; target AS validates this against its trust list'],
                ['sub', 'Yes', "The user's unique identifier at the asserting party"],
                ['aud', 'Yes', 'Must be the target AS token endpoint URL (prevents token replay to wrong AS)'],
                ['exp', 'Yes', 'Expiry — short-lived (seconds to minutes), prevents replay'],
                ['iat', 'Yes', 'Issued-at timestamp'],
                ['jti', 'Recommended', 'JWT ID — uniqueness check prevents replay attacks'],
                ['email / name', 'Optional', 'Identity hints for account matching at the target AS'],
              ].map(([c, r, d]) => (
                <tr key={c} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '7px 10px', fontFamily: 'inherit', fontSize: '0.82rem', color: '#2563eb' }}>{c}</td>
                  <td style={{ padding: '7px 10px', color: r === 'Yes' ? '#15803d' : r === 'Recommended' ? '#ca8a04' : '#64748b', fontWeight: 600 }}>{r}</td>
                  <td style={{ padding: '7px 10px', color: '#475569', lineHeight: 1.5 }}>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="End-to-End Flow">
        <FlowStep num={1} label="User logs in to App A (the asserting party)">
          A normal OIDC Authorization Code + PKCE flow. The user authenticates and App A receives an ID token and access token from AS-A.
        </FlowStep>
        <FlowStep num={2} label="App A needs to call App B on the user's behalf">
          An agent, service, or BFF in App A determines that it needs a token for App B. The user is not present — this is a background server-to-server call.
        </FlowStep>
        <FlowStep num={3} label="App A constructs and signs an identity assertion JWT">
          The JWT includes the user's <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>sub</code>, sets <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>aud</code> to AS-B's token endpoint, and is signed with App A's private key.
        </FlowStep>
        <FlowStep num={4} label="App A sends the assertion to AS-B's token endpoint">
          Uses the <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>urn:ietf:params:oauth:grant-type:jwt-bearer</code> grant type. AS-B looks up App A in its trust registry.
        </FlowStep>
        <FlowStep num={5} label="AS-B validates the assertion and maps the identity">
          AS-B verifies the JWT signature against App A's JWKS, checks <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>aud</code>, <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>exp</code>, and <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>jti</code> replay. Then it maps the incoming <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>sub</code> to a local identity using its account-linking configuration.
        </FlowStep>
        <FlowStep num={6} label="AS-B issues a scoped access token for its own resources">
          App A can now call App B's APIs with a properly scoped access token. The user's identity is propagated — App B knows <em>who</em> the token is for — but the user was never redirected.
        </FlowStep>
        <div style={{ marginTop: '0.5rem', fontFamily: 'inherit', fontSize: '0.77rem', background: '#0f172a', color: '#374151', borderRadius: 8, padding: '12px 16px', lineHeight: 1.9 }}>
          <span style={{ color: '#86efac' }}>User Browser</span>
          {'  '}(logged in once to App A)<br />
          {'      ↓'}<br />
          <span style={{ color: '#93c5fd' }}>App A / BFF</span>
          {'  '}builds identity assertion JWT, sends to AS-B token endpoint<br />
          {'      ↓'}<br />
          <span style={{ color: '#fca5a5' }}>AS-B (PingOne)</span>
          {'  '}validates assertion → maps sub → issues App-B access token<br />
          {'      ↓'}<br />
          <span style={{ color: '#93c5fd' }}>App A / BFF</span>
          {'  '}calls App B API with new access token<br />
          {'      ↓'}<br />
          <span style={{ color: '#fbbf24' }}>App B Resource Server</span>
          {'  '}serves response — knows the token's user identity
        </div>
      </Section>
    </>
  );
}

/* ─── Tab: PingOne SSO ────────────────────────────────────────────────────── */

function PingOneContent() {
  return (
    <>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        PingOne's SSO capabilities map partially to the ID-JAG/XAA model. Some building blocks are present; native end-to-end ID-JAG is not yet a shipped product feature.
      </p>

      <Section title="What PingOne Can Do Today">
        <Supported>
          <strong>RFC 7523 JWT Bearer — client authentication.</strong> PingOne supports using a signed JWT as a client credential (<code style={{ fontSize: '0.82rem' }}>private_key_jwt</code>). This is used in this demo for the AGENT_OAUTH_CLIENT_ID client. The AS validates the JWT, authenticates the client, and issues a client-credentials token.
        </Supported>
        <Supported>
          <strong>RFC 8693 Token Exchange.</strong> PingOne supports token exchange: present a subject token (user access token) and receive a delegated audience-scoped token. This is the primary mechanism used in this demo (BFF → PingOne → MCP access token). See the Token Exchange education panel for details.
        </Supported>
        <Supported>
          <strong>OIDC Federation / trust with external IdPs.</strong> PingOne Identity can be configured to accept external OIDC-signed ID tokens as the basis for a login (via Identity Provider connections). This is the closest PingOne feature to "trusting assertions from another AS."
        </Supported>
        <Supported>
          <strong>DaVinci orchestration flows.</strong> Ping DaVinci can be configured to accept an inbound JWT from a trusted source and orchestrate a login/user-linking flow without redirecting the user's browser — a configurable approximation of XAA for DaVinci-capable deployments.
        </Supported>
        <Partial>
          <strong>Account linking / identity federation.</strong> PingOne supports linking external IdP identities to local accounts. An incoming assertion could trigger account lookup by email or external sub. However this requires a full login flow initiation — not a pure token endpoint assertion.
        </Partial>
      </Section>

      <Section title="ID-JAG Implementation Pattern in PingOne">
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
          The closest approximation achievable with current PingOne capabilities requires combining two features:
        </p>
        <ol style={{ margin: '0 0 0.75rem', paddingLeft: '1.4rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.8 }}>
          <li>
            <strong>Configure App A as a trusted OIDC Provider</strong> in PingOne via{' '}
            <em>External Identity Providers</em>. Upload App A's JWKS so PingOne can verify its JWT signatures.
          </li>
          <li>
            <strong>Use the OIDC login flow</strong> with <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>prompt=none</code> — send the user's existing <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>id_token</code> as a <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: '0.82rem' }}>login_hint_token</code> to hint the identity. PingOne completes the flow silently if the identity maps.
          </li>
          <li>
            <strong>RFC 8693 Token Exchange</strong> after the above to narrow the audience to the specific resource server (MCP, banking API, etc.).
          </li>
        </ol>
        <Note>
          This multi-step approximation requires user-session state and cannot be done purely token-endpoint-to-token-endpoint. It is not the same as a native ID-JAG flow, which is a single POST to a token endpoint with no browser redirect at all.
        </Note>
      </Section>

      <Section title="PingOne Configuration Required (for approximation)">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: '#1e293b' }}>PingOne Setting</th>
                <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: '#1e293b' }}>Location</th>
                <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: '#1e293b' }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['External Identity Provider', 'Connections → Identity Providers', 'Register App A as a trusted OIDC issuer; upload / link JWKS endpoint'],
                ['Account Linking', 'Identity Provider → Account Linking', 'Map incoming sub or email to local PingOne user record'],
                ['Application (OIDC)', 'Applications → Add OIDC App', 'Register App B client; set scopes, audience, PKCE requirements'],
                ['Token Exchange Policy', 'Applications → Token Exchange', 'Permit subject_token_type and actor_token_type for RFC 8693'],
                ['Resource Server', 'Connections → Resources', 'Define the audience URI your App B access tokens will carry'],
                ['JWKS Endpoint (App A)', 'App A must expose /.well-known/jwks.json', 'PingOne fetches this to verify App A assertion signatures'],
              ].map(([s, l, p]) => (
                <tr key={s} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '7px 10px', fontWeight: 600, color: '#1e293b' }}>{s}</td>
                  <td style={{ padding: '7px 10px', fontFamily: 'inherit', fontSize: '0.8rem', color: '#2563eb' }}>{l}</td>
                  <td style={{ padding: '7px 10px', color: '#475569', lineHeight: 1.5 }}>{p}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

/* ─── Tab: Limitations ────────────────────────────────────────────────────── */

function LimitationsContent() {
  return (
    <>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        ID-JAG is an <strong>active IETF draft</strong> — not yet an RFC. These limitations fall into three buckets: standard gaps, PingOne product gaps, and this demo's gaps.
      </p>

      <Section title="Standard / Protocol Gaps (IETF Draft Status)">
        <Warn>
          The grant type <code style={{ fontSize: '0.82rem' }}>urn:ietf:params:oauth:grant-type:jwt-bearer</code> is shared with RFC 7523 (JWT Bearer for client auth and grants). The ID-JAG draft re-uses this URI with new semantics. Until the draft reaches RFC status, implementors can face ambiguity about which semantics an AS applies when it receives this grant type.
        </Warn>
        <Warn>
          <strong>No finalised account-linking mandate.</strong> The draft does not mandate how the target AS must map an incoming <code style={{ fontSize: '0.82rem' }}>sub</code> from a foreign issuer to a local identity. Each AS implementation (PingOne, Okta, Entra) makes its own choices — creating interoperability gaps between vendors.
        </Warn>
        <Warn>
          <strong>No standard replay-prevention mandate.</strong> The draft recommends <code style={{ fontSize: '0.82rem' }}>jti</code>-based replay detection but does not require it. AS implementations vary in how strictly they enforce this.
        </Warn>
        <Note color="#ca8a04">
          The IETF OAuth WG expects the draft to progress to Proposed Standard in 2025–2026. Until then, treat ID-JAG as experimental in production systems.
        </Note>
      </Section>

      <Section title="PingOne Product Gaps">
        <Warn>
          <strong>No native ID-JAG token endpoint support.</strong> PingOne does not expose a token endpoint that accepts a raw JWT assertion as the sole credential and issues an access token in a single round-trip without a prior SSO session. There is no PingOne feature called "Identity Assertion Grant" or "Cross-App Access" in the admin console as of this writing.
        </Warn>
        <Warn>
          <strong>JWT Bearer assertion grant (RFC 7523 §2.1) not supported as a standalone user grant.</strong> PingOne supports <code style={{ fontSize: '0.82rem' }}>private_key_jwt</code> for client authentication, but not the companion grant type where the JWT asserts a <em>user</em> identity to acquire a user token without a prior session.
        </Warn>
        <Warn>
          <strong>Cross-environment ID-JAG not supported.</strong> If App A and App B live in different PingOne environments (different tenants or customer deployments), there is no out-of-the-box token-endpoint assertion mechanism. RFC 8693 token exchange works within a single environment only.
        </Warn>
        <Partial>
          <strong>DaVinci partial support.</strong> A DaVinci flow can be authored to accept an inbound signed JWT, look up a user, and return tokens. This is not a standards-compliant ID-JAG implementation — it is a custom adaptation of DaVinci's capabilities. It works if your customer has DaVinci licensed and is willing to build and maintain the flow.
        </Partial>
        <Partial>
          <strong>External IdP federation + silent OIDC.</strong> The approximation described in the PingOne tab works but requires browser involvement (<code style={{ fontSize: '0.82rem' }}>prompt=none</code> redirect). This is not server-to-server and breaks in agent contexts where there is no browser session.
        </Partial>
      </Section>

      <Section title="This Demo's Gaps">
        <Warn>
          <strong>Demo uses RFC 8693 Token Exchange, not ID-JAG.</strong> The BFF's <code style={{ fontSize: '0.82rem' }}>exchangeTokenRfc8693()</code> function calls PingOne's token exchange endpoint — this is not an ID-JAG grant. The demo cannot demonstrate a native ID-JAG flow because PingOne does not support it natively. The flow is: user access token (subject) + agent client credentials (actor) → MCP access token. This is RFC 8693, not Cross-App Access.
        </Warn>
        <Warn>
          <strong>No cross-app boundary in the demo.</strong> All token exchanges occur within a single PingOne environment. True XAA requires crossing an application or tenant boundary. The demo's single-environment design means it cannot illustrate the multi-tenant or cross-app aspects of XAA.
        </Warn>
        <Warn>
          <strong>No JWKS endpoint on the BFF.</strong> For App A to act as an asserting party, it needs to expose a JWKS endpoint and sign JWTs with a private key. The demo's BFF <code style={{ fontSize: '0.82rem' }}>banking_api_server</code> does not generate or expose key pairs for assertion signing. Adding this would require RSA/EC key generation at startup, a <code style={{ fontSize: '0.82rem' }}>/jwks.json</code> route, and session-bound JWT minting.
        </Warn>
        <Note>
          <strong>Roadmap note:</strong> A future phase could add a minimal ID-JAG simulation: configure a second PingOne application as "App B", add a <code style={{ fontSize: '0.82rem' }}>/.well-known/jwks.json</code> route to the BFF, and demonstrate the assertion JWT token endpoint call. This would require DaVinci or a custom PingOne policy to evaluate the assertion on the receiving side.
        </Note>
      </Section>
    </>
  );
}

/* ─── Tab: vs RFC 8693 ────────────────────────────────────────────────────── */

function ComparisonContent() {
  return (
    <>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
        ID-JAG and RFC 8693 Token Exchange are complementary but distinct. Understanding the difference is critical for recommending the right solution.
      </p>

      <Section title="Side-by-Side Comparison">
        <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#1e293b', width: '25%' }}>Dimension</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#1e293b', width: '37%' }}>RFC 8693 Token Exchange</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#1e293b', width: '38%' }}>ID-JAG / XAA</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow
                feature="Standard status"
                rfc8693="RFC 8693 — Published standard (2020)"
                idjag="IETF Draft — not yet an RFC (active WG)"
              />
              <CompareRow
                feature="Grant type"
                rfc8693="urn:ietf:params:oauth:grant-type:token-exchange"
                idjag="urn:ietf:params:oauth:grant-type:jwt-bearer (re-used from RFC 7523)"
              />
              <CompareRow
                feature="Input credential"
                rfc8693="An existing OAuth access token or ID token already issued by the same AS"
                idjag="A JWT assertion formed and signed by the requesting application (cross-AS)"
              />
              <CompareRow
                feature="Trust model"
                rfc8693="Single AS: subject token must already be valid at this AS"
                idjag="Cross-AS: target AS trusts the issuer of the assertion by JWKS configuration"
              />
              <CompareRow
                feature="Cross-app / cross-tenant"
                rfc8693="Limited — works across resources within one AS; awkward cross-tenant"
                idjag="Designed for cross-application and cross-tenant scenarios"
              />
              <CompareRow
                feature="PingOne support"
                rfc8693="✅ Natively supported — used in this demo"
                idjag="⚠️ Not natively supported — no ID-JAG token endpoint"
              />
              <CompareRow
                feature="Actor token (delegation)"
                rfc8693="Yes — RFC 8693 act/may_act claims carry full delegation chain"
                idjag="Draft does not define actör token; delegation semantics are external"
              />
              <CompareRow
                feature="User interaction"
                rfc8693="None — purely server-to-server"
                idjag="None — purely server-to-server"
              />
              <CompareRow
                feature="Where to use"
                rfc8693="Agent accessing a resource in the same PingOne environment (e.g. MCP server)"
                idjag="Agent in App A accessing App B across a different AS or tenant"
              />
              <CompareRow
                feature="Replay protection"
                rfc8693="Token binding / short expiry on the subject token"
                idjag="jti claim + short-lived assertion JWT (exp measured in seconds)"
              />
              <CompareRow
                feature="Demo usage"
                rfc8693="✅ Used — BFF exchanges user token for MCP access token"
                idjag="❌ Not demonstrated — PingOne gap + BFF lacks JWKS endpoint"
              />
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="When to Recommend Each">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: '0.75rem' }}>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 14px' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '0.875rem', color: '#15803d' }}>Use RFC 8693 when…</p>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: '#14532d', lineHeight: 1.7 }}>
              <li>All apps share a single PingOne environment</li>
              <li>Need delegation chain (<code style={{ fontSize: '0.8rem' }}>act</code> / <code style={{ fontSize: '0.8rem' }}>may_act</code>)</li>
              <li>Narrowing scope or audience within AS</li>
              <li>PingOne is available as the token exchange endpoint</li>
            </ul>
          </div>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 14px' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '0.875rem', color: '#1d4ed8' }}>Use ID-JAG / XAA when…</p>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: '#1e40af', lineHeight: 1.7 }}>
              <li>Apps are in different tenants / organisations</li>
              <li>No shared session store between AS-A and AS-B</li>
              <li>Need portable identity assertion across vendor AS</li>
              <li>Target AS supports the jwt-bearer grant type with XAA semantics</li>
            </ul>
          </div>
        </div>
        <Note>
          In practice, most PingOne customers today should use <strong>RFC 8693 Token Exchange</strong> for agentic cross-service access. ID-JAG becomes relevant when a customer has a multi-cloud or multi-vendor IdP landscape where the agent's AS and the resource's AS are different systems with no shared token base.
        </Note>
      </Section>

      <Section title="Relationship to Other Standards">
        <Term name="RFC 7523 — JWT Bearer Grant" href="https://datatracker.ietf.org/doc/html/rfc7523" mono={false}>
          Published RFC that defines using a JWT as a grant credential (§2.1) and as client authentication (§2.2). ID-JAG re-uses the grant type URI from RFC 7523 §2.1 but extends the semantics for cross-app identity assertion. RFC 7523 alone is not XAA.
        </Term>
        <Term name="draft-ietf-oauth-identity-chaining" href="https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-chaining/" mono={false}>
          A related IETF draft describing how to propagate user identity across trust domains in an authorization chain. ID-JAG and Identity Chaining are complementary: ID-JAG provides the assertion mechanism; Identity Chaining defines the trust model and chain structure.
        </Term>
        <Term name="OpenID Connect for Identity Assurance (OIDC4IDA)" href="https://openid.net/specs/openid-connect-4-identity-assurance-1_0.html" mono={false}>
          OID4IDA defines structured claims for verified identity. ID-JAG assertions may carry OID4IDA-structured claims so the receiving AS can make trust decisions based on the level and method of identity verification at the asserting party.
        </Term>
      </Section>
    </>
  );
}

/* ─── Exported panel ─────────────────────────────────────────────────────── */

const tabs = [
  { id: 'overview',     label: 'What is ID-JAG',  content: <OverviewContent /> },
  { id: 'how-it-works', label: 'How It Works',     content: <HowItWorksContent /> },
  { id: 'pingone',      label: 'PingOne SSO',      content: <PingOneContent /> },
  { id: 'limitations',  label: '⚠️ Limitations',   content: <LimitationsContent /> },
  { id: 'vs-rfc8693',   label: 'vs RFC 8693',      content: <ComparisonContent /> },
];

export default function IdJagPanel({ isOpen, onClose, initialTabId }) {

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="ID-JAG / Cross-App Access (XAA) — Identity Assertion JWT Authorization Grant"
      tabs={tabs}
      initialTabId={initialTabId}
      width="clamp(380px, 55vw, 760px)"
    />
  );
}
