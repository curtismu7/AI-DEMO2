import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import UseCaseRunContextCard from '../UseCaseRunContextCard';

describe('UseCaseRunContextCard', () => {
  it('shows the use-case source and the evidence planned for the run', () => {
    render(
      <UseCaseRunContextCard
        runContext={{
          source: 'use-cases',
          useCaseId: 'audit-trail',
          useCaseLabel: 'Agent observability and traceability',
          triggerText: 'show my balance',
          expectedOutcome: 'PERMIT',
          evidence: {
            tokenChain: ['user-token', 'token-exchange'],
            activity: ['authorize', 'mcp'],
          },
        }}
      />,
    );

    expect(screen.getByText('Launched from Use Cases')).toBeInTheDocument();
    expect(screen.getByText('Agent observability and traceability')).toBeInTheDocument();
    expect(screen.getByText('PERMIT')).toBeInTheDocument();
    expect(screen.getByText('user token')).toBeInTheDocument();
    expect(screen.getByText('authorize')).toBeInTheDocument();
  });

  it('labels a dashboard opened without a launcher scenario', () => {
    render(<UseCaseRunContextCard runContext={null} />);

    expect(screen.getByText('Direct dashboard run')).toBeInTheDocument();
    expect(screen.getByText('No use case selected')).toBeInTheDocument();
  });

  it('shows the selected Demo Track scenario', () => {
    render(
      <UseCaseRunContextCard
        runContext={{
          source: 'demo-track',
          useCaseId: 'UC1',
          useCaseLabel: 'Delegated access (consent only)',
          triggerText: 'Show my reservations',
        }}
      />,
    );

    expect(screen.getByText('Launched from Demo Track')).toBeInTheDocument();
    expect(screen.getByText('Delegated access (consent only)')).toBeInTheDocument();
  });

  it('labels a scenario selected from Demo Steps', () => {
    render(
      <UseCaseRunContextCard
        runContext={{
          source: 'demo-steps',
          useCaseId: 'progressive-trust-public-access',
          useCaseLabel: 'Act 1 — Public catalog access',
          triggerText: 'What branches are near me?',
        }}
      />,
    );

    expect(screen.getByText('Launched from Demo Steps')).toBeInTheDocument();
  });

  it('keeps the title an h2 by default (floating and docked agent have no heading around the card)', () => {
    render(<UseCaseRunContextCard runContext={null} />);
    expect(screen.getByRole('heading', { level: 2, name: 'No use case selected' })).toBeInTheDocument();
  });

  it('takes the level from headingLevel, so the dashboard can nest it under its "Banking assistant" h2', () => {
    render(<UseCaseRunContextCard runContext={null} headingLevel={3} />);
    expect(screen.getByRole('heading', { level: 3, name: 'No use case selected' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('falls back to h2 for a level it does not support', () => {
    render(<UseCaseRunContextCard runContext={null} headingLevel={1} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('is nested as an h3 only where the dashboard hosts the agent (AIAgent is its one consumer)', () => {
    const src = readFileSync(resolve(__dirname, '../AIAgent.js'), 'utf8');
    expect(src).toMatch(/<UseCaseRunContextCard\s+runContext=\{runContext\}\s+headingLevel=\{surfaceHostEl\?\.classList\?\.contains\("ud-dashboard-inline-agent-host"\) \? 3 : 2\}/);
  });
});
