import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { getExternalAgent } from '../config/externalAgents';
import { useCaseDiagramPath } from '../config/useCaseDiagrams';
import './AgentGatewayAuthorizationLessonPage.css';

const COVERAGE_LABELS = {
  onboard: 'Onboard (discovery, DCR, PKCE)',
  read: 'UC-MUSE1 delegated read',
  'governed-write': 'Governed write + HITL',
  'agent-privilege': 'UC-MUSE2 Agent Privilege lane',
  'step-up': 'Step-up / MFA',
  audit: 'Audit trail',
  deny: 'Deny paths',
};

// Sets the presenter-only rehearsal note apart from the customer steps.
// Theme tokens only, no literal colours.
const PRESENTER_BOX = {
  margin: '1.5rem 0',
  padding: '0.75rem 1rem',
  border: '2px dashed var(--th-border)',
  borderRadius: 'var(--radius-md)',
};

const COVERAGE_ORDER =['onboard', 'read', 'governed-write', 'agent-privilege', 'step-up', 'audit', 'deny'];

export default function ExternalAgentLessonPage() {
  const { agentId } = useParams();
  const agent = getExternalAgent(agentId);
  if (!agent) {
    return (
      <div className="lesson-page">
        <h1>Unknown agent</h1>
        <p>No external agent &ldquo;{agentId}&rdquo; is configured for this demo.</p>
        <p><Link to="/learning">Back to the learning hub</Link></p>
      </div>
    );
  }
  const isDirectory = agent.path === 'directory';
  const doorList = (
    <ul>
      <li>Standard lane: <code>{agent.doors.standard}</code></li>
      <li>
        Agent Privilege lane:{' '}
        {agent.doors.aiGateway
          ? <code>{agent.doors.aiGateway}</code>
          : 'not available for this agent (cloud reachability)'}
      </li>
    </ul>
  );
  return (
    <div className="lesson-page">
      <h1>{agent.name}</h1>
      <p className="lesson-audience">{agent.vendor} &middot; {agent.runsWhere}</p>
      {agent.verification === 'expected' && (
        <p className="lesson-audience" role="note">
          ⚠️ The steps below are the expected flow, not yet app-verified — rehearse before presenting.
          {agent.doors.standard.includes('localhost') ? '' : ' Cloud agents reach only the SE host.'}
        </p>
      )}
      <p>
        Walk the wire:{' '}
        <a href={useCaseDiagramPath('UC-MUSE1')}>standard lane (UC-MUSE1)</a>
        {' · '}
        <a href={useCaseDiagramPath('UC-MUSE2')}>Agent Privilege lane (UC-MUSE2)</a>
      </p>

      <h2>{isDirectory ? 'How the customer connects' : 'Developer path: set it up'}</h2>
      {isDirectory ? (
        <p data-testid="agent-path">
          <strong>Customer path.</strong> The customer connects only from {agent.assistant}&apos;s app
          directory. There is no address to type.
        </p>
      ) : (
        <p data-testid="agent-path">
          <strong>Developer path.</strong> {agent.name} has no app directory, so a developer adds the
          server URL by hand. Customers never do this.
        </p>
      )}
      <ol className="lesson-steps">
        {agent.setup.map((s) => (
          <li key={s.title}>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>

      {isDirectory ? (
        <aside aria-label="Presenter only" data-testid="presenter-rehearsal" style={PRESENTER_BOX}>
          <h2>Presenter only</h2>
          <p><strong>Never shown to customers.</strong> {agent.rehearsal}</p>
          {doorList}
        </aside>
      ) : (
        <>
          <h2>Doors</h2>
          {doorList}
        </>
      )}

      <h2>Use cases this agent covers</h2>
      <ul>
        {COVERAGE_ORDER.map((c) => (
          <li key={c}>
            {agent.coverage.includes(c) ? '✅' : '❌'} {COVERAGE_LABELS[c]}
          </li>
        ))}
      </ul>
      <p>Step-up: {agent.stepUp}</p>

      <h2>If something breaks</h2>
      <table>
        <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
        <tbody>
          {agent.failurePlaybook.map(([symptom, cause, fix]) => (
            <tr key={symptom}><td>{symptom}</td><td>{cause}</td><td>{fix}</td></tr>
          ))}
        </tbody>
      </table>

      <p><Link to="/learning">Back to the learning hub</Link></p>
    </div>
  );
}
