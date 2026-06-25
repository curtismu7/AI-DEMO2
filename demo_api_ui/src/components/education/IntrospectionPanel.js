// banking_api_ui/src/components/education/IntrospectionPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { IntrospectionContent } from './educationContent';
import { EduImplIntro, SNIP_INTROSPECT } from './educationImplementationSnippets';

export default function IntrospectionPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'why',
      label: 'What & Why',
      content: <IntrospectionContent />,
    },
    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>BFF → PingOne introspection</h3>
          <EduImplIntro repoPath="banking_api_server/middleware/tokenIntrospection.js">
            Used on the MCP proxy path when <code>PINGONE_INTROSPECTION_ENDPOINT</code> is set; inactive tokens get 401.
          </EduImplIntro>
          <pre className="edu-code">{SNIP_INTROSPECT}</pre>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Token introspection (RFC 7662)"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
