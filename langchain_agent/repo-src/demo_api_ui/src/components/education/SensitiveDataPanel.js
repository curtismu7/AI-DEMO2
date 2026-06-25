import EducationDrawer from '../shared/EducationDrawer';

// ── Helpers ────────────────────────────────────────────────────────────────

const Code = ({ children }) => (
  <code style={{
    display: 'block', background: 'var(--code-bg, #f1f5f9)', borderRadius: 6,
    padding: '0.75rem 1rem', fontFamily: 'inherit', fontSize: '0.78rem',
    whiteSpace: 'pre', overflowX: 'auto', margin: '0.5rem 0',
  }}>{children}</code>
);

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f766e', marginBottom: '0.4rem' }}>{title}</h3>
      {children}
    </div>
  );
}

function Callout({ icon, color, bg, border, children }) {
  return (
    <div style={{
      borderLeft: `4px solid ${border || color || '#0d9488'}`,
      background: bg || '#f0fdfa',
      borderRadius: '0 8px 8px 0',
      padding: '0.75rem 1rem',
      marginBottom: '1rem',
      fontSize: '0.88rem',
      color: '#134e4a',
    }}>
      {icon && <span style={{ marginRight: '0.4rem' }}>{icon}</span>}
      {children}
    </div>
  );
}

// ── Tab 1: Least-Data Principle ────────────────────────────────────────────

function LeastDataContent() {
  return (
    <div>
      <p style={{ color: '#475569', marginBottom: '1rem', fontSize: '0.9rem' }}>
        The <strong>Least-Data Principle</strong> states that an AI agent should receive only the minimum
        data it needs to perform a task — nothing more. This reduces the blast radius if a model is
        tricked, compromised, or logs context for training.
      </p>

      <Section title="What is the Least-Data Principle?">
        <p style={{ color: '#475569', fontSize: '0.88rem', lineHeight: 1.6 }}>
          Traditional APIs often return a complete object — full account number, routing number, address —
          because the caller was trusted (a human-facing app under TLS). AI agents change that calculus:
          <strong> LLM context windows get logged</strong>, may be cached, and in some configurations used
          for fine-tuning. Minimising the PII surface in a response is the first line of defence.
        </p>
      </Section>

      <Section title="Field-Level Scopes">
        <p style={{ color: '#475569', fontSize: '0.88rem', lineHeight: 1.6 }}>
          Instead of one broad scope like <code>read</code> that exposes everything, split at the
          data-tier level:
        </p>
        <Code>{`// Broad (avoid for agents)
scope: "read"  →  returns all fields incl. full account number

// Granular (preferred)
scope: "accounts:read"  →  account name, masked number, balance
scope: "sensitive:read" →  full account number, routing number
     ↑ requires explicit user consent + PAZ policy check`}</Code>
        <p style={{ color: '#475569', fontSize: '0.88rem', marginTop: '0.4rem' }}>
          The demo uses <code>sensitive:read</code> as the gate for the
          <code> get_sensitive_account_details</code> MCP tool.
        </p>
      </Section>

      <Section title="Masking Patterns">
        <p style={{ color: '#475569', fontSize: '0.88rem', lineHeight: 1.6 }}>
          Always return masked values by default. Only reveal full values after authorization.
        </p>
        <Code>{`// Default response — no sensitive scope:
{
  "accountNumber": "****5678",
  "routingNumber": null
}

// After sensitive:read + PAZ policy + user consent:
{
  "accountNumber": "****5678",
  "accountNumberFull": "010123456789",
  "routingNumber": "026073150"
}`}</Code>
      </Section>

      <Section title="Why Agents Shouldn't Receive Full PII">
        <Callout icon="⚠️" color="#d97706" bg="#fffbeb" border="#f59e0b">
          <strong>LLM context ≠ private memory.</strong> Prompts and responses may be logged
          by the inference provider, cached in middleware layers, or included in future training
          datasets under permissive ToS. Treat anything passed to an LLM as potentially visible
          to the model vendor.
        </Callout>
        <ul style={{ color: '#475569', fontSize: '0.88rem', paddingLeft: '1.2rem', lineHeight: 1.7 }}>
          <li>Full account numbers + routing numbers are sufficient for ACH fraud; never pass both unless required.</li>
          <li>Use <em>per-session</em> consent with a short TTL (this demo: 60 seconds) so the agent must re-request access after the window expires.</li>
          <li>Log when sensitive data is accessed — not what it is — for audit trails.</li>
          <li>Consider field-level token exchange: mint a narrower token that can only retrieve the one field type needed.</li>
        </ul>
      </Section>

      <Section title="This Demo">
        <Callout icon="🔒" color="#0d9488" bg="#f0fdfa" border="#0d9488">
          The <strong>sensitive:read</strong> scope is gated by three layers:
          <ol style={{ marginTop: '0.4rem', paddingLeft: '1.2rem', lineHeight: 1.7 }}>
            <li>Scope check — token must carry <code>sensitive:read</code> or <code>read</code>.</li>
            <li>PAZ policy — PingOne Authorize (or simulated) evaluates the request.</li>
            <li>User consent — an in-session consent banner asks the user to approve before the data is returned.</li>
          </ol>
        </Callout>
      </Section>
    </div>
  );
}

