import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock CSS imports
vi.mock('../components/UseCaseExplainModal.css', () => ({}), { virtual: true });

// Mock apiClient
vi.mock('../services/apiClient', () => ({
  default: {
    get: vi.fn((url) => {
      if (url && url.includes('mock-authz-rules')) {
        return Promise.resolve({
          data: {
            rules: [
              { id: 'scope-enforcement', name: 'Scope Enforcement', description: 'Required scopes must be present', config: {} },
            ],
          },
        });
      }
      if (url && url.includes('tool-topology')) {
        return Promise.resolve({
          data: {
            found: true,
            tool: 'create_transfer',
            requiredScopes: ['write', 'transfer'],
            challengeType: 'consent',
            requiresAgentMediation: true,
          },
        });
      }
      return Promise.resolve({ data: null });
    }),
  },
}));

import UseCaseExplainModal from '../components/UseCaseExplainModal';

const UC7 = {
  id: 'UC7',
  useCaseId: 'step-up-required',
  track: 'controls',
  title: 'Step-up required',
  pingOneSolution: 'PingOne Authorize returns a step-up obligation → MFA before PERMIT.',
  buyerStory: "A high-value agent action should not go through on the agent's say-so alone.",
  whatLong: 'An AI agent attempts a high-value transfer. Authorize returns a step-up obligation.',
  businessValue: 'One platform turns agent actions into a governed control point.',
  productRoles: {
    idp:   'Authenticates the user and mints the delegated agent token.',
    gw:    'Receives the step-up obligation from Authorize; holds the call until the MFA receipt is presented.',
    authz: 'Returns the STEP_UP obligation for the mid-range amount; re-evaluates to PERMIT after MFA.',
    mfa:   'Delivers the step-up challenge.',
  },
  primaryTool: 'create_transfer',
  evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: [] },
};

describe('UseCaseExplainModal', () => {
  it('renders all 6 section headings when open', () => {
    render(<UseCaseExplainModal uc={UC7} open={true} onClose={() => {}} />);
    expect(screen.getByText(/What this is/i)).toBeInTheDocument();
    expect(screen.getByText(/How we stop it/i)).toBeInTheDocument();
    expect(screen.getByText(/Ping products and how they are used/i)).toBeInTheDocument();
    expect(screen.getByText(/Business value/i)).toBeInTheDocument();
    expect(screen.getByText(/rules in play/i)).toBeInTheDocument();
    expect(screen.getByText(/routes and checks/i)).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    const { container } = render(<UseCaseExplainModal uc={UC7} open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<UseCaseExplainModal uc={UC7} open={true} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders productRoles for each product this UC exercises', () => {
    render(<UseCaseExplainModal uc={UC7} open={true} onClose={() => {}} />);
    // All 4 product labels should appear (from PING_PRODUCTS)
    expect(screen.getAllByText('PingOne').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PingGateway').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PingOne Authorize').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PingOne MFA').length).toBeGreaterThan(0);
  });

  it('shows live authorize rules after fetch', async () => {
    render(<UseCaseExplainModal uc={UC7} open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Scope Enforcement')).toBeInTheDocument();
    });
  });

  it('shows live gateway topology after fetch', async () => {
    render(<UseCaseExplainModal uc={UC7} open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/create_transfer/)).toBeInTheDocument();
    });
  });

  it('shows neutral empty state when primaryTool is null', async () => {
    const UC2 = { ...UC7, primaryTool: null, id: 'UC2', title: 'A2A delegation' };
    render(<UseCaseExplainModal uc={UC2} open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/No gateway route data for this tool/i)).toBeInTheDocument();
    });
  });
});
