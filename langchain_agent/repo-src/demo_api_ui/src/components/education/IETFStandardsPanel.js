// banking_api_ui/src/components/education/IETFStandardsPanel.js
import EducationDrawer from "../shared/EducationDrawer";

// ─── Shared sub-components ────────────────────────────────────────────────────

/** Maturity badge with color coding. */
function MaturityBadge({ level, color }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 8px",
        borderRadius: 4,
        backgroundColor: color,
        color: "#fff",
        fontSize: "0.75rem",
        fontWeight: 600,
        marginRight: 8,
        marginBottom: 6,
      }}
    >
      {level}
    </span>
  );
}

/** Standard definition card. */
function StandardCard({
  title,
  whatItDefines,
  wg,
  maturity,
  maturityColor,
  pingRole,
  status,
  statusIcon,
  gap,
  ietfLink,
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "14px 14px",
        marginBottom: 12,
      }}
    >
      <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: "0.95rem" }}>
        {title}
      </p>

      <p style={{ margin: "0 0 8px", fontSize: "0.84rem", color: "#374151" }}>
        <strong>What it defines:</strong> {whatItDefines}
      </p>

      <p style={{ margin: "0 0 8px", fontSize: "0.84rem", color: "#374151" }}>
        <strong>Working Group:</strong> {wg}
      </p>

      <p style={{ margin: "0 0 8px", fontSize: "0.84rem" }}>
        <strong>Maturity:</strong>
        <br />
        <MaturityBadge level={maturity} color={maturityColor} />
      </p>

      <p style={{ margin: "0 0 8px", fontSize: "0.84rem", color: "#374151" }}>
        <strong>Ping Role:</strong> {pingRole}
      </p>

      <p style={{ margin: "0 0 8px", fontSize: "0.84rem", color: "#374151" }}>
        <strong>Current Demo Implementation:</strong>
        <br />
        {statusIcon} {status}
      </p>

      {gap && (
        <p
          style={{
            margin: "0 0 8px",
            fontSize: "0.84rem",
            color: "#674114",
            background: "#fffbeb",
            padding: "6px 8px",
            borderRadius: 4,
            borderLeft: "3px solid #ca8a04",
          }}
        >
          <strong>Gap:</strong> {gap}
        </p>
      )}

      {ietfLink && (
        <p style={{ margin: "0 0 0", fontSize: "0.82rem" }}>
          <a
            href={ietfLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#4f46e5", textDecoration: "none" }}
          >
            IETF Draft ↗
          </a>
        </p>
      )}
    </div>
  );
}