// ── Tab 2: RAR / RFC 9396 Selective Disclosure ─────────────────────────────

function RarSelectiveContent() {
  return (
    <div>
      <p style={{ color: '#475569', marginBottom: '1rem', fontSize: '0.9rem' }}>
        <strong>Rich Authorization Requests (RAR, RFC 9396)</strong> let a client declare{' '}
        <em>exactly what it intends to do</em> with data — not just which scopes. The authorization server
        and policy engine can make finer-grained decisions per object, per action, per session.
      </p>

      <Section title="RAR in One Sentence">
        <Callout icon="📜" color="#0369a1" bg="#eff6ff" border="var(--brand-navy)">
          Instead of <code>scope=sensitive:read</code>, a client sends an{' '}
          <code>authorization_details</code> JSON array that says:{' '}
          <em>"I want read access to the full account number of account ABC, for the next 5 minutes."</em>
        </Callout>
      </Section>

      <Section title="sensitive:read as a RAR-Adjacent Pattern">
        <p style={{ color: '#475569', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: '0.5rem' }}>
          This demo uses OAuth scopes as a simplified RAR-adjacent pattern. A full RFC 9396 implementation
          would pass <code>authorization_details</code> in the token request:
        </p>
        <Code>{`// Token request with RAR authorization_details:
POST /as/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=...
&authorization_details=[
  {
    "type": "banking_data_access",
    "actions": ["read"],
    "datatypes": ["account_number_full", "routing_number"],
    "identifier": "account-chk-0001",
    "locations": ["https://api.bxfinance.example/accounts"]
  }
]`}</Code>
        <p style={{ color: '#475569', fontSize: '0.88rem', marginTop: '0.4rem' }}>
          The authorization server binds these claims into the issued token. The resource server
          validates them — allowing or rejecting based on type, action, identifier, and location.
        </p>
      </Section>

      <Section title="Why This Matters">
        <p style={{ color: '#475569', fontSize: '0.88rem', lineHeight: 1.6 }}>
          A blanket <code>read</code> scope gives the agent access to everything in the
          read tier — forever (until the token expires). RAR makes each authorization
          decision auditable:
        </p>
        <ul style={{ color: '#475569', fontSize: '0.88rem', paddingLeft: '1.2rem', lineHeight: 1.7 }}>
          <li><strong>Per-object:</strong> agent can read account ABC but not account XYZ.</li>
          <li><strong>Per-action:</strong> agent can read full number but not initiate a transfer.</li>
          <li><strong>Per-session:</strong> authorization valid for 5 minutes only.</li>
          <li><strong>Auditability:</strong> the AS can log exactly which objects were accessed, by which agent client.</li>
        </ul>
      </Section>

      <Section title="How This Demo Uses It">
        <Callout icon="🏦" color="#0d9488" bg="#f0fdfa" border="#0d9488">
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            The demo uses <strong>sensitive:read</strong> as a simplified proxy for a RAR type.
            Real PingOne Authorize integration would pass the account identifier in
            <code> authorization_details</code> and the PAZ policy would evaluate per-account
            decisions. The consent banner adds a user-approval layer on top of that policy.
          </p>
        </Callout>
        <p style={{ color: '#475569', fontSize: '0.88rem', marginTop: '0.75rem', lineHeight: 1.6 }}>
          <strong>Full RFC 9396 §7 implementation</strong> would pass{' '}
          <code>authorization_details</code> in the PAR request (RFC 9126), bind them to the
          authorization code, and verify them at the resource server on every API call — not just
          at token issuance.
        </p>
      </Section>

      <Section title="Cross-reference">
        <p style={{ color: '#475569', fontSize: '0.88rem', lineHeight: 1.6 }}>
          For a general introduction to <strong>Rich Authorization Requests</strong> beyond banking,
          see the <strong>RAR (RFC 9396)</strong> education panel. This panel focuses on the
          selective-disclosure use-case for sensitive banking data specifically.
        </p>
      </Section>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

const tabs = [
  { id: 'least-data',    label: 'Least-Data Principle', content: <LeastDataContent /> },
  { id: 'rar-selective', label: 'RAR / RFC 9396',       content: <RarSelectiveContent /> },
];

export default function SensitiveDataPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Sensitive Data & Selective Disclosure"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
