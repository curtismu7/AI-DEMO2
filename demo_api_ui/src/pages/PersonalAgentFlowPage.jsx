// PersonalAgentFlowPage.jsx — the /personal-agent request-flow diagram on its own page, for the Diagrams section.
// Same data as the "Expand for Diagram" panel on the Personal Agent Studio (config/personalAgentStudioDiagram.js),
// so the two stay one diagram.
import React from 'react';
import PageHeader from '../components/common/PageHeader';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import { PERSONAL_AGENT_DIAGRAM_PROPS, PERSONAL_AGENT_EDGES, PERSONAL_AGENT_GROUPS, PERSONAL_AGENT_NODES, PERSONAL_AGENT_STEPS } from '../config/personalAgentStudioDiagram';

export default function PersonalAgentFlowPage() {
  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px 32px' }}>
      <PageHeader
        eyebrow="Diagrams"
        title="Personal Agent request flow"
        summary="How one request from the Personal Agent Studio is governed: sign-in, token exchange, PingOne Authorize and the MCP tool, with the step-up and human-approval detour."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />
      <EmbeddedFlowDiagram
        {...PERSONAL_AGENT_DIAGRAM_PROPS}
        testId="pa-flow-page-diagram"
        config={{ GROUPS: PERSONAL_AGENT_GROUPS, NODES: PERSONAL_AGENT_NODES, EDGES: PERSONAL_AGENT_EDGES, STEPS: PERSONAL_AGENT_STEPS }}
      />
    </main>
  );
}
