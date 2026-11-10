// PersonalAgentFlowPage.jsx — the /personal-agent request-flow diagram on its own page, for the Diagrams section.
// Same data as the "Expand for Diagram" panel on the Personal Agent Studio (config/personalAgentSequenceFlow.js),
// so the two stay one diagram. Also hosts the architecture .drawio/.mmd downloads and the
// "prove it live" walkthrough that drives the Studio with the diagram's own prompts.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import DiagramExportBar from '../components/DiagramExportBar';
import { PERSONAL_AGENT_SEQUENCE_DETAILS, PERSONAL_AGENT_SEQUENCE_PAYLOADS, PERSONAL_AGENT_SEQUENCE_SOURCE, personalAgentMessageForReelStep } from '../config/personalAgentSequenceFlow';

const PROVE_STEPS = [
  {
    id: 1,
    claim: 'User signs in — Ping session issues the user token',
    prompt: null,
    see: 'Pipeline step 2: Sign-in, sub "demouser". Token Chain "User token" card: iss, sub, aud, RS256.',
  },
  {
    id: 2,
    claim: 'Agent token — the agent authenticates with its own client (client_credentials)',
    prompt: 'My courses',
    see: 'Token Chain "Actor token" card: client_credentials, agent client_id, aud enduser.ping.demo.',
  },
  {
    id: 3,
    claim: 'Token Exchange (RFC 8693) — sub=user, act=agent, audience and scope narrowed',
    prompt: 'My courses',
    see: 'Token Chain "Exchanged token" card: sub demouser, act.sub (agent), aud api.ping.demo:3036/mcp, scope narrowed 7 → 2.',
  },
  {
    id: 4,
    claim: 'MCP is protected — tokenless calls get 401, then discovery',
    prompt: 'My courses',
    see: 'Pipeline steps 4-5: tools/list 401 → tools permitted (243).',
  },
  {
    id: 5,
    claim: 'Gateway validates the exchanged token before the tool call',
    prompt: 'My courses',
    see: 'Pipeline: tools/call 401 → Gateway introspection valid. The "Gateway token checks" card lists signature/issuer/audience/scope/act checks.',
  },
  {
    id: 6,
    claim: 'Fine-grained authorization — PingOne Authorize decides per tool',
    prompt: 'access my sensitive student finance',
    see: 'Pipeline step: Authorize engine pingone; deeper delegation runs (A2A act-chain depth 2) with a narrower scope for the specialist agent.',
  },
  {
    id: 7,
    claim: 'HITL — sensitive actions pause for human approval',
    prompt: 'register for a course',
    see: 'Agent replies "Transaction requires human approval (HITL consent)"; pipeline shows Step-up in flight and Gateway authorize INDETERMINATE.',
  },
  {
    id: 8,
    claim: 'Intent token — the BFF mints intent, tool allowlist and prompt hash',
    prompt: 'My courses',
    see: 'Token Chain "Intent token" card: minted by the BFF, not the AS.',
  },
];

export default function PersonalAgentFlowPage() {
  const [proved, setProved] = useState({});

  function markDone(id) {
    setProved((p) => ({ ...p, [id]: !p[id] }));
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px 32px' }}>
      <PageHeader
        eyebrow="Diagrams"
        title="Personal Agent request flow"
        summary="The company lists its connector in the AI assistant's catalog once and members add it for free. Then one request from the Personal Agent Studio is governed: sign-in, token exchange, PingOne Authorize and the MCP tool, with the step-up and human-approval detour."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />
      <div data-testid="pa-flow-page-diagram">
        <SequenceFlowDiagram
          source={PERSONAL_AGENT_SEQUENCE_SOURCE}
          details={PERSONAL_AGENT_SEQUENCE_DETAILS}
          payloads={PERSONAL_AGENT_SEQUENCE_PAYLOADS}
          reelSync={personalAgentMessageForReelStep}
          label="How ChatGPT accesses member benefits: CIMD discovery, IdP consent, P1AZ authorization and permitted MCP access"
        />
      </div>

      <section style={{ marginTop: 24, borderTop: '1px solid var(--th-border)', paddingTop: 16 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Architecture diagram (Lucid / draw.io)</h2>
        <p style={{ fontSize: 13, color: 'var(--th-text-muted)', margin: '0 0 8px' }}>
          The architecture behind this flow, with the live-validated token claims. Import the .drawio
          into Lucid (File &gt; Import &gt; draw.io) or open it in draw.io; every token note on it was
          captured from a real run of this demo.
        </p>
        <DiagramExportBar
          items={[
            { label: 'Personal agent v1.0 (.drawio)', href: '/architecture/personal-agent-chatgpt-v1.0.drawio' },
            { label: 'Personal agent v1.0 (.mmd)', href: '/architecture/personal-agent-chatgpt-v1.0.mmd' },
            { label: 'Digital assistant — V2 GW/Authorize v1.0 (.drawio)', href: '/architecture/digital-assistant-v1.0.drawio' },
          ]}
        />
      </section>

      <section style={{ marginTop: 24, borderTop: '1px solid var(--th-border)', paddingTop: 16 }} data-testid="pa-prove-it">
        <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>Prove it live</h2>
        <p style={{ fontSize: 13, color: 'var(--th-text-muted)', margin: '0 0 12px' }}>
          Every claim on the diagram maps to a runnable step. Open the{' '}
          <Link to="/personal-agent">Personal Agent Studio</Link> (ChatGPT skin), sign in, and for each
          row: send the prompt, then check the Token Chain panel for the evidence. Tick rows as you go.
        </p>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {PROVE_STEPS.map((s) => (
            <li
              key={s.id}
              style={{
                border: '1px solid var(--th-border)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 8,
                background: proved[s.id] ? 'var(--th-surface-active, rgba(0,128,0,0.06))' : 'transparent',
              }}
            >
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!proved[s.id]}
                  onChange={() => markDone(s.id)}
                  aria-label={`Proven: ${s.claim}`}
                />
                <span>
                  <strong style={{ fontSize: 13 }}>{s.id}. {s.claim}</strong>
                  {s.prompt && (
                    <span style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                      Prompt: <code style={{ background: 'var(--th-surface, #f5f5f5)', padding: '1px 6px', borderRadius: 4 }}>{s.prompt}</code>{' '}
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(s.prompt)}
                        style={{ fontSize: 11, marginLeft: 4, cursor: 'pointer' }}
                      >
                        copy
                      </button>
                    </span>
                  )}
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--th-text-muted)', marginTop: 4 }}>
                    Evidence: {s.see}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ol>
        <p style={{ fontSize: 12, color: 'var(--th-text-muted)' }}>
          Checked {Object.values(proved).filter(Boolean).length} of {PROVE_STEPS.length} claims.
        </p>
      </section>
    </div>
  );
}
