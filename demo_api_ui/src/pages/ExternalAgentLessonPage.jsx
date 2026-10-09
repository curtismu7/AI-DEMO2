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

const COVERAGE_ORDER = ['onboard', 'read', 'governed-write', 'agent-privilege', 'step-up', 'audit', 'deny'];

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

      <h2>Set it up to demo</h2>
      <ol className="lesson-steps">
        {agent.setup.map((s) => (
          <li key={s.title}>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>

      <h2>Doors</h2>
      <ul>
        <li>Standard lane: <code>{agent.doors.standard}</code></li>
        <li>
          Agent Privilege lane:{' '}
          {agent.doors.aiGateway
            ? <code>{agent.doors.aiGateway}</code>
            : 'not available for this agent (cloud reachability)'}
        </li>
      </ul>

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
