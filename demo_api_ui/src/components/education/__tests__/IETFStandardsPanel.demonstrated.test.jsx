// Demonstrated-by links on the IETF Standards panel (coverage plan row
// "IETF Standards: Agentic" — same demonstrated-by treatment as the RFC index).
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import IETFStandardsPanel from '../IETFStandardsPanel';
import { EducationUIProvider } from '../../../context/EducationUIContext';

const renderTab = (tabId) => render(
  <EducationUIProvider>
    <IETFStandardsPanel isOpen onClose={() => {}} initialTabId={tabId} />
  </EducationUIProvider>,
);

describe('IETFStandardsPanel — demonstrated-by links', () => {
  it('links RFC7523bis to the live client-auth lab', () => {
    const { baseElement } = renderTab('rfc7523bis');
    const links = [...baseElement.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/learning-lab/jwt-client-auth');
  });

  it('links JAG-IR to the live CIBA/HITL use case', () => {
    const { baseElement } = renderTab('jag-ir');
    const links = [...baseElement.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/use-cases/live');
  });

  it('links ID-JAG to the enterprise MCP walkthrough', () => {
    const { baseElement } = renderTab('identity-chaining');
    const links = [...baseElement.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/demo/enterprise-mcp');
  });

  it('keeps not-implemented standards (WIMSE, PQ/T JOSE) without a fake demo link', () => {
    const wimse = renderTab('wimse').baseElement.textContent;
    const pq = renderTab('pq-jose').baseElement.textContent;
    expect(wimse).not.toContain('See it in the demo');
    expect(pq).not.toContain('See it in the demo');
  });
});
