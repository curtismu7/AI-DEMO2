// CibaApprovalSequencePage.jsx — the agent booking that policy holds for out-of-band CIBA approval, as a sequence diagram:
// 71 numbered messages across ten lifelines in three phases (search, a booking write that needs approval, replay and polling).
// Data: config/cibaApprovalSequence.js. Drawn by SequenceFlowDiagram in its "lucid" variant (the look of the reference Lucidchart
// sequence): click a message or a lifeline for the request, the response, the tokens and the standards behind it; Simulate walks
// the messages with Reset and a speed control.
import React from 'react';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import {
  CIBA_APPROVAL_SOURCE,
  CIBA_APPROVAL_DETAILS,
  CIBA_APPROVAL_PAYLOADS,
  CIBA_APPROVAL_STEP_DETAILS,
} from '../config/cibaApprovalSequence';

export default function CibaApprovalSequencePage() {
  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', padding: '0 16px 32px' }}>
      <PageHeader
        eyebrow="Diagrams · Tokens and delegation"
        title="Agent booking with CIBA approval"
        summary="An AI agent searches flights freely, but a booking is held by policy until the user approves on another device. Click any message for its request, response, tokens and the standards behind it, or press Simulate to walk all 71 messages."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />
      <SequenceFlowDiagram
        source={CIBA_APPROVAL_SOURCE}
        details={CIBA_APPROVAL_DETAILS}
        payloads={CIBA_APPROVAL_PAYLOADS}
        stepDetails={CIBA_APPROVAL_STEP_DETAILS}
        variant="lucid"
        label="Agent booking with CIBA approval: sequence diagram"
      />
    </div>
  );
}
