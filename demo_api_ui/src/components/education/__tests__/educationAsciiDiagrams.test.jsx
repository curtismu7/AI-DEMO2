import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PingGatewayMcpPanel from '../PingGatewayMcpPanel';
import TokenChainEducationPanel from '../TokenChainEducationPanel';
import GleanPanel from '../GleanPanel';
import CimdPanel from '../CimdPanel';
import WeaviateRagPanel from '../WeaviateRagPanel';
import { expectDiagramControls, ResizeObserverStub } from '../../__tests__/diagramControlsHelpers';

window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

// Box-drawing / arrow glyphs the old <pre> ASCII diagrams were made of.
const ASCII_ART = /[┌└┐┘│─▼▲▶◀◄►]/;

// StaticFlowDiagram: nodes render inside the canvas (draggable), the step bar sits beside it.
function expectFlow(testId, nodeIds) {
  const canvas = screen.getByTestId(testId);
  nodeIds.forEach((id) => expect(within(canvas).getByTestId(`${testId}-node-${id}`)).toBeInTheDocument());
  // eslint-disable-next-line testing-library/no-node-access
  expect(canvas.querySelectorAll('.react-flow__node.draggable').length).toBe(nodeIds.length);
  const bar = screen.getByTestId(`${testId}-steps`);
  expect(within(bar).getByRole('button', { name: 'Simulate' })).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: /Reset/ })).toBeInTheDocument();
  expect(within(bar).getByRole('combobox')).toBeInTheDocument();
}

const noAscii = () => expect(document.body.textContent).not.toMatch(ASCII_ART);

describe('education panels — ASCII diagrams drawn with React Flow', () => {
  it('PingGateway overview: client → gateway → MCP server, PingOne introspection', () => {
    render(<PingGatewayMcpPanel isOpen onClose={() => {}} initialTabId="overview" />);
    expectFlow('pgw-arch-diagram', ['client', 'gw', 'mcp', 'pingone']);
    noAscii();
  });

  it('PingGateway architecture: sidecar and standalone topologies', () => {
    render(<PingGatewayMcpPanel isOpen onClose={() => {}} initialTabId="architecture" />);
    expectFlow('pgw-sidecar-diagram', ['gw', 'mcp', 'ext']);
    expectFlow('pgw-standalone-diagram', ['client', 'gw', 'mcp']);
    noAscii();
  });

  it('PingGateway MCP filters: filter chain order', () => {
    render(<PingGatewayMcpPanel isOpen onClose={() => {}} initialTabId="official-filters" />);
    expectFlow('pgw-filter-chain-diagram', ['audit', 'protect', 'validate', 'more', 'proxy']);
  });

  it('Token chain exchange paths: 1-exchange, 2-exchange, scope narrowing', () => {
    render(<TokenChainEducationPanel isOpen onClose={() => {}} initialTabId="exchange-paths" />);
    expectFlow('tc-path1-diagram', ['login', 't1', 't2', 'mcp']);
    expectFlow('tc-path2-diagram', ['login', 'agent', 't1', 't0', 't2', 'mcp']);
    expectFlow('tc-scope-diagram', ['t1', 't2']);
    noAscii();
  });

  it('Glean overview: architecture', () => {
    render(<GleanPanel isOpen onClose={() => {}} initialTabId="overview" />);
    expectFlow('glean-arch-diagram', ['glean', 'pf', 'gw', 'paz']);
    noAscii();
  });

  it('Glean CIBA flow: sequence with Simulate/Reset/speed', async () => {
    render(<GleanPanel isOpen onClose={() => {}} initialTabId="ciba" />);
    await expectDiagramControls(screen.getByRole('group', { name: 'Glean CIBA approval sequence diagram' }), { draggable: false });
    noAscii();
  });

  it('Glean Agent Gateway: security pipeline', () => {
    render(<GleanPanel isOpen onClose={() => {}} initialTabId="gateway" />);
    expectFlow('glean-pipeline-diagram', ['glean', 'validate', 'policy', 'paz', 'mcp']);
    expect(screen.getByText(/PingAuthorize unreachable = fail closed/)).toBeInTheDocument();
    noAscii();
  });

  it('CIMD flow: registration, document serving and authorization sequences', async () => {
    render(<CimdPanel isOpen onClose={() => {}} initialTabId="flow" />);
    for (const name of ['CIMD registration sequence diagram', 'CIMD document serving sequence diagram', 'CIMD authorization sequence diagram']) {
      await expectDiagramControls(screen.getByRole('group', { name }), { draggable: false });
    }
    expect(screen.getByText(/PingOne does NOT yet do the AS→CIMD-endpoint fetch natively/)).toBeInTheDocument();
    noAscii();
  });

  it('Weaviate wiring: code-search indexing and query path', () => {
    render(<WeaviateRagPanel isOpen onClose={() => {}} initialTabId="here" />);
    expectFlow('weaviate-wiring-diagram', ['page', 'svc', 'emb', 'weaviate']);
    noAscii();
  });
});
