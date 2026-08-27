/**
 * finding #79: `completedCount`, `nextPrimaryId`, and each row's
 * `renderStep` used to call `isUseCaseCompleted(uc.id)` independently —
 * each call does a fresh sessionStorage.getItem + JSON.parse + Set rebuild
 * via `getCompletedUseCaseIds()`. For ~N primary steps that's 2N-3N
 * redundant parses per render.
 *
 * Proof: DemoStepsDropdown imports both `isUseCaseCompleted` (the old,
 * per-row lookup) and `getCompletedUseCaseIds` (the fix: read the Set once,
 * reuse `.has()`) from `../../utils/useCaseDemoProgress`. Both are wrapped
 * with a call counter here. Pre-fix, only `isUseCaseCompleted` is called —
 * once per row via `renderStep`, plus once more each for `completedCount`
 * and `nextPrimaryId` — so the count scales with the number of primary
 * steps. Post-fix, only `getCompletedUseCaseIds` is called, once per
 * render, regardless of row count.
 *
 * (Spying on the real `sessionStorage.getItem` directly does not work in
 * this jsdom version: its Storage object traps all property access for
 * key/value semantics, so an assigned mock method is never actually read
 * back — `vi.spyOn(sessionStorage, 'getItem')` silently no-ops. Module-level
 * mocking of the two named exports is the reliable seam here.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DemoStepsDropdown from '../DemoStepsDropdown';
import apiClient from '../../services/apiClient';
import { DEMO_USE_CASE_IDS } from '../../config/demoUseCaseSteps';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const isUseCaseCompletedCalls = vi.fn();
const getCompletedUseCaseIdsCalls = vi.fn();
vi.mock('../../utils/useCaseDemoProgress', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isUseCaseCompleted: (...args) => {
      isUseCaseCompletedCalls();
      return actual.isUseCaseCompleted(...args);
    },
    getCompletedUseCaseIds: (...args) => {
      getCompletedUseCaseIdsCalls();
      return actual.getCompletedUseCaseIds(...args);
    },
  };
});

const CATALOG = DEMO_USE_CASE_IDS.map((id) => ({
  id,
  useCaseId: `slug-${id}`,
  title: `Title for ${id}`,
  trigger: { type: 'chip', text: `prompt for ${id}` },
}));

describe('DemoStepsDropdown — completed-id lookup call count (finding #79)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockResolvedValue({ data: { useCases: CATALOG } });
  });

  it('reads the completed-id Set a small bounded number of times, not once per row', async () => {
    render(
      <DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    // Sanity: the catalog is well over 10 rows, so a per-row lookup (plus
    // completedCount + nextPrimaryId) would be 12+ calls for the mount
    // render alone.
    expect(DEMO_USE_CASE_IDS.length).toBeGreaterThan(10);

    const totalLookups =
      isUseCaseCompletedCalls.mock.calls.length +
      getCompletedUseCaseIdsCalls.mock.calls.length;

    // Bounded and flat regardless of row count — one lookup per render
    // (mount, then the loadSteps `.then`/`.finally` state updates), never
    // one lookup per row.
    expect(totalLookups).toBeLessThanOrEqual(5);
    expect(totalLookups).toBeLessThan(DEMO_USE_CASE_IDS.length);
  });
});
