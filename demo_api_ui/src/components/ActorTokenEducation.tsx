import React, { useState } from 'react';
import styles from './ActorTokenEducation.module.css';
import TokenChainTraceRail from './TokenChainTraceRail';

/**
 * ActorTokenEducation Component
 *
 * Educational panel explaining actor (agent) token delegation in RFC 8693 pattern.
 * Clarifies terminology: "Actor Token" = "Agent Token" (same thing, different names)
 *
 * Displays:
 * - Visual diagram of token transformation during delegation
 * - Clear explanation of actor/agent terminology
 * - Act claim purpose and nested delegation chain
 * - FAQ for common questions
 */
export const ActorTokenEducation: React.FC = () => {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  const faqs = [
    {
      question: 'What is an actor token or agent token?',
      answer:
        'An "actor token" (also called "agent token") is a special OAuth token that identifies an AI agent or service performing actions on your behalf. It contains two identities: the original you (subject) and the agent/actor doing the work. These terms are interchangeable: "actor" appears in RFC specifications, "agent" in our UI.'
    },
    {
      question: 'How is it different from my regular token?',
      answer:
        'Your regular token identifies just you. An actor/agent token identifies both you AND the agent acting on your behalf. This is called "delegation" — you delegate specific actions to the agent. The token includes an "act claim" that records the full delegation chain: who is acting, and on whose behalf.'
    },
    {
      question: 'Can the agent access more than I permit?',
      answer:
        'No. The delegated token is scoped to only the permissions you grant. If you grant the agent permission to read your transaction history, it can only read transactions — not transfer money, delete accounts, or access other APIs. Platform-level authorization (PingOne app grants and scopes) controls what the agent can do.'
    },
    {
      question: 'How do I know what my agent did?',
      answer:
        'Every action performed by an agent is logged with: who the agent is (act claim with nested delegation chain), which user it acted for (subject), what scopes were used, and the timestamp. You can view this audit trail in the operations log section of the dashboard.'
    },
    {
      question: 'Can I revoke agent access?',
      answer:
        'Yes. Revoking a delegation immediately invalidates all actor/agent tokens under that delegation. This happens at the OAuth/authorization server level, so the revocation takes effect instantly across all services.'
    }
  ];

  return (
    <div className={styles.actorTokenEducation} data-testid="actor-token-education">
      <h2>Understanding Actor (Agent) Token Delegation</h2>

      <div className={styles.introduction}>
        <p>
          When an AI agent performs actions on your behalf, it uses a special token called an <strong>actor token</strong>
          (also called an <strong>agent token</strong>). These terms mean the same thing — "actor" in technical documents,
          "agent" in our UI.
        </p>
      </div>

      <div className={styles.visualSection}>
        <h3>How Token Delegation Works</h3>
        <div className={styles.diagram}>
          <div className={styles.step}>
            <div className={styles.stepLabel}>1. You Log In</div>
            <div className={styles.stepContent}>
              <code className={styles.token}>
                User Token<br />
                sub: "your-id"<br />
                aud: "banking-api"
              </code>
            </div>
          </div>

          <div className={styles.arrow}>↓</div>

          <div className={styles.step}>
            <div className={styles.stepLabel}>2. Request Agent Action</div>
            <div className={styles.stepContent}>Agent asks: "Can I read your transactions?"</div>
          </div>

          <div className={styles.arrow}>↓</div>

          <div className={styles.step}>
            <div className={styles.stepLabel}>3. Token Exchange</div>
            <div className={styles.stepContent}>
              Authorization server creates new token with agent identity
            </div>
          </div>

          <div className={styles.arrow}>↓</div>

          <div className={styles.step}>
            <div className={styles.stepLabel}>4. Agent Gets Actor Token</div>
            <div className={styles.stepContent}>
              <code className={styles.token}>
                Actor Token<br />
                sub: "your-id"<br />
                act: {"{"} sub: "agent-id" {"}"}<br />
                scope: ["read"]<br />
                aud: "banking-api"
              </code>
            </div>
          </div>
        </div>

        <p className={styles.diagramExplanation}>
          The actor token contains <strong>three keys</strong>:
          <ul>
            <li>
              <strong>sub</strong> ("subject"): That's you — the original authenticated user
            </li>
            <li>
              <strong>act</strong> ("actor identity"): That's the agent/service acting on your behalf — records the full delegation chain
            </li>
            <li>
              <strong>scope</strong> ("permissions"): The narrowed set of permissions granted for this delegation
            </li>
          </ul>
        </p>
      </div>

      <div className={styles.terminology}>
        <h3>Key Terms (Actor = Agent)</h3>

        <div className={styles.term}>
          <h4>Actor Token / Agent Token</h4>
          <p>
            Two names for the same token. "Actor" is the RFC spec term. "Agent" is what we call it in the UI.{' '}
            <em>They're completely interchangeable.</em>
          </p>
        </div>

        <div className={styles.term}>
          <h4>Act Claim</h4>
          <p>
            The part of the token that says "This agent/actor XYZ is authorized to act on behalf of user ABC". It
            records the full delegation chain — each hop in a multi-agent flow appends a nested act claim, creating
            an audit trail of who delegated what.
          </p>
        </div>

        <div className={styles.term}>
          <h4>Delegation</h4>
          <p>
            The process of you granting the agent a specific set of permissions to act on your behalf. Authorization
            is controlled at the platform level (PingOne app grants and scopes), and the act claim provides
            cryptographic proof of the delegation chain.
          </p>
        </div>
      </div>

      <div className={styles.faqSection}>
        <h3>Frequently Asked Questions</h3>

        <div className={styles.faqList}>
          {faqs.map((faq, index) => (
            <div key={index} className={styles.faqItem}>
              <button
                className={`${styles.faqQuestion} ${expandedFaq === index ? styles.expanded : ''}`}
                onClick={() => toggleFaq(index)}
                aria-expanded={expandedFaq === index}
              >
                <span className={styles.icon}>▶</span>
                {faq.question}
              </button>
              {expandedFaq === index && <div className={styles.faqAnswer}>{faq.answer}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.liveDemo}>
        <h3>Live Actor Token Flow</h3>
        <p>
          Below is the real token transformation happening as agents act on your behalf. Watch the delegation chain
          build as the agent performs actions. Notice how the "act" claim tracks the agent's identity throughout the chain.
        </p>
        <div style={{ borderRadius: '8px', border: '1px solid #bbf7d0', background: '#f0fdf4', padding: '12px', marginTop: '12px', maxHeight: '400px', overflowY: 'auto' }}>
          <TokenChainTraceRail />
        </div>
        <p style={{ fontSize: '13px', color: '#64748b', marginTop: '12px' }}>
          Go to the dashboard and request an agent action (e.g., "Check my balance") to see the actor token transform in real time above.
        </p>
      </div>

      <div className={styles.relatedResources}>
        <h3>Related Resources</h3>
        <ul>
          <li>
            <a href="/docs/ACTOR_TOKEN_TERMINOLOGY.md" target="_blank" rel="noopener noreferrer">
              Complete Actor Token Terminology Guide
            </a>{' '}
            — Full technical reference with RFC references
          </li>
          <li>
            <strong>Token Inspector</strong> — View actual tokens and their claims (see dashboard Token section)
          </li>
          <li>
            <strong>Audit Log</strong> — See what agents have done on your behalf
          </li>
        </ul>
      </div>
    </div>
  );
};
