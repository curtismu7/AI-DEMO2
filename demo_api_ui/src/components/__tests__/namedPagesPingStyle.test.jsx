import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import CimdPrivilegePage from '../cimdPrivilege/CimdPrivilegePage';
import PersonalAgentReviewPage from '../personalAgent/PersonalAgentReviewPage';
import Phase266ArchitecturePage from '../Phase266ArchitecturePage';
import EmbeddedFlowDiagram from '../EmbeddedFlowDiagram';
import OrchestrationSdkExplainerPage from '../../pages/OrchestrationSdkExplainerPage';
import * as studio from '../../config/personalAgentStudioDiagram';
import * as dot from '../../config/dotWorkbenchDiagram';

afterEach(cleanup);
const wrap = (el) => <MemoryRouter>{el}</MemoryRouter>;

describe('Ping-style diagrams on the named pages', () => {
  it('CIMD in Privilege: both figures are routed pingStyle diagrams with the arrow key and a Ping-palette legend', () => {
    const { container } = render(wrap(<CimdPrivilegePage />));
    expect(container.querySelectorAll('.sfd--ping')).toHaveLength(2);
    expect(screen.getAllByLabelText('Arrow key')).toHaveLength(2);
    container.querySelectorAll('.pa-legend .pa-sw').forEach((sw) => expect(sw.getAttribute('style')).toMatch(/border-top-color/));
  });

  it('Personal Agent review: pingStyle with its own Simulate bar, no legend class that contradicts the arrow key', () => {
    const { container } = render(wrap(<PersonalAgentReviewPage />));
    expect(container.querySelector('.sfd--ping')).toBeTruthy();
    expect(screen.getByLabelText('Arrow key')).toBeTruthy();
    expect(screen.getByTestId('pa-review-diagram-steps')).toBeTruthy();
    expect(container.querySelector('.pa-sw--risk')).toBeNull();
  });

  it('Phase 266: pingStyle keeps the path filter and the movable boxes', () => {
    const { container } = render(wrap(<Phase266ArchitecturePage />));
    expect(container.querySelector('.sfd--ping')).toBeTruthy();
    expect(screen.getByLabelText('Arrow key')).toBeTruthy();
    expect(screen.getByText('Path B — Dual Token')).toBeTruthy();
    expect(container.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0);
  });

  it('DaVinci SDK explainer: the lifecycle is a pingStyle diagram with Simulate, Reset and the step time', () => {
    render(wrap(<OrchestrationSdkExplainerPage />));
    const fig = screen.getByRole('group', { name: 'DaVinci SDK client lifecycle' });
    expect(fig.className).toContain('sfd--ping');
    expect(screen.getByTestId('osx-lifecycle-diagram-steps')).toBeTruthy();
  });

  it.each([
    ['Personal Agent Studio', { GROUPS: studio.PERSONAL_AGENT_GROUPS, NODES: studio.PERSONAL_AGENT_NODES, EDGES: studio.PERSONAL_AGENT_EDGES, STEPS: studio.PERSONAL_AGENT_STEPS }],
    ['Dot workbench', { GROUPS: dot.DOT_WORKBENCH_GROUPS, NODES: dot.DOT_WORKBENCH_NODES, EDGES: dot.DOT_WORKBENCH_EDGES, STEPS: dot.DOT_WORKBENCH_STEPS }],
  ])('%s config renders as a pingStyle embedded diagram', (title, config) => {
    const { container } = render(<EmbeddedFlowDiagram testId="x" title={title} lede="l" config={config} pingStyle />);
    expect(container.querySelector('.sfd--ping')).toBeTruthy();
    expect(container.querySelector('.efd--ping')).toBeTruthy();
    expect(screen.getByLabelText('Arrow key')).toBeTruthy();
  });
});
