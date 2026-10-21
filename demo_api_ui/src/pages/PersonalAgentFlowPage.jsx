// PersonalAgentFlowPage.jsx — the /personal-agent request-flow diagram on its own page, for the Diagrams section.
// Same data as the "Expand for Diagram" panel on the Personal Agent Studio (config/personalAgentStudioDiagram.js),
// so the two stay one diagram.
import React from 'react';
import PageHeader from '../components/common/PageHeader';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import { PERSONAL_AGENT_EDGES, PERSONAL_AGENT_GROUPS, PERSONAL_AGENT_NODES, PERSONAL_AGENT_STEPS } from '../config/personalAgentStudioDiagram';

export default function PersonalAgentFlowPage() {
  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px 32px' }}>
      <PageHeader
        eyebrow="Diagrams"
        title="Personal Agent request flow"
        summary="How one request from the Personal Agent Studio is governed: MFA, gateway token validation and PingOne Authorize, with the step-up and human-approval detours."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />
      <EmbeddedFlowDiagram
        testId="pa-flow-page-diagram"
        pingStyle
        title="How a personal-agent request is governed"
        ariaLabel="Personal agent request flow diagram"
        diagramLabel="Agent client to BFF, gateway and PingOne Authorize, with MFA and approval detours"
        lede="Every skin posts to /api/agent/invoke. The three gates match the security rail; MFA and human approval are the two ways a request is held and retried."
        config={{ GROUPS: PERSONAL_AGENT_GROUPS, NODES: PERSONAL_AGENT_NODES, EDGES: PERSONAL_AGENT_EDGES, STEPS: PERSONAL_AGENT_STEPS }}
      />
    </main>
  );
}
