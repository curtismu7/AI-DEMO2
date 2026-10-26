// UnitedPersonalAgentFlowPage.jsx — sequence diagram of a United MileagePlus member's own AI agent meeting United's MCP door
// (docs/personal-agent/On-Users-Personal-Agent-Design.md, hops 1-9). Data: config/unitedPersonalAgentFlow.js. Drawn by
// SequenceFlowDiagram (React Flow) in the dashboard's lane colours: Simulate walks the messages, with step speed,
// Reset and the movie reel. The checkbox overlays the issue each hop addresses and the design's known gaps.
import React, { useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import { UNITED_FLOW_PAYLOADS, UNITED_FLOW_DETAILS, UNITED_FLOW_SOURCE, UNITED_FLOW_LANES, UNITED_FLOW_ISSUES } from '../config/unitedPersonalAgentFlow';

// United's own MileagePlus AI assistant diagram from the 1 October joint review, kept on Drive (access is the owner's).
const UNITED_ORIGINAL_DIAGRAM_URL = 'https://drive.google.com/file/d/1W0fCnzQf9c_zv27w5bLSqeWRv8AE-bAz/view?usp=sharing';

export default function UnitedPersonalAgentFlowPage() {
  const [showIssues, setShowIssues] = useState(false);
  return (
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: '0 16px 32px' }}>
      <PageHeader
        eyebrow="Diagrams · Personal agent"
        title="A member's agent meets United's MCP door"
        summary="The company lists its connector in the AI assistant's catalog once and members add it for free. Then a MileagePlus member's own AI agent reaches United: discover, register, consent, per-call token exchange, gateway, policy decision, human approval, audit. The agent is never trusted; every hop past discovery is inside United's boundary."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 24px', margin: '0 0 12px' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={showIssues} onChange={(e) => setShowIssues(e.target.checked)} data-testid="united-issues-toggle" />
          Show the issue each hop addresses, and the known gaps
        </label>
        <a href={UNITED_ORIGINAL_DIAGRAM_URL} target="_blank" rel="noopener noreferrer" data-testid="united-original-diagram-link">
          United's as-built diagram (original, Sept 2026)
        </a>
      </div>
      <SequenceFlowDiagram
        source={UNITED_FLOW_SOURCE}
        details={UNITED_FLOW_DETAILS}
        payloads={UNITED_FLOW_PAYLOADS}
        lanes={UNITED_FLOW_LANES}
        issues={showIssues ? UNITED_FLOW_ISSUES : undefined}
        label="United personal-agent MCP door sequence"
      />
    </main>
  );
}
