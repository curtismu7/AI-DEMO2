// demo_api_ui/src/components/education/MachineIamSurveyPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

// webViewLink of the Google Doc created for this panel (see design spec).
const GARTNER_DOC_URL = 'https://docs.google.com/document/d/1gNl6VIUUahSrOZHizf3cH6TwlaJb_5zxW8y1NxrAdEc/edit';

const ATTRIBUTION =
  'Source: 2025 Gartner Machine Identity Management in a Hybrid, Automated AI World Survey';

// ─── Shared sub-components ───────────────────────────────────────────────────

/** Big stat + caption, used on the Findings tab. */
function Stat({ value, label, colour = 'var(--brand-navy, #1e3a8a)' }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderTop: `4px solid ${colour}`,
      borderRadius: 10, padding: '12px 14px', textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.7rem', fontWeight: 800, color: colour }}>{value}</div>
      <div style={{ fontSize: '0.74rem', color: '#374151', lineHeight: 1.4 }}>{label}</div>
    </div>
  );
}

/** Numbered finding card. */
function Finding({ n, title, children }) {
  return (
    <div style={{
      background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.18)',
      borderRadius: 10, padding: '12px 16px', marginBottom: 12,
    }}>
      <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '0.92rem' }}>
        <span style={{
          display: 'inline-flex', width: 22, height: 22, borderRadius: '50%',
          background: 'var(--brand-navy, #1e3a8a)', color: '#fff', alignItems: 'center',
          justifyContent: 'center', fontSize: '0.75rem', marginRight: 8,
        }}>{n}</span>
        {title}
      </p>
      <div style={{ fontSize: '0.83rem', color: '#374151', lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

/** Finding → demo feature mapping row. */
function MapRow({ finding, answer, links }) {
  const { open } = useEducationUI();
  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', marginBottom: 12,
      background: '#fff',
    }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.88rem' }}>{finding}</p>
      <div style={{ fontSize: '0.83rem', color: '#374151', lineHeight: 1.6 }}>✅ {answer}</div>
      {links && (
        <div style={{ marginTop: 8 }}>
          {links.map(([label, panelId, tabId]) => (
            <button
              key={label}
              type="button"
              onClick={() => open(panelId, tabId)}
              style={{
                background: 'none', border: '1px solid #6366f1', borderRadius: 6,
                color: '#4f46e5', padding: '3px 10px', fontSize: '0.78rem', fontWeight: 600,
                cursor: 'pointer', marginRight: 6, marginTop: 4, display: 'inline-block',
              }}
            >
              {label} ↗
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab bodies ──────────────────────────────────────────────────────────────

function FindingsTab() {
  return (
    <>
      <p>
        Gartner's Machine IAM survey looked at how organizations manage the identities of
        machines — AI agents, workloads, service accounts, pipelines, and devices. Five
        findings stand out; the <strong>How This Demo Answers</strong> tab maps each one to
        the controls implemented in this demo.
      </p>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))',
        gap: 10, margin: '14px 0 18px',
      }}>
        <Stat value="94%" label="report machine-identity growth" />
        <Stat value="52%" label="say AI/ML adoption drives it" colour="#7c3aed" />
        <Stat value="71%" label="already manage AI agent identities" colour="#0369a1" />
        <Stat value="42%" label="have no formal machine IAM strategy" colour="#b45309" />
        <Stat value="58%" label="had AI-linked identity compromises" colour="#9f1239" />
      </div>

      <Finding n={1} title="Machine identities are exploding">
        94% of organizations report growth, driven by AI/ML adoption (52%), cloud
        deployments (43%) and CI/CD automation (38%). 71% are already actively managing
        AI agent identities.
      </Finding>
      <Finding n={2} title="Machine IAM is poorly implemented">
        Fragmented ownership of machine lifecycle management is the top challenge (53%),
        with lack of knowledge and visibility close behind. 42% have no formal machine IAM
        strategy, and 47% still govern machines with the same broad IAM policies they use
        for humans (vs 53% with machine-tailored policies).
      </Finding>
      <Finding n={3} title="Compromises are common and costly">
        58% experienced incidents involving compromised AI-linked machine identities — and
        an equal share for non-AI machine identities — causing business disruption (42%),
        financial loss (36%) and reputational damage (32%).
      </Finding>
      <Finding n={4} title="Formalize, assign accountability, ensure visibility">
        Gartner recommends a comprehensive machine identity + agentic AI program, clear
        accountability across the distributed environment, and continuous discovery,
        inventory, registration and governance of machine identities and AI agents.
      </Finding>
      <Finding n={5} title="Adopt machine-tailored tooling">
        Consider workload identity management, API security, and authorization tools
        tailored to the needs of machine identities — not human IAM reused for machines.
      </Finding>

      <p style={{ fontSize: '0.78rem', color: '#6b7280', borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
        {ATTRIBUTION}
      </p>
    </>
  );
}

function AnswersTab() {
  return (
    <>
      <p>
        This demo is, in effect, Gartner recommendations 4 and 5 implemented for AI
        agents: registration, tailored authorization, delegation, and kill-switch
        governance — demonstrated live.
      </p>
      <MapRow
        finding="Finding 1–2 · Register agents with first-class identities"
        answer={
          <>Every agent gets a dedicated <code>AI_AGENT</code> identity in PingOne — no
          borrowed human credentials. The Agent Builder page makes identity registration
          the mandatory first step of creating an agent, with per-agent resource servers
          and ownership-guarded scope grants.</>
        }
        links={[["Agent Gateway", EDU.AGENT_GATEWAY, "overview"]]}
      />
      <MapRow
        finding="Finding 2 · Machine-tailored IAM, not reused human policies"
        answer={
          <>RFC 8693 token exchange issues each agent short-lived, delegated tokens with
          narrowed scope and audience and an <code>act</code> chain back to the human
          principal — the &quot;tailored policies&quot; side of Gartner's Figure 3.</>
        }
        links={[["Token Exchange (RFC 8693)", EDU.TOKEN_EXCHANGE, "why"]]}
      />
      <MapRow
        finding="Finding 3 · Prevent AI-linked identity compromise"
        answer={
          <>The Agent Gateway enforces RFC 7662 introspection plus a PingOne Authorize
          decision (PERMIT / DENY / HITL) before every tool call, and Intent Token binding
          denies calls whose action doesn't match the agent's stated intent. The Security
          Showcase demonstrates six live attacks — prompt injection, indirect injection,
          wrong audience, scope escalation, confused deputy, HITL replay — each stopped by
          a named control.</>
        }
        links={[
          ["Intent Auth Standards", EDU.INTENT_AUTH_STANDARDS, "rfc-foundations"],
          ["PingOne Authorize", EDU.PINGONE_AUTHORIZE, "what"],
        ]}
      />
      <MapRow
        finding="Finding 4 · Accountability and governance"
        answer={
          <>Human-in-the-loop consent puts a human decision on high-risk actions. The AI
          Control Plane gives one kill switch that revokes an agent's PingOne identity
          everywhere at once, with an audit trail and exportable compliance report.</>
        }
        links={[["Human-in-the-loop", EDU.HUMAN_IN_LOOP, "what"]]}
      />
      <MapRow
        finding="Finding 5 · Machine-tailored tooling"
        answer={
          <>Workload identity (agent OAuth clients), API/MCP security (gateway-fronted
          tool calls), and authorization tailored to machines (per-tool scopes, intent
          binding, policy decisions) are the demo's core building blocks.</>
        }
        links={[["Token Chain", EDU.TOKEN_CHAIN, "overview"]]}
      />
    </>
  );
}

function GapsTab() {
  return (
    <>
      <p>
        Honest scoping — the survey covers the whole machine-identity estate; this demo
        deliberately covers the agentic-AI slice of it.
      </p>
      <ul style={{ paddingLeft: 20, lineHeight: 1.8, fontSize: '0.86rem', color: '#374151' }}>
        <li>
          <strong>No continuous discovery/inventory.</strong> The demo governs agents that
          enroll through it; it is not a discovery tool for shadow identities, secrets
          sprawl, or unmanaged workloads (Gartner's recommendation 3 needs adjacent
          tooling).
        </li>
        <li>
          <strong>No device / certificate / CI-CD identity lifecycle.</strong> Devices are
          88% of what organizations manage today; certificates and pipeline identities are
          out of this demo's scope.
        </li>
        <li>
          <strong>Organizational findings are process problems.</strong> Fragmented
          ownership (the #1 challenge) and missing strategy can't be fixed by software —
          but this demo is a strong artifact for making the case for a formal program.
        </li>
      </ul>
      <p style={{ fontSize: '0.86rem' }}>
        <strong>Positioning line for demos:</strong> &quot;This is what Gartner's
        recommendations 4 and 5 look like implemented for AI agents.&quot;
      </p>
    </>
  );
}

function ResourcesTab() {
  return (
    <>
      <p>
        Full shareable summary of the survey (internal use, Gartner attribution applies):
      </p>
      <a
        href={GARTNER_DOC_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-block', background: '#1e3a8a', color: '#fff', borderRadius: 8,
          padding: '8px 16px', fontWeight: 700, fontSize: '0.88rem', textDecoration: 'none',
          marginBottom: 16,
        }}
      >
        📄 Open the survey summary (Google Doc) ↗
      </a>
      <h4 style={{ margin: '10px 0 6px' }}>Recommended by the authors (Gartner membership required)</h4>
      <ul style={{ paddingLeft: 20, lineHeight: 1.7, fontSize: '0.84rem', color: '#374151' }}>
        <li>Leaders' Guide to Modern Machine IAM</li>
        <li>Strategic Roadmap for Modern Machine IAM</li>
        <li>Quick Answer: What Is the Difference Between Machine IAM and Nonhuman Identity?</li>
        <li>Innovation Insight: Improve Security With Machine Identity and Access Management</li>
        <li>Cybersecurity Trend: IAM Adapts to Secure and Enable AI Agents</li>
      </ul>
      <p style={{ fontSize: '0.78rem', color: '#6b7280', borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
        {ATTRIBUTION}. Shared under Gartner's usage policy — organization-internal,
        noncommercial, with attribution; not for public posting or resale.
      </p>
    </>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

const tabs = [
  { id: 'findings', label: 'Findings', content: <FindingsTab /> },
  { id: 'answers', label: 'How This Demo Answers', content: <AnswersTab /> },
  { id: 'gaps', label: 'Gaps & Positioning', content: <GapsTab /> },
  { id: 'resources', label: 'Resources', content: <ResourcesTab /> },
];

export default function MachineIamSurveyPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Gartner Machine IAM Survey"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
