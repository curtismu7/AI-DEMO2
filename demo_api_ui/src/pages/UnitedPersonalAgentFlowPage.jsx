// UnitedPersonalAgentFlowPage.jsx — sequence diagram of a United MileagePlus member's own AI agent meeting United's MCP door
// (docs/personal-agent/On-Users-Personal-Agent-Design.md, hops 1-9). Data: config/unitedPersonalAgentFlow.js. Drawn by
// SequenceFlowDiagram (React Flow): Simulate walks the messages, with step speed, Reset and the movie reel.
import React from 'react';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import { UNITED_FLOW_PAYLOADS, UNITED_FLOW_DETAILS, UNITED_FLOW_SOURCE } from '../config/unitedPersonalAgentFlow';

export default function UnitedPersonalAgentFlowPage() {
  return (
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: '0 16px 32px' }}>
      <PageHeader
        eyebrow="Diagrams · Personal agent"
        title="A member's agent meets United's MCP door"
        summary="The company lists its connector in the AI assistant's catalog once and members add it for free. Then a MileagePlus member's own AI agent reaches United: discover, register, consent, per-call token exchange, gateway, policy decision, human approval, audit. The agent is never trusted; every hop past discovery is inside United's boundary."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />
      <SequenceFlowDiagram
        source={UNITED_FLOW_SOURCE}
        details={UNITED_FLOW_DETAILS}
        payloads={UNITED_FLOW_PAYLOADS}
        label="United personal-agent MCP door sequence"
      />
    </main>
  );
}
