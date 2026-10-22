// PersonalAgentFlowPage.jsx — the /personal-agent request-flow diagram on its own page, for the Diagrams section.
// Same data as the "Expand for Diagram" panel on the Personal Agent Studio (config/personalAgentStudioDiagram.js),
// so the two stay one diagram.
import React from 'react';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import { PERSONAL_AGENT_SEQUENCE_DETAILS, PERSONAL_AGENT_SEQUENCE_PAYLOADS, PERSONAL_AGENT_SEQUENCE_SOURCE } from '../config/personalAgentSequenceFlow';

export default function PersonalAgentFlowPage() {
  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px 32px' }}>
      <PageHeader
        eyebrow="Diagrams"
        title="Personal Agent request flow"
        summary="How one request from the Personal Agent Studio is governed: sign-in, token exchange, PingOne Authorize and the MCP tool, with the step-up and human-approval detour."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />
      <div data-testid="pa-flow-page-diagram">
        <SequenceFlowDiagram
          source={PERSONAL_AGENT_SEQUENCE_SOURCE}
          details={PERSONAL_AGENT_SEQUENCE_DETAILS}
          payloads={PERSONAL_AGENT_SEQUENCE_PAYLOADS}
          label="How ChatGPT accesses member benefits: CIMD discovery, IdP consent, P1AZ authorization and permitted MCP access"
        />
      </div>
    </main>
  );
}
