import React from 'react';
import { render, screen, act } from '@testing-library/react';
import VerifiedBanner from '../VerifiedBanner';
import * as proofCtx from '../../context/ProofOfEnforcementContext';

jest.useFakeTimers();

test('renders nothing when there is no verdict', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({ verdict: null, history: [] });
  const { container } = render(<VerifiedBanner onExpand={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

test('shows the full banner then collapses to a pill after 6s', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: { useCaseId: 'step-up-required', title: 'Step-up required', state: 'verified', matchedSteps: ['authorize-decision'], missingSteps: [] },
    history: [],
  });
  render(<VerifiedBanner onExpand={() => {}} />);
  expect(screen.getByText(/VERIFIED/)).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(6100); });
  expect(screen.queryByText(/VERIFIED/)).not.toBeInTheDocument();
  expect(screen.getByTestId('verified-pill')).toBeInTheDocument();
});

test('a mismatch verdict renders in warning styling, not the success treatment', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: { useCaseId: 'authz-denied', title: 'Authz denied', state: 'mismatch', matchedSteps: [], missingSteps: [] },
    history: [],
  });
  render(<VerifiedBanner onExpand={() => {}} />);
  expect(screen.getByTestId('verified-banner')).toHaveClass('verified-banner--mismatch');
});
