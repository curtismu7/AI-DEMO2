// banking_api_ui/src/components/education/A2ADelegationPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

/**
 * Agent-to-Agent (A2A) delegation — a generalist agent delegating a narrow,
 * sensitive sub-task to a per-vertical specialist agent. Conceptual + this-demo
 * panel; cross-links to RFC 8693 / Token Chain / PingOne Authorize for mechanics.
 */
export default function A2ADelegationPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();

  const CrossLink = ({ panelId, tabId, children }) => (
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

  const Callout = ({ color = '#6366f1', bg = 'rgba(99,102,241,0.08)', children }) => (
    <div style={{ background: bg, borderLeft: `3px solid ${color}`, padding: '8px 12px', borderRadius: 4, margin: '0.75rem 0' }}>
      {children}
    </div>
  );

  const tabs = [
    {
      id: 'what',
      label: 'What is A2A?',
      content: (
        <>
          <p style={{ color: '#374151', marginBottom: '1rem' }}>
            <strong>Agent-to-Agent (A2A) delegation</strong> is when one agent hands a narrow
            sub-task to a <em>second, more specialized</em> agent. The generalist assistant you talk
            to stays in charge of the conversation, but for sensitive or specialized work it
            delegates to a <strong>specialist agent</strong> that is trusted with exactly that — and
            nothing else.
          </p>
          <p>
            Think of a <strong>family doctor referring you to a specialist</strong>. The GP
            coordinates your care but doesn&apos;t perform the surgery; they refer you to someone
            licensed for that specific procedure — and the referral is on the record.
          </p>
          <h3>Three (or more) actors in the chain</h3>
          <ul>
            <li><strong>The user (you)</strong> — who the action is <em>for</em>; still the subject of every token.</li>
            <li><strong>Agent 1 — the generalist</strong> — coordinates and <em>delegates</em> the sub-task.</li>
            <li><strong>Agent 2 — the specialist</strong> — actually performs the sensitive read, under a delegated identity.</li>
          </ul>
          <Callout>
            <strong>The token never stops being yours.</strong> After delegation the token still has{' '}
            <code>sub: you</code>; what changes is the <code>act</code> claim — it nests:{' '}
            <code>act&#123;specialist, act&#123;generalist&#125;&#125;</code>. The resource server sees the{' '}
            <em>whole</em> chain of agents that acted on your behalf.
          </Callout>
        </>
      ),
    },
    {
      id: 'why',
      label: 'Why it matters',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Least privilege, per agent</h3>
          <p style={{ color: '#374151' }}>
            A single all-powerful agent is a fat target. A2A splits capability: the generalist can
            chat and do everyday reads, but it <strong>cannot</strong> reach the most sensitive data.
            Only the specialist can — and only for its one job.
          </p>
          <h3>The authorization decision is over the <code>act</code> chain — not <code>may_act</code></h3>
          <p style={{ color: '#374151' }}>
            This demo deliberately does <strong>not</strong> use a <code>may_act</code> pre-authorization
            claim for A2A. Instead the <strong>token endpoint just builds the chain</strong>, and{' '}
            <strong>PingOne Authorize decides</strong> whether that chain may run the tool — reading the
            nested <code>act</code> claim at call time:
          </p>
          <ul>
            <li><strong>Generalist alone</strong> (act depth 1) calling a sensitive tool → <strong style={{ color: '#b91c1c' }}>DENY</strong>. It must delegate.</li>
            <li><strong>Specialist delegated by the generalist</strong> (act depth 2) → <strong style={{ color: '#15803d' }}>PERMIT</strong>.</li>
          </ul>
          <Callout color="#10b981" bg="rgba(16,185,129,0.08)">
            <strong>Auditability.</strong> Every sensitive read records both <em>who it was for</em> (you)
            and the <em>full chain of agents</em> that touched it. &ldquo;Which agent saw this record?&rdquo;
            has an unambiguous answer.
          </Callout>
        </>
      ),
    },
    {
      id: 'demo',
      label: 'In this demo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Every vertical has its own specialist</h3>
          <p style={{ color: '#374151' }}>
            A2A is a generic capability that lights up in each vertical with a domain specialist:
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', margin: '0.5rem 0 1rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '4px 8px' }}>Vertical</th>
                <th style={{ padding: '4px 8px' }}>Specialist (Agent 2)</th>
                <th style={{ padding: '4px 8px' }}>Sensitive task</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Banking', 'Investment Advisor', 'Read investment positions'],
                ['Healthcare', 'Records Specialist', 'Read the sensitive patient record'],
                ['Retail', 'Purchase Specialist', 'Read sensitive order history'],
                ['Sporting Goods', 'Membership Specialist', 'Read sensitive membership details'],
                ['Workforce', 'Payroll Specialist', 'Read sensitive payroll details'],
              ].map(([v, s, t]) => (
                <tr key={v} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 600 }}>{v}</td>
                  <td style={{ padding: '4px 8px' }}>{s}</td>
                  <td style={{ padding: '4px 8px', color: '#374151' }}>{t}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>How it shows up</h3>
          <ol>
            <li><strong>Ask for sensitive data</strong> — e.g. &ldquo;show the sensitive record&rdquo;. The generalist can&apos;t read it directly.</li>
            <li><strong>It delegates</strong> (<code>delegate_to_specialist</code>) — the BFF runs a chained RFC 8693 exchange minting a nested-<code>act</code> token.</li>
            <li><strong>A2A Protocol handoff</strong> — Agent Card discovery + JSON-RPC <code>SendMessage</code> with a separate PingOne Bearer (Token Chain events <code>a2a-protocol-*</code>).</li>
            <li><strong>Authorize decides over the chain</strong> — the specialist&apos;s depth-2 chain is permitted; the generalist alone would be denied.</li>
            <li><strong>Watch the Token Chain</strong> — you&apos;ll see identities, the wire hop, and the authorize decision.</li>
          </ol>
          <div>
            <CrossLink panelId={EDU.TOKEN_CHAIN} tabId="banking-app">See the live Token Chain</CrossLink>
            <CrossLink panelId={EDU.PINGONE_AUTHORIZE} tabId="overview">How Authorize decides</CrossLink>
          </div>
        </>
      ),
    },
    {
      id: 'protocol',
      label: 'A2A Protocol',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Two layers named &ldquo;A2A&rdquo;</h3>
          <p style={{ color: '#374151' }}>
            This demo uses <strong>Agent-to-Agent</strong> in two complementary ways. They are not the same mechanism:
          </p>
          <ul>
            <li>
              <strong>Identity (PingOne)</strong> — chained RFC 8693 token exchange builds a nested{' '}
              <code>act</code> claim. PingOne Authorize decides MCP/gateway access over that chain.
            </li>
            <li>
              <strong>Wire protocol (Linux Foundation A2A)</strong> — the generalist discovers the specialist via an{' '}
              <strong>Agent Card</strong> and sends an A2A <code>SendMessage</code> over JSON-RPC, authenticated with a{' '}
              <strong>separate PingOne Bearer</strong> (not the nested-act MCP token). Pattern matches the official{' '}
              <a
                href="https://github.com/a2aproject/a2a-samples/tree/main/samples/java/agents/magic_8_ball_security"
                target="_blank"
                rel="noopener noreferrer"
              >
                Magic 8 Ball security sample
              </a>
              , with PingOne as the IdP instead of Keycloak.
            </li>
          </ul>
          <Callout>
            Wire hop and MCP hop are deliberate separates: protocol auth proves agent-to-agent transport;
            nested <code>act</code> proves who may call banking tools for the user.
          </Callout>
          <h3>When it runs</h3>
          <p style={{ color: '#374151' }}>
            Only UC2 / UC2.5. Ordinary agent chats do not hit A2A protocol endpoints.
            Every vertical specialist exposes{' '}
            <code>/a2a/specialists/&lt;vertical&gt;/.well-known/agent-card.json</code>.
          </p>
          <h3>Official docs &amp; samples</h3>
          <ul>
            <li>
              <a href="https://a2a-protocol.org/dev/tutorials/" target="_blank" rel="noopener noreferrer">
                A2A tutorials
              </a>
            </li>
            <li>
              <a href="https://a2a-protocol.org/v1.0.0/specification/" target="_blank" rel="noopener noreferrer">
                A2A Protocol specification v1.0
              </a>
            </li>
            <li>
              <a href="https://github.com/a2aproject/a2a-samples" target="_blank" rel="noopener noreferrer">
                a2aproject/a2a-samples
              </a>
            </li>
            <li>
              <a href="https://github.com/a2aproject/a2a-js" target="_blank" rel="noopener noreferrer">
                @a2a-js/sdk (JavaScript)
              </a>
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'learn-more',
      label: 'Learn more',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Go deeper</h3>
          <p style={{ color: '#374151' }}>
            Identity A2A is built from the same exchange primitive as single-agent delegation — just chained.
            Protocol A2A is the open Agent2Agent wire standard on top of that story:
          </p>
          <div>
            <CrossLink panelId={EDU.OBO} tabId="what">On-Behalf-Of — the single-agent case</CrossLink>
            <CrossLink panelId={EDU.RFC_8693} tabId="overview">RFC 8693 — the exchange + act claim</CrossLink>
            <CrossLink panelId={EDU.TOKEN_FLOW} tabId="diagram">Token flow — audiences & scopes</CrossLink>
            <CrossLink panelId={EDU.MAY_ACT} tabId="what">may_act vs act — why A2A uses act only</CrossLink>
            <CrossLink panelId={EDU.PINGONE_AUTHORIZE} tabId="overview">PingOne Authorize — the policy engine</CrossLink>
          </div>
          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: '1rem' }}>
            The <code>act</code> claim and its nesting are defined in{' '}
            <a href="https://datatracker.ietf.org/doc/html/rfc8693" target="_blank" rel="noopener noreferrer">
              RFC 8693 — OAuth 2.0 Token Exchange
            </a>
            . Start with the{' '}
            <a href="https://a2a-protocol.org/dev/tutorials/" target="_blank" rel="noopener noreferrer">
              A2A Protocol tutorials
            </a>{' '}
            for Agent Cards, skills, and authenticated clients.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Agent-to-Agent (A2A) Delegation"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