/** IDC Guardrails mapping table. */
function IDCGuardrailsTable() {
  const guardrails = [
    {
      num: "01",
      name: "Verifiable credentials for repeatable, portable identity proofing",
      standards: "SD-JWT VC + OID4VCI + OID4VP",
      maturity: "Near-RFC / Final",
      status: "❌",
    },
    {
      num: "02",
      name: "Delegated authorization with full audit trail across agent chains",
      standards: "Identity Chaining + ID-JAG + RFC 8693 Token Exchange",
      maturity: "Very High",
      status: "✅",
    },
    {
      num: "03",
      name: "Explainability logs — every action traceable to its authorization decision",
      standards: "RFC 8693 nested act claims + Identity Chaining audit chain",
      maturity: "Current / High",
      status: "✅",
    },
    {
      num: "04",
      name: "Real-time workload attestation and trust across system boundaries",
      standards: "WIMSE Workload Identity",
      maturity: "Medium-High",
      status: "❌",
    },
    {
      num: "05",
      name: "Data provenance and cryptographic integrity of credentials",
      standards: "PQ/T JOSE Post-Quantum",
      maturity: "Medium",
      status: "❌",
    },
  ];

  return (
    <div style={{ overflowX: "auto", marginBottom: 16 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.84rem",
        }}
      >
        <thead>
          <tr
            style={{ background: "#f3f4f6", borderBottom: "2px solid #e5e7eb" }}
          >
            <th
              style={{
                padding: "8px 10px",
                textAlign: "left",
                fontWeight: 600,
              }}
            >
              #
            </th>
            <th
              style={{
                padding: "8px 10px",
                textAlign: "left",
                fontWeight: 600,
              }}
            >
              IDC Guardrail
            </th>
            <th
              style={{
                padding: "8px 10px",
                textAlign: "left",
                fontWeight: 600,
              }}
            >
              Standards
            </th>
            <th
              style={{
                padding: "8px 10px",
                textAlign: "center",
                fontWeight: 600,
              }}
            >
              Demo
            </th>
          </tr>
        </thead>
        <tbody>
          {guardrails.map((g) => (
            <tr key={g.num} style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td
                style={{
                  padding: "8px 10px",
                  color: "#4f46e5",
                  fontWeight: 600,
                }}
              >
                {g.num}
              </td>
              <td style={{ padding: "8px 10px", color: "#374151" }}>
                <strong>{g.name}</strong>
                <br />
                <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>
                  Maturity: {g.maturity}
                </span>
              </td>
              <td
                style={{
                  padding: "8px 10px",
                  color: "#374151",
                  fontSize: "0.78rem",
                }}
              >
                {g.standards}
              </td>
              <td
                style={{
                  padding: "8px 10px",
                  textAlign: "center",
                  fontSize: "0.95rem",
                }}
              >
                {g.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function IETFStandardsPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    // ── Overview ────────────────────────────────────────────────────────────
    {
      id: "overview",
      label: "Overview",
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>
            IETF Standards Stack for Agentic Identity
          </h3>
          <p>
            Ping Identity co-authors seven active IETF standards governing AI
            agent identity, delegation, and trust. Each standard addresses one
            or more of IDC's five AI governance guardrails.
          </p>
          <p style={{ marginTop: 12, marginBottom: 12 }}>
            <strong>IDC AI Governance Guardrails</strong> — How each is
            implemented in this demo:
          </p>
          <IDCGuardrailsTable />
          <p
            style={{
              fontSize: "0.82rem",
              color: "#6b7280",
              borderTop: "1px solid #e5e7eb",
              paddingTop: 10,
            }}
          >
            Source: <em>IETF Standards Stack for Agentic Identity</em> — Ping
            Identity, April 2026.
          </p>
        </>
      ),
    },

    // ── RFC7523bis ──────────────────────────────────────────────────────────
    {
      id: "rfc7523bis",
      label: "RFC7523bis",
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>RFC7523bis — JWT Client Auth Update</h3>
          <StandardCard
            title="RFC7523bis"
            whatItDefines="JWT Bearer Token Profiles for OAuth 2.0 (updated to RFC 7523bis, which adds private_key_jwt improvements and CIBA support)"
            wg="OAuth WG"
            maturity="High"
            maturityColor="#2563eb"
            pingRole="Co-author"
            status="✅ Full"
            statusIcon="✅"
            gap="No current gap — used in agent OAuth client flows"
            ietfLink="https://datatracker.ietf.org/doc/draft-ietf-oauth-rfc7523bis/"
          />
          <p
            style={{
              marginTop: 12,
              fontSize: "0.84rem",
              color: "#374151",
              lineHeight: 1.6,
            }}
          >
            <strong>How the demo uses RFC7523bis:</strong> The banking BFF uses
            JWT client authentication to obtain agent tokens. The agent's OAuth
            client is identified by <code>client_id</code>, authenticated with a
            JWT signed by the agent's private key. This ensures the agent's
            identity is cryptographically bound to the token request.
          </p>
        </>
      ),
    },

    // ── Identity Chaining ───────────────────────────────────────────────────
    {
      id: "identity-chaining",
      label: "Identity Chaining",
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Identity Chaining + ID-JAG</h3>
          <StandardCard
            title="Identity Chaining"
            whatItDefines="Cross-domain delegation + Identity Assertion JWT Grant (ID-JAG) — allows a token holder to request a new token on behalf of another principal, with the entire chain cryptographically linked"
            wg="OAuth WG"
            maturity="Very High"
            maturityColor="#16a34a"
            pingRole="Co-author"
            status="⚠️ Partial"
            statusIcon="⚠️"
            gap="act claims form a chain, but cross-domain delegation is not demonstrated"
            ietfLink="https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-chaining/"
          />
          <p
            style={{
              marginTop: 12,
              fontSize: "0.84rem",
              color: "#374151",
              lineHeight: 1.6,
            }}
          >
            <strong>How the demo uses Identity Chaining:</strong> When the
            bankingAgent makes a token exchange request via RFC 8693, the issued
            MCP token carries an <code>act</code> claim showing the full
            delegation chain: human user → agent → MCP server. This enables
            audit trails and accountability across the entire agent workflow.
          </p>
        </>
      ),
    },

    // ── JAG-IR ──────────────────────────────────────────────────────────────
    {
      id: "jag-ir",
      label: "JAG-IR",
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>
            JAG-IR — JWT Grant Interaction Response
          </h3>
          <StandardCard
            title="JAG-IR"
            whatItDefines="A token grant extension that enables human-in-the-loop (HITL) approval flows for agent operations. Agents wait for human consent before proceeding with sensitive actions."
            wg="OAuth WG"
            maturity="Early"
            maturityColor="#ca8a04"
            pingRole="Co-author"
            status="✅ Full"
            statusIcon="✅"
            gap="None — CIBA HITL flow is fully implemented"
            ietfLink="https://datatracker.ietf.org/doc/draft-ietf-oauth-jag-ir/"
          />
          <p
            style={{
              marginTop: 12,
              fontSize: "0.84rem",
              color: "#374151",
              lineHeight: 1.6,
            }}
          >
            <strong>How the demo uses JAG-IR:</strong> High-value operations
            (transfers, sensitive account changes) trigger out-of-band approval
            via CIBA (Client-Initiated Backchannel Authentication). The agent
            polls until the human approves or denies. Only after approval does
            the agent receive the delegated token to complete the action. All
            approvals are logged for audit.
          </p>
        </>
      ),
    },

    // ── AIMS ─────────────────────────────────────────────────────────────────
    {
      id: "aims",
      label: "AIMS",
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>AIMS — AI Agent Auth Framework</h3>
          <StandardCard
            title="AI Agent Auth (AIMS)"
            whatItDefines="A comprehensive agent authentication and authorization framework combining WIMSE workload identity with OAuth 2.0 token flows, scopes, and delegated access patterns."
            wg="Network WG"
            maturity="Early"
            maturityColor="#ca8a04"
            pingRole="Co-author"
            status="⚠️ Partial"
            statusIcon="⚠️"
            gap="Agent identity via OAuth is implemented; WIMSE workload identity binding is not"
            ietfLink="https://datatracker.ietf.org/doc/draft-ietf-wimse-ai-agent-auth/"
          />
          <p
            style={{
              marginTop: 12,
              fontSize: "0.84rem",
              color: "#374151",
              lineHeight: 1.6,
            }}
          >
            <strong>How the demo uses AIMS:</strong> Each AI agent has its own
            registered OAuth 2.0 client with a unique <code>client_id</code> and
            secret. The agent authenticates to obtain tokens, which are narrowly
            scoped (only the tools it needs). Token exchanges preserve the
            delegation chain so every action is attributable to the correct
            agent and human principal.
          </p>
        </>
      ),
    },

    // ── WIMSE ───────────────────────────────────────────────────────────────
    {
      id: "wimse",
      label: "WIMSE",
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>WIMSE — Workload Identity</h3>
          <StandardCard
            title="WIMSE"
            whatItDefines="Workload Identity Made Easy — a standard for cryptographically binding workload identity (e.g., an MCP server, a microservice, an agent) to its OAuth tokens, eliminating reliance on secrets stored in config files."
            wg="WIMSE WG"
            maturity="Medium-High"
            maturityColor="#d97706"
            pingRole="Co-author"
            status="❌ Not implemented"
            statusIcon="❌"
            gap="Current demo uses environment-variable client secrets. WIMSE workload attestation (short-lived, cryptographically bound credentials) is not yet a native PingOne feature — it requires a SPIFFE/SPIRE or equivalent sidecar alongside PingOne as the authorization server. The standard is still maturing in the IETF WIMSE WG."
            ietfLink="https://datatracker.ietf.org/doc/draft-ietf-wimse-workload-identity/"
          />
          <p
            style={{
              marginTop: 12,
              fontSize: "0.84rem",
              color: "#374151",
              lineHeight: 1.6,
            }}
          >
            <strong>PingOne role:</strong> PingOne can act as the authorization
            server for workload tokens, but the WIMSE-specific workload
            attestation binding — where a process proves its identity without
            any stored secret — is outside PingOne's current product surface.
            A SPIFFE/SPIRE integration would attest the workload and exchange
            the SVID for a PingOne-issued token.
          </p>
          <p
            style={{
              marginTop: 8,
              fontSize: "0.84rem",
              color: "#374151",
              lineHeight: 1.6,
            }}
          >
            <strong>Roadmap:</strong> As the WIMSE WG finalizes the spec,
            PingOne is expected to add native workload attestation support.
            When available, static secrets between the banking BFF and MCP
            server will be replaced with short-lived, cryptographically bound
            workload tokens — closing IDC Guardrail 04 at full fidelity.
          </p>
        </>
      ),
    },

    // ── SD-JWT VC ───────────────────────────────────────────────────────────
    {
      id: "sd-jwt-vc",
      label: "SD-JWT VC",
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>
            SD-JWT VC — Selective Disclosure Credentials
          </h3>
          <StandardCard
            title="SD-JWT VC"
            whatItDefines="Selective Disclosure JWTs for Verifiable Credentials — allows a credential issuer to issue a single JWT that can be presented to different verifiers, selectively revealing only the fields each verifier needs."
            wg="OAuth WG"
            maturity="Very High"
            maturityColor="#16a34a"
            pingRole="Co-author"
            status="❌ Not implemented"
            statusIcon="❌"
            gap="This demo issues standard PingOne OAuth tokens. SD-JWT VC requires a credential issuance flow (OID4VCI), a wallet to hold the credential, and a presentation protocol (OID4VP) — all outside the current demo scope."
            ietfLink="https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/"
          />
          <p
            style={{
              marginTop: 12,
              fontSize: "0.84rem",
              color: "#374151",
              lineHeight: 1.6,
            }}
          >
            <strong>PingOne role:</strong> PingOne Credentials (a dedicated
            product) fully supports SD-JWT VC issuance via OID4VCI and
            presentation via OID4VP. Adding it to this demo would require a
            credential issuer configuration, a wallet application or library,
            and an OID4VP verification step at the banking API.
          </p>
          <p
            style={{
              marginTop: 8,
              fontSize: "0.84rem",
              color: "#374151",
              lineHeight: 1.6,
            }}
          >
            <strong>Roadmap:</strong> Future phases will issue agent credentials
            as SD-JWT VCs via PingOne Credentials, enabling agents to prove
            attributes (e.g., delegation level, scopes) to downstream systems
            with selective disclosure. This fulfills IDC Guardrail 01 at full
            fidelity.
          </p>
        </>
      ),
    },

    // ── PQ/T JOSE ───────────────────────────────────────────────────────────
    {
      id: "pq-jose",
      label: "PQ/T JOSE",
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>
            PQ/T JOSE — Post-Quantum Cryptography
          </h3>
          <StandardCard
            title="PQ/T JOSE"
            whatItDefines="IETF registrations for Post-Quantum and Hybrid cryptographic algorithms in JOSE (JSON Object Signing and Encryption), enabling JWTs signed with quantum-resistant algorithms."
            wg="JOSE WG"
            maturity="Medium"
            maturityColor="#d97706"
            pingRole="Co-author"
            status="❌ Not implemented"
            statusIcon="❌"
            gap="PingOne currently signs tokens with RS256/ES256. Post-quantum JOSE algorithm registrations (ML-DSA, SLH-DSA) are still being finalized by the JOSE WG — no commercial identity provider supports PQ/T JOSE yet."
            ietfLink="https://datatracker.ietf.org/doc/draft-ietf-jose-post-quantum/"
          />
          <p
            style={{
              marginTop: 12,
              fontSize: "0.84rem",
              color: "#374151",
              lineHeight: 1.6,
            }}
          >
            <strong>Context:</strong> NIST finalized the first post-quantum
            cryptography algorithms in 2024 (ML-KEM, ML-DSA, SLH-DSA). The
            IETF JOSE WG is actively registering these for use in JWTs and
            JOSE objects, but the draft is not yet finalized. Adoption by token
            issuers — including PingOne — is a 2026–2027 horizon item.
          </p>
          <p
            style={{
              marginTop: 8,
              fontSize: "0.84rem",
              color: "#374151",
              lineHeight: 1.6,
            }}
          >
            <strong>Roadmap:</strong> When PingOne adds PQ/T JOSE signing
            support, this demo will demonstrate hybrid signing (e.g.,
            ES256+ML-DSA-65), protecting agent tokens against cryptographically
            relevant quantum computers (CRQC) and fulfilling IDC Guardrail 05.
          </p>
        </>
      ),
    },
  ];

  const tabsWithBack = tabs.map((t) => {
    if (t.id === "overview") return t;
    return {
      ...t,
      content: (goToTab) => (
        <>
          <button
            type="button"
            onClick={() => goToTab("overview")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 16,
              padding: "5px 12px",
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "#1d4ed8",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            ← All Standards
          </button>
          {t.content}
        </>
      ),
    };
  });

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="IETF Standards: Agentic Identity"
      tabs={tabsWithBack}
      initialTabId={initialTabId}
    />
  );
}
