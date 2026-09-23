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
    expect(screen.getByText('show my balance')).toBeInTheDocument();
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
    expect(screen.getByText('Demo Track → Delegated access (consent only)')).toBeInTheDocument();
  });
});
