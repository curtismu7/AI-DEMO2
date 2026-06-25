import React, { useState } from 'react';
import styles from './AgenticTrustEducation.module.css';
import ScopeNarrowingVisualization from './ScopeNarrowingVisualization';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';

interface Pillar {
  id: number;
  name: string;
  status: 'strong' | 'partial' | 'gap';
  statusLabel: string;
  threat: string;
  demoImplementation: string;
  gap?: string;
  link?: string;
  linkLabel?: string;
  /** If set, clicking the link opens this education panel instead of navigating */
  eduPanel?: string;
  eduTab?: string;
}

const pillars: Pillar[] = [
  {
    id: 1,
    name: 'Credential Replay Prevention',
    status: 'strong',
    statusLabel: '✅ Strong',
    threat: 'Tokens leaked to LLM via prompt injection, man-in-the-middle interception, or logged in clear text.',
    demoImplementation: 'BFF token custodian pattern — tokens are stored server-side in the session and never sent to the browser or LLM. The agent receives tool results, not raw tokens.',
    link: '/pingone-test',
    linkLabel: 'See Token Chain →',
  },
  {
    id: 2,
    name: 'Rogue Agent Prevention',
    status: 'strong',
    statusLabel: '✅ Strong',
    threat: 'Unauthorized agents spoofing identity or impersonating legitimate agents to access protected resources.',
    demoImplementation: 'Agent authenticates via OAuth 2.0 client credentials at PingOne. Each agent has a unique client_id and secret. The authorization server validates agent identity before issuing tokens.',
    link: '/pingone-test',
    linkLabel: 'See Agent Authentication →',
  },
  {
    id: 3,
    name: 'Impersonation Prevention (Delegation)',
    status: 'strong',
    statusLabel: '✅ Strong',
    threat: 'Agent self-asserts user identity without IdP validation — "I am acting for user X" without proof.',
    demoImplementation: 'RFC 8693 token exchange produces a combined token where the IdP validates both user (subject) and agent (actor). The resulting "act" claim is cryptographically bound — the agent cannot forge it.',
    link: '/actor-token-education',
    linkLabel: 'See Token Flow Diagram →',
    eduPanel: EDU.TOKEN_FLOW,
    eduTab: 'diagram',
  },
  {
    id: 4,
    name: 'Per-Hop Token Exchange',
    status: 'strong',
    statusLabel: '✅ Strong',
    threat: 'Single token travels the entire chain (user → agent → MCP → tool) without re-validation at each hop.',
    demoImplementation: 'Token is exchanged at each hop: User→BFF gets a user token, BFF→MCP exchanges for an MCP-scoped token with delegation claims. Each hop gets a fresh token scoped to that segment.',
    link: '/pingone-test',
    linkLabel: 'See All 3 Exchanges →',
  },
  {
    id: 5,
    name: 'Least Privilege / Scope Narrowing',
    status: 'strong',
    statusLabel: '✅ Strong',
    threat: 'Agent token has more permissions than needed — overpermissioning allows lateral movement if token is compromised.',
    demoImplementation: 'Audience restriction (RFC 8707) limits which resource servers accept the token. Scope parameters on exchange requests limit permissions per hop. A visual scope narrowing diagram below shows how 7 user scopes reduce to 3 agent scopes and then 1 tool scope at each exchange hop.',
    link: '/pingone-test',
    linkLabel: 'See it on PingOne Test Page →',
  },
  {
    id: 6,
    name: 'Last Mile Vault',
    status: 'gap',
    statusLabel: '❌ Concept Only',
    threat: 'MCP server stores persistent credentials (API keys, DB passwords) for backend tools — if MCP is compromised, all tool credentials are exposed.',
    demoImplementation: 'Not yet implemented. The concept: use a secrets manager (HashiCorp Vault, AWS Secrets Manager) to provide temporary, per-call credentials. Each tool invocation gets short-lived credentials scoped to that specific operation.',
    gap: 'Currently uses propagated OAuth tokens or config-based credentials. A vault integration is a planned future enhancement.',
  },
];

interface ThreatRow {
  threat: string;
  category: string;
  mitigation: string;
  status: string;
}

const threatModel: ThreatRow[] = [
  { threat: 'Credential Replay', category: 'Tampering', mitigation: 'BFF token custodian — tokens never reach LLM or browser', status: '✅ Mitigated' },
  { threat: 'Rogue Agent', category: 'Spoofing', mitigation: 'OAuth client credentials + IdP validation of agent identity', status: '✅ Mitigated' },
  { threat: 'Impersonation', category: 'Spoofing', mitigation: 'RFC 8693 token exchange with IdP-bound act claim', status: '✅ Mitigated' },
  { threat: 'Overpermissioning', category: 'Elevation of Privilege', mitigation: 'Scope narrowing + audience restriction per hop (visualized)', status: '✅ Mitigated' },
  { threat: 'Token Propagation', category: 'Information Disclosure', mitigation: 'Per-hop exchange — fresh token at each boundary', status: '✅ Mitigated' },
  { threat: 'Last Mile Exposure', category: 'Information Disclosure', mitigation: 'Vault for temporary tool credentials (planned)', status: '❌ Planned' },
];

