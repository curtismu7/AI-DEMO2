// demo_api_ui/src/components/education/__tests__/TokenChainPanel.test.js
import React from 'react';
import { render, screen } from '@testing-library/react';
import TokenChainPanel from '../TokenChainPanel';
import * as proofCtx from '../../../context/ProofOfEnforcementContext';

vi.mock('../../../hooks/useAgentCCTokenPrefetch', () => ({ useAgentCCTokenPrefetch: () => {} }));

test('shows a use-case checklist card when a verdict is active', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: {
      useCaseId: 'step-up-required', title: 'Step-up required', state: 'verified',
      matchedSteps: ['user-token', 'authorize-decision', 'tool-dispatched'], missingSteps: [],
    },
    history: [],
  });
  render(<TokenChainPanel />);
  expect(screen.getByText(/Step-up required/)).toBeInTheDocument();
  expect(screen.getByText(/3 \/ 3 steps matched/)).toBeInTheDocument();
});

test('renders nothing extra when there is no active verdict', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({ verdict: null, history: [] });
  render(<TokenChainPanel />);
  expect(screen.queryByText(/steps matched/)).not.toBeInTheDocument();
});
