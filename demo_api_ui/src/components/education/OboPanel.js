// banking_api_ui/src/components/education/OboPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

/**
 * On-Behalf-Of (OBO) — the plain-language conceptual entry point for agent delegation.
 *
 * Intentionally conceptual: it does NOT duplicate the mechanics covered by the
 * RFC 8693 / Token Exchange / may_act / Token Chain panels. Instead it explains
 * the idea and cross-links to those deeper panels via useEducationUI().open(),
 * which swaps the active education panel cleanly.
 */
export default function OboPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();

  // A cross-link to another education panel. Opening another panel via the
  // shared context unmounts this one — a clean handoff, no stacked drawers.
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

  const tabs = [
    {
      id: 'what',
      label: 'What is OBO?',
      content: (
        <>
          <p style={{ color: '#374151', marginBottom: '1rem' }}>
            <strong>On-Behalf-Of (OBO)</strong> is when an AI agent performs an action{' '}
            <em>for you</em> — using your identity and your permissions — rather than acting as
            itself. You stay the person the action is for; the agent is simply the one carrying it out.
          </p>
          <p>
            Think of <strong>power of attorney</strong>, or handing a valet a single key that starts
            the car but won&apos;t open the glovebox. The valet can drive on your behalf, but only within
            the limits you allow — and there&apos;s a clear record that <em>they</em> drove <em>your</em> car.
          </p>
          <h3>Three actors</h3>
          <ul>
            <li><strong>The user (you)</strong> — who the action is <em>for</em>, and whose permissions bound it.</li>
            <li><strong>The agent</strong> — who actually <em>performs</em> the request (the AI assistant app).</li>
            <li><strong>The resource</strong> — what gets called on your behalf (here, the banking APIs via the MCP server).</li>
          </ul>
          <p
            style={{
              background: 'rgba(99,102,241,0.08)',
              borderLeft: '3px solid #6366f1',
              padding: '8px 12px',
              borderRadius: 4,
            }}
          >
            <strong>OBO vs. the agent using its own credentials:</strong> if the agent just used its
            own identity, the bank would see <em>the app</em> making requests with the app&apos;s
            permissions — your identity and your limits would be lost. OBO keeps <em>you</em> in the
            picture: the request runs as you, capped by what you&apos;re allowed to do.
          </p>
        </>
      ),
    },
    {
      id: 'why',
      label: 'Why it matters',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>What OBO buys you</h3>
          <ul>
            <li>
              <strong>Least privilege.</strong> The agent can never do more than you can. Its
              delegated permissions are a <em>subset</em> of yours — never a superset.
            </li>
            <li>
              <strong>Identity preserved end-to-end.</strong> Your identity travels with every call.
              The bank&apos;s APIs see the action as <em>yours</em>, not as an anonymous app request.
            </li>
            <li>
              <strong>Accountability and audit.</strong> Every call records both{' '}
              <em>who it was for</em> (you) and <em>who performed it</em> (the agent). When you ask
              &ldquo;who really did this?&rdquo;, the answer is unambiguous.
            </li>
            <li>
              <strong>Revocable and bounded.</strong> Delegation is explicit and scoped. No standing
              broad access — the agent acts for you only when, and only as far as, you allow.
            </li>
          </ul>
          <h3>What OBO prevents</h3>
          <ul>
            <li>An agent quietly accumulating its own broad permissions across many users.</li>
            <li>Losing the trail of which human a given action was actually taken for.</li>
            <li>An agent exceeding the permissions of the person it&apos;s helping.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'demo',
      label: 'In this demo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>How OBO shows up here</h3>
          <ol>
            <li><strong>You sign in</strong> — PingOne issues your access token.</li>
            <li>
              <strong>You ask the agent to do something</strong> — the BFF (never the browser)
              exchanges your token for a fresh, narrowly-scoped token that carries your identity{' '}
              <em>plus</em> a note saying the agent is acting for you.
            </li>
            <li>
              <strong>The agent calls a banking tool as you</strong> — the request reaches the MCP
              server scoped to exactly what you allowed.
            </li>
            <li>
              <strong>You can watch it happen</strong> — the live Token Chain shows each token and
              who it&apos;s for at every hop.
            </li>
          </ol>
          <p style={{ color: '#374151', marginTop: '1rem' }}>
            Want the mechanics behind each step?
          </p>
          <div>
            <CrossLink panelId={EDU.TOKEN_CHAIN} tabId="banking-app">See the live Token Chain</CrossLink>
            <CrossLink panelId={EDU.RFC_8693} tabId="overview">How the exchange works (RFC 8693)</CrossLink>
            <CrossLink panelId={EDU.MAY_ACT} tabId="what">may_act / act claims</CrossLink>
          </div>
        </>
      ),
    },
    {
      id: 'real-world-attacks',
      label: 'Real-World Attacks',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>When OBO goes wrong: the account-takeover pattern</h3>
          <p style={{ color: '#374151' }}>
            In 2024, Meta&apos;s AI support chatbot could be prompted to change the email address
            on <em>any</em> account — not just the one belonging to the person asking. An attacker
            simply said &ldquo;change the email on account X to attacker@evil.com&rdquo; and the
            bot complied. Account taken over; no MFA required.
          </p>
          <p style={{ color: '#374151' }}>
            The root cause was not a bug in the agent&apos;s language model. It was a missing
            authorization control: the system knew <em>what</em> the agent wanted to do, but had
            no policy that checked <em>whether the requesting user owned the target resource</em>.
          </p>
          <div
            style={{
              background: 'rgba(239,68,68,0.07)',
              borderLeft: '3px solid #ef4444',
              padding: '8px 12px',
              borderRadius: 4,
              marginBottom: '1rem',
            }}
          >
            <strong>The gap:</strong> action-level authorization (&ldquo;can this user update
            an email?&rdquo;) without resource-level authorization (&ldquo;can this user update
            <em>this</em> email?&rdquo;).
          </div>
          <h3>How this demo prevents it</h3>
          <p style={{ color: '#374151' }}>
            The <strong>update_contact_email</strong> MCP tool demonstrates the fix. Before the
            agent can call it, PingOne Authorize (or the simulated engine) evaluates a{' '}
            <strong>ResourceOwnerId</strong> parameter alongside the token subject:
          </p>
          <ol>
            <li>
              The BFF looks up the account from the data store and extracts its owner&apos;s user ID.
            </li>
            <li>
              That owner ID is passed to the authorization policy as <code>ResourceOwnerId</code>.
            </li>
            <li>
              The policy compares <code>ResourceOwnerId</code> to <code>UserId</code> (from the token).
              If they do not match &rarr; <strong>DENY</strong>.
            </li>
            <li>
              The agent receives a clear denial before any mutation occurs — and before the MCP
              server is even contacted.
            </li>
          </ol>
          <div
            style={{
              background: 'rgba(99,102,241,0.08)',
              borderLeft: '3px solid #6366f1',
              padding: '8px 12px',
              borderRadius: 4,
            }}
          >
            Try it: ask the agent &ldquo;update the email on account &lt;someone-else&apos;s
            account ID&gt;&rdquo;. The authorize gate fires with{' '}
            <code>resource_owner_mismatch</code> and the tool never executes.
          </div>
          <div style={{ marginTop: '1rem' }}>
            <CrossLink panelId={EDU.PINGONE_AUTHORIZE} tabId="overview">PingOne Authorize — the policy engine</CrossLink>
            <CrossLink panelId={EDU.OBO} tabId="why">Why OBO alone is not enough</CrossLink>
          </div>
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
            OBO is the concept. These panels cover the protocol and the proof:
          </p>
          <div>
            <CrossLink panelId={EDU.TOKEN_EXCHANGE} tabId="why">Token Exchange — step by step</CrossLink>
            <CrossLink panelId={EDU.RFC_8693} tabId="overview">RFC 8693 deep-dive</CrossLink>
            <CrossLink panelId={EDU.MAY_ACT} tabId="what">may_act / act claims</CrossLink>
            <CrossLink panelId={EDU.TOKEN_FLOW} tabId="diagram">2-token exchange flow</CrossLink>
            <CrossLink panelId={EDU.TOKEN_CHAIN} tabId="banking-app">Token chain education</CrossLink>
          </div>
          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: '1rem' }}>
            The open standard behind OBO is{' '}
            <a
              href="https://datatracker.ietf.org/doc/html/rfc8693"
              target="_blank"
              rel="noopener noreferrer"
            >
              RFC 8693 — OAuth 2.0 Token Exchange
            </a>
            . It defines how one token is swapped for another in a controlled, auditable way, and how
            the <code>act</code> claim records the delegation.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="On-Behalf-Of (OBO)"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