export const AgenticTrustEducation: React.FC = () => {
  const [expandedPillar, setExpandedPillar] = useState<number | null>(null);
  const { open: openEdu } = useEducationUI();

  const togglePillar = (id: number) => {
    setExpandedPillar(expandedPillar === id ? null : id);
  };

  return (
    <div className={styles.page} data-testid="agentic-trust-education">
      {/* Header */}
      <header className={styles.header}>
        <h1>Agentic Trust: Securing AI Interactions</h1>
        <p className={styles.subtitle}>
          How this demo implements the 6 security pillars for trustworthy AI agent systems
        </p>
        <a
          href="https://youtube.com/watch?v=lUQ2NKkCW_Q"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.videoLink}
        >
          📺 Watch the Agentic Trust presentation
        </a>
      </header>

      {/* Flow Diagram */}
      <section className={styles.section}>
        <h2>The Agentic Trust Chain</h2>
        <p className={styles.sectionIntro}>
          Security must be validated at every hop in the agent interaction chain. Each connection
          point has a specific security mechanism.
        </p>
        <div className={styles.flowDiagram}>
          <div className={styles.flowNode}>
            <div className={styles.flowIcon}>👤</div>
            <div className={styles.flowLabel}>User</div>
          </div>
          <div className={styles.flowArrow}>
            <div className={styles.flowLine} />
            <span className={styles.flowAnnotation}>🔐 OAuth Login (PKCE)</span>
          </div>
          <div className={styles.flowNode}>
            <div className={styles.flowIcon}>💬</div>
            <div className={styles.flowLabel}>Chat / BFF</div>
          </div>
          <div className={styles.flowArrow}>
            <div className={styles.flowLine} />
            <span className={styles.flowAnnotation}>🤖 Agent Identity (Client Creds)</span>
          </div>
          <div className={styles.flowNode}>
            <div className={styles.flowIcon}>🧠</div>
            <div className={styles.flowLabel}>Agent</div>
          </div>
          <div className={styles.flowArrow}>
            <div className={styles.flowLine} />
            <span className={styles.flowAnnotation}>🔄 Token Exchange (RFC 8693)</span>
          </div>
          <div className={styles.flowNode}>
            <div className={styles.flowIcon}>⚙️</div>
            <div className={styles.flowLabel}>MCP Server</div>
          </div>
          <div className={styles.flowArrow}>
            <div className={styles.flowLine} />
            <span className={styles.flowAnnotation}>🔒 Vault Credentials (Last Mile)</span>
          </div>
          <div className={styles.flowNode}>
            <div className={styles.flowIcon}>🏦</div>
            <div className={styles.flowLabel}>Banking Tool</div>
          </div>
        </div>
      </section>

      {/* 6 Pillars */}
      <section className={styles.section}>
        <h2>The 6 Security Pillars</h2>
        <div className={styles.pillarGrid}>
          {pillars.map((pillar) => (
            <div
              key={pillar.id}
              className={`${styles.pillarCard} ${styles[`pillar${pillar.status}`]}`}
              onClick={() => togglePillar(pillar.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') togglePillar(pillar.id);
              }}
            >
              <div className={styles.pillarHeader}>
                <span className={styles.pillarNumber}>{pillar.id}</span>
                <h3 className={styles.pillarName}>{pillar.name}</h3>
                <span className={`${styles.statusBadge} ${styles[`status${pillar.status}`]}`}>
                  {pillar.statusLabel}
                </span>
              </div>

              {expandedPillar === pillar.id && (
                <div className={styles.pillarBody}>
                  <div className={styles.pillarSection}>
                    <strong>Threat:</strong>
                    <p>{pillar.threat}</p>
                  </div>
                  <div className={styles.pillarSection}>
                    <strong>How this demo addresses it:</strong>
                    <p>{pillar.demoImplementation}</p>
                  </div>
                  {pillar.gap && (
                    <div className={`${styles.pillarSection} ${styles.gapNote}`}>
                      <strong>Gap:</strong>
                      <p>{pillar.gap}</p>
                    </div>
                  )}
                  {pillar.link && (
                    pillar.eduPanel ? (
                      <button
                        className={styles.pillarLink}
                        onClick={() => openEdu(pillar.eduPanel as string, pillar.eduTab)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', textAlign: 'left' }}
                      >
                        {pillar.linkLabel}
                      </button>
                    ) : (
                      <a href={pillar.link} className={styles.pillarLink}>
                        {pillar.linkLabel}
                      </a>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Scope Narrowing Visualization */}
      <section className={styles.section}>
        <h2>Scope Narrowing in Action</h2>
        <p className={styles.sectionIntro}>
          See how OAuth scopes are progressively restricted at each token exchange hop — from full user
          permissions down to a single tool-specific scope.
        </p>
        <ScopeNarrowingVisualization />
      </section>

      {/* Threat Model Table */}
      <section className={styles.section}>
        <h2>Threat Model Summary</h2>
        <div className={styles.tableWrapper}>
          <table className={styles.threatTable}>
            <thead>
              <tr>
                <th>Threat</th>
                <th>Category</th>
                <th>Mitigation</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {threatModel.map((row, i) => (
                <tr key={i}>
                  <td className={styles.threatName}>{row.threat}</td>
                  <td>{row.category}</td>
                  <td>{row.mitigation}</td>
                  <td className={styles.threatStatus}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* What's Next */}
      <section className={styles.section}>
        <h2>What&apos;s Next</h2>
        <ul className={styles.nextList}>
          <li><strong>Scope narrowing visualization</strong> — Interactive view of how scopes restrict at each exchange hop</li>
          <li><strong>Vault integration</strong> — HashiCorp Vault or AWS Secrets Manager for temporary tool credentials</li>
          <li><strong>Inter-agent validation</strong> — Security for multi-agent collaboration (agent-to-agent delegation)</li>
          <li><strong>Consent audit trail</strong> — User-facing log of all agent delegations and actions taken</li>
        </ul>
      </section>
    </div>
  );
};
