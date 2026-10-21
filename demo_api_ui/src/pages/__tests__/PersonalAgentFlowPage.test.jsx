import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PersonalAgentFlowPage from '../PersonalAgentFlowPage';

describe('PersonalAgentFlowPage', () => {
  it('shows the personal-agent request flow on its own page with a link back to Diagrams', () => {
    render(<MemoryRouter><PersonalAgentFlowPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Personal Agent request flow' })).toBeTruthy();
    expect(screen.getByTestId('pa-flow-page-diagram')).toBeTruthy();
    expect(screen.getByRole('link', { name: /All diagrams/ }).getAttribute('href')).toBe('/diagrams');
  });
});
