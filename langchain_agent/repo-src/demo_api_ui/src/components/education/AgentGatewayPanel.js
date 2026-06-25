// banking_api_ui/src/components/education/AgentGatewayPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';
import { AgentGatewayContent } from './educationContent';
import { RFC9728Content } from './enhancedRFC9728Content';
import { RFC8707Content } from './RFC8707Content';
import { EduImplIntro, SNIP_AGENT_GATEWAY } from './educationImplementationSnippets';

export default function AgentGatewayPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();
  const tabs = [
    {
      id: 'overview',
      label: 'Pattern overview',
      content: (
        <>
          <AgentGatewayContent />
          <p style={{ marginTop: 16 }}>
            <strong>See also:</strong>{' '}
            <button
              type="button"
              onClick={() => open(EDU.CUA, 'what')}
              style={{ background: 'none', border: 'none', color: 'var(--brand-navy)', cursor: 'pointer', padding: 0, textDecoration: 'underline', font: 'inherit' }}
            >
              Computer Use Agent (CUA)
            </button>
          </p>
        </>
      ),
    },
    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Resource audience + tool scopes</h3>
          <EduImplIntro repoPath="demo_api_server/services/mcpToolPipeline.js">
            MCP tools map to OAuth scopes; the BFF performs a single RFC 8693 exchange per tool call then routes through demo_mcp_gateway (:3005).
          </EduImplIntro>
          <pre className="edu-code">{SNIP_AGENT_GATEWAY}</pre>
        </>
      ),
    },
    {
      id: 'rfc8707',
      label: 'RFC 8707',
      content: <RFC8707Content />,
    },
    {
      id: 'rfc9728',
      label: 'RFC 9728',
      content: <RFC9728Content />,
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Agent Gateway pattern (RFC 8707 + RFC 9728)"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(640px, 100vw)"
    />
  );
}
