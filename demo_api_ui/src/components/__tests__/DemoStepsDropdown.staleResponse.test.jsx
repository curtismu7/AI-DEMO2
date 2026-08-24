// demo_api_ui/src/components/__tests__/DemoStepsDropdown.staleResponse.test.jsx
// finding #77: loadSteps had no request sequencing, so switching vertical
// while the dropdown is open could let a slower, older vertical's response
// resolve after the newer vertical's response and silently overwrite it.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DemoStepsDropdown from '../DemoStepsDropdown';
import apiClient from '../../services/apiClient';
import { DEMO_PRIMARY_USE_CASE_IDS } from '../../config/demoUseCaseSteps';

vi.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: { get: vi.fn() },
}));

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function catalogFor(id, title) {
  return [{ id, title, trigger: { type: 'chip', text: `prompt for ${id}` } }];
}

// Two distinct real ids so each vertical's catalog resolves to a
// distinguishable, single-step list via loadSteps's mapIds/find filter.
const BANKING_ID = DEMO_PRIMARY_USE_CASE_IDS[0];
const HEALTHCARE_ID = DEMO_PRIMARY_USE_CASE_IDS[1];

test('finding #77: an older vertical fetch does not overwrite a newer vertical that resolved first', async () => {
  const bankingDeferred = deferred();
  const healthcareDeferred = deferred();

  apiClient.get.mockImplementation((_url, { params } = {}) => {
    if (params?.vertical === 'banking') return bankingDeferred.promise;
    if (params?.vertical === 'healthcare') return healthcareDeferred.promise;
    return new Promise(() => {});
  });

  const { rerender } = render(
    <DemoStepsDropdown vertical="banking" open onOpenChange={() => {}} onSelect={() => {}} />,
  );
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));

  // Switch vertical while the banking fetch is still in flight — this fires
  // the second (healthcare) request before the first (banking) resolves.
  rerender(
    <DemoStepsDropdown vertical="healthcare" open onOpenChange={() => {}} onSelect={() => {}} />,
  );
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));

  // The newer (healthcare) request resolves first.
  healthcareDeferred.resolve({ data: { useCases: catalogFor(HEALTHCARE_ID, 'Healthcare step') } });
  await screen.findByTestId(`demo-step-${HEALTHCARE_ID}`);

  // The older, slower (banking) request resolves after — must NOT overwrite
  // the healthcare result that is already showing.
  bankingDeferred.resolve({ data: { useCases: catalogFor(BANKING_ID, 'Banking step') } });
  await new Promise((r) => setTimeout(r, 20));

  expect(screen.getByTestId(`demo-step-${HEALTHCARE_ID}`)).toBeInTheDocument();
  expect(screen.queryByTestId(`demo-step-${BANKING_ID}`)).not.toBeInTheDocument();
});
