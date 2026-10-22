// UhgChatgptMcpFlowPage.jsx — sequence diagram of the proposed ChatGPT -> UHG Digital Front Door MCP authorization
// flow (HSID authenticates, PingFederate authorizes). Data: config/uhgChatgptMcpFlow.js. Drawn by
// SequenceFlowDiagram (React Flow): Simulate walks the 16 messages, with step speed, Reset and the movie reel.
import React from 'react';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import { UHG_MCP_FLOW_PAYLOADS, UHG_MCP_FLOW_DETAILS, UHG_MCP_FLOW_SOURCE } from '../config/uhgChatgptMcpFlow';

export default function UhgChatgptMcpFlowPage() {
  return (
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: '0 16px 32px' }}>
      <PageHeader
        eyebrow="Diagrams · Personal agent"
        title="ChatGPT to the UHG Digital Front Door"
        summary="UHG lists its connector in the AI assistant's catalog once and members add it for free. Then end-to-end MCP authorization: HSID authenticates, PingFederate authorizes. Authorization code + PKCE (S256) at the edge, an RFC 8693 on-behalf-of exchange downstream. Proposed architecture, for review."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />
      <SequenceFlowDiagram
        source={UHG_MCP_FLOW_SOURCE}
        details={UHG_MCP_FLOW_DETAILS}
        payloads={UHG_MCP_FLOW_PAYLOADS}
        label="ChatGPT to the UHG Digital Front Door MCP authorization sequence"
      />
    </main>
  );
}
