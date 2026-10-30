// PocFlowPage.jsx — sequence diagram of the customer POC pattern: one agent token exchange, Authorize deciding
// per tool call, and CIBA human approval for writes. Data: config/pocFlow.js. Drawn by SequenceFlowDiagram
// (React Flow): Simulate walks the 24 messages, with step speed, Reset and the movie reel.
import React from 'react';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import { POC_FLOW_PAYLOADS, POC_FLOW_DETAILS, POC_FLOW_SOURCE } from '../config/pocFlow';

export default function PocFlowPage() {
  return (
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: '0 16px 32px' }}>
      <PageHeader
        eyebrow="Diagrams · Tokens and delegation"
        title="POC flow"
        summary="The starting pattern for a customer POC. The user signs in once with the full scope set, the agent does one token exchange (actor + user token), and Authorize decides every tool call. A write needs approval: Authorize denies with an identifier and starts CIBA, the gateway rewrites the 403 into a JSON-RPC error, the user accepts, and the agent replays the call with the identifier. Nine coloured groups, 24 steps. Proposed pattern, for review."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />
      <SequenceFlowDiagram
        source={POC_FLOW_SOURCE}
        details={POC_FLOW_DETAILS}
        payloads={POC_FLOW_PAYLOADS}
        label="POC flow: agent token exchange and CIBA approval sequence"
      />
    </main>
  );
}
