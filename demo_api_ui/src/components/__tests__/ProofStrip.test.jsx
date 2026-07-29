import React from 'react';
import { render, screen } from '@testing-library/react';
import ProofStrip from '../ProofStrip';
import * as proofCtx from '../../context/ProofOfEnforcementContext';

test('renders nothing when there is no verdict', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({ verdict: null, history: [] });
  const { container } = render(<ProofStrip />);
  expect(container).toBeEmptyDOMElement();
});

test('renders the checked-off chain for a verified verdict', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: {
      useCaseId: 'step-up-required', title: 'Step-up required', state: 'verified',
      matchedSteps: ['user-token', 'authorize-decision', 'tool-dispatched'], missingSteps: [],
    },
    history: [],
  });
  render(<ProofStrip />);
  expect(screen.getByText(/Step-up required/)).toBeInTheDocument();
  expect(screen.getByText(/Verified/)).toBeInTheDocument();
});

test('a runId prop renders that run\'s verdict, not the latest one', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: { useCaseId: 'newest-run', title: 'Newest run', state: 'incomplete', matchedSteps: [], missingSteps: ['authorize-decision'] },
    verdictFor: (runId) => (runId === 7
      ? { useCaseId: 'older-run', title: 'Older run', state: 'verified', matchedSteps: ['authorize-decision'], missingSteps: [] }
      : null),
  });
  render(<ProofStrip runId={7} />);
  expect(screen.getByText(/Older run/)).toBeInTheDocument();
  expect(screen.getByTestId('proof-strip')).toHaveClass('proof-strip--verified');
});

test('renders a mismatch state distinctly', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: { useCaseId: 'authz-denied', title: 'Authz denied', state: 'mismatch', matchedSteps: ['authorize-decision'], missingSteps: [] },
    history: [],
  });
  render(<ProofStrip />);
  expect(screen.getByTestId('proof-strip')).toHaveClass('proof-strip--mismatch');
});
