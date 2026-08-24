// demo_api_ui/src/pages/__tests__/DemoTrackPage.staleResponse.test.jsx
// finding #76: load() had no request sequencing and is invoked from four
// overlapping call sites (5s poll, startRun, onStepClick, runSlot). A slower,
// older request (e.g. a poll tick issued before a run) could resolve after a
// newer one and revert freshly-proved state on the presenter's screen.
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import DemoTrackPage from '../DemoTrackPage';

vi.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function makeState(label) {
  return {
    track: {
      steps: [
        {
          stepId: 's1',
          title: `STEP-${label}`,
          capability: 'cap',
          ucIds: ['UC1'],
          act: 1,
          slots: {},
          proved: {},
          buyerStory: 'story',
        },
      ],
      gauntletSims: [],
    },
    run: { slots: {}, gauntlet: {}, activeStepId: null, startedAt: new Date().toISOString() },
  };
}

const RUNS_RESPONSE = { data: { runs: [] } };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

test('finding #76: an older poll response does not overwrite a newer one that resolved first', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  const firstDeferred = deferred(); // mount's initial load() — issued first
  const secondDeferred = deferred(); // interval poll's load() — issued second
  let stateCall = 0;

  apiClient.get.mockImplementation((url) => {
    if (url === '/api/demo-track/runs') return Promise.resolve(RUNS_RESPONSE);
    if (url === '/api/demo-track') {
      stateCall += 1;
      return stateCall === 1 ? firstDeferred.promise : secondDeferred.promise;
    }
    return new Promise(() => {});
  });

  render(<DemoTrackPage />);

  // Mount issues the first (older) load(); still pending, so the loading
  // placeholder is showing — no steps rendered yet.
  expect(screen.getByText(/Loading demo track/i)).toBeInTheDocument();

  // The 5s interval fires, issuing a second (newer) load() while the first
  // is still in flight.
  await vi.advanceTimersByTimeAsync(5000);
  expect(stateCall).toBe(2);

  // The newer request resolves first.
  secondDeferred.resolve({ data: makeState('NEW') });
  await waitFor(() => expect(screen.getByText('STEP-NEW')).toBeInTheDocument());

  // The older, slower request resolves after — must NOT overwrite the newer state.
  // act() flushes the resulting state update (if any) into the DOM before we assert.
  await act(async () => {
    firstDeferred.resolve({ data: makeState('OLD') });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByText('STEP-NEW')).toBeInTheDocument();
  expect(screen.queryByText('STEP-OLD')).not.toBeInTheDocument();
});
