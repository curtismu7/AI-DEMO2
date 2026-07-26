import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

vi.mock('../UseCaseExplainModal.css', () => ({}), { virtual: true });
vi.mock('../../hooks/useExplainData', () => ({
  useExplainData: (uc) => ({
    rules: null,
    topology: uc?.primaryTool === 'get_portfolio_summary'
      ? { found: true, requiredScopes: ['invest:read'], a2aDelegated: true }
      : null,
    loading: false,
  }),
}));

import UseCaseExplainModal from '../UseCaseExplainModal';

const a2aEvents = [
  { id: 'a2a-agent1-actor', claims: { client_id: 'agent1-cid' } },
  { id: 'a2a-exchange1', claims: { aud: 'a2a-intermediate-investment.ping.demo', act: { sub: 'agent1-cid' } } },
  { id: 'a2a-agent2-actor', specialist: 'Investment Advisor', claims: { client_id: 'agent2-cid' } },
  { id: 'a2a-exchange2', specialist: 'Investment Advisor', scope: 'invest:read', actChainDepth: 2, a2aTool: 'get_portfolio_summary',
    claims: { aud: ['mcpgateway-a2a.ping.demo'], scope: 'invest:read', act: { sub: 'agent2-cid', act: { sub: 'agent1-cid' } } } },
];

const uc2 = {
  id: 'UC2',
  title: 'A2A delegation',
  whatLong: 'x',
  pingOneSolution: 'y',
  businessValue: 'bv',
  productRoles: {
    idp: 'Mints nested-act',
    gw: 'Routes A2A gateway',
    authz: 'Evaluates act chain',
  },
  primaryTool: 'get_portfolio_summary',
};
const uc7 = { id: 'UC7', title: 'Step-up required', whatLong: 'x', pingOneSolution: 'y' };

describe('UseCaseExplainModal A2A section', () => {
  it('renders the A2A section with live values for an A2A use case', () => {
    render(<UseCaseExplainModal uc={uc2} open a2aTokenEvents={a2aEvents} onClose={() => {}} />);
    expect(screen.getByText(/Agent-to-Agent delegation/i)).toBeInTheDocument();
    expect(screen.getByText(/Investment Advisor/)).toBeInTheDocument();
    expect(screen.getByText(/mcpgateway-a2a\.ping\.demo/)).toBeInTheDocument();
    expect(screen.getAllByText(/invest:read/).length).toBeGreaterThan(0);
  });

  it('shows Ping product roles for A2A', () => {
    render(<UseCaseExplainModal uc={uc2} open a2aTokenEvents={a2aEvents} onClose={() => {}} />);
    expect(screen.getByText(/Mints nested-act/)).toBeInTheDocument();
    expect(screen.getByText(/Routes A2A gateway/)).toBeInTheDocument();
    expect(screen.getByText(/Evaluates act chain/)).toBeInTheDocument();
  });

  it('shows gateway topology for the specialist tool and A2A authz fallback', () => {
    render(<UseCaseExplainModal uc={uc2} open a2aTokenEvents={a2aEvents} onClose={() => {}} />);
    expect(screen.getAllByText('get_portfolio_summary', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText(/a2aDelegated=/)).toBeInTheDocument();
    expect(screen.getByText(/A2A delegation required/i)).toBeInTheDocument();
  });

  it('has a Done button that closes the modal', async () => {
    const onClose = vi.fn();
    render(<UseCaseExplainModal uc={uc2} open a2aTokenEvents={a2aEvents} onClose={onClose} />);
    const done = screen.getByRole('button', { name: /^Done$/i });
    done.click();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the empty-state live note when no A2A events are supplied', () => {
    render(<UseCaseExplainModal uc={uc2} open a2aTokenEvents={[]} onClose={() => {}} />);
    expect(screen.getByText(/Agent-to-Agent delegation/i)).toBeInTheDocument();
    expect(screen.getByText(/Run this step to see the live delegation values/i)).toBeInTheDocument();
  });

  it('does not render the A2A section for a non-A2A use case', () => {
    render(<UseCaseExplainModal uc={uc7} open a2aTokenEvents={[]} onClose={() => {}} />);
    expect(screen.queryByText(/Agent-to-Agent delegation/i)).not.toBeInTheDocument();
  });
});
