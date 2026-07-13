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

test('a mismatch verdict collapses to a pill with the pill mismatch modifier class', () => {
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({
    verdict: { useCaseId: 'authz-denied', title: 'Authz denied', state: 'mismatch', matchedSteps: [], missingSteps: [] },
    history: [],
  });
  render(<VerifiedBanner onExpand={() => {}} />);
  act(() => { jest.advanceTimersByTime(6100); });
  expect(screen.getByTestId('verified-pill')).toHaveClass('verified-pill--mismatch');
  expect(screen.getByTestId('verified-pill')).not.toHaveClass('verified-banner--mismatch');
});

test('does not silently cancel the collapse timer when recompute() emits a fresh-identity, same-content verdict object', () => {
  const verdictA = { useCaseId: 'step-up-required', title: 'Step-up required', state: 'verified', matchedSteps: ['authorize-decision'], missingSteps: [] };
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({ verdict: verdictA, history: [] });
  const { rerender } = render(<VerifiedBanner onExpand={() => {}} />);
  expect(screen.getByText(/VERIFIED/)).toBeInTheDocument();

  // Advance partway — well before the 6s auto-collapse.
  act(() => { jest.advanceTimersByTime(2000); });

  // Simulate ProofOfEnforcementContext's recompute(): a brand-new object
  // literal with identical useCaseId/state/matchedSteps content.
  const verdictB = { useCaseId: 'step-up-required', title: 'Step-up required', state: 'verified', matchedSteps: ['authorize-decision'], missingSteps: [] };
  jest.spyOn(proofCtx, 'useProofOfEnforcement').mockReturnValue({ verdict: verdictB, history: [] });
  rerender(<VerifiedBanner onExpand={() => {}} />);

  // Advance past the original 6s mark (2s + 4100ms = 6100ms total elapsed).
  act(() => { jest.advanceTimersByTime(4100); });

  expect(screen.queryByText(/VERIFIED/)).not.toBeInTheDocument();
  expect(screen.getByTestId('verified-pill')).toBeInTheDocument();
});
