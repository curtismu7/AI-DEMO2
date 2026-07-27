// demo_api_ui/src/components/__tests__/PolicyDecisionTracePage.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PolicyDecisionTracePage from '../PolicyDecisionTracePage';

let mockLocationState = null;
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: mockLocationState }),
  useNavigate: () => mockNavigate,
}));

vi.mock('../PolicyDecisionTree', () => ({
  __esModule: true,
  default: ({ policies, result }) => (
    <div data-testid="policy-decision-tree">
      {policies.length} nodes / {result.decision}
    </div>
  ),
}));

const POLICIES = [{ id: 'ps-1', kind: 'POLICY_SET', name: 'Root', children: [] }];
const RESULT = { decision: 'PERMIT', raw: { statements: [] } };
const LAST_RUN_KEY = 'policyDecisionTrace.lastRun';
const MODAL_SEEN_KEY = 'policyDecisionTrace.historyModalSeen';

beforeEach(() => {
  mockLocationState = null;
  mockNavigate.mockClear();
  localStorage.clear();
  sessionStorage.clear();
});

test('fresh nav state renders the tree and persists it to localStorage', () => {
  mockLocationState = { policies: POLICIES, result: RESULT };
  render(<PolicyDecisionTracePage />);

  expect(screen.getByTestId('policy-decision-tree')).toHaveTextContent('1 nodes / PERMIT');
  expect(screen.queryByText(/Viewing a saved decision/)).not.toBeInTheDocument();

  const stored = JSON.parse(localStorage.getItem(LAST_RUN_KEY));
  expect(stored.policies).toEqual(POLICIES);
  expect(stored.result).toEqual(RESULT);
  expect(typeof stored.savedAt).toBe('number');
});

test('no nav state but a stored run renders history and shows the staleness modal', () => {
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ policies: POLICIES, result: RESULT, savedAt: 123 }));
  render(<PolicyDecisionTracePage />);

  expect(screen.getByTestId('policy-decision-tree')).toHaveTextContent('1 nodes / PERMIT');
  expect(screen.getByText(/Viewing a saved decision/)).toBeInTheDocument();
});

test('dismissing the modal marks it seen so it does not reopen this session', () => {
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ policies: POLICIES, result: RESULT, savedAt: 123 }));
  const { unmount } = render(<PolicyDecisionTracePage />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText(/Viewing a saved decision/)).not.toBeInTheDocument();
  expect(sessionStorage.getItem(MODAL_SEEN_KEY)).toBe('1');
  unmount();

  render(<PolicyDecisionTracePage />);
  expect(screen.queryByText(/Viewing a saved decision/)).not.toBeInTheDocument();
  expect(screen.getByTestId('policy-decision-tree')).toBeInTheDocument();
});

test('the "Go to PingOne Authorize" button navigates there and dismisses the modal', () => {
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ policies: POLICIES, result: RESULT, savedAt: 123 }));
  render(<PolicyDecisionTracePage />);
  fireEvent.click(screen.getByRole('button', { name: 'Go to PingOne Authorize' }));
  expect(mockNavigate).toHaveBeenCalledWith('/pingone-authorize?tab=guided');
  expect(screen.queryByText(/Viewing a saved decision/)).not.toBeInTheDocument();
});

test('no nav state and no stored run shows the placeholder', () => {
  render(<PolicyDecisionTracePage />);
  expect(screen.getByText('No decision trace loaded')).toBeInTheDocument();
  expect(screen.queryByTestId('policy-decision-tree')).not.toBeInTheDocument();
});

test('corrupt stored JSON falls back to the placeholder', () => {
  localStorage.setItem(LAST_RUN_KEY, '{not valid json');
  render(<PolicyDecisionTracePage />);
  expect(screen.getByText('No decision trace loaded')).toBeInTheDocument();
});

test('an oversized payload is not written to localStorage', () => {
  const hugeResult = { decision: 'PERMIT', raw: { statements: [], big: 'x'.repeat(600_000) } };
  mockLocationState = { policies: POLICIES, result: hugeResult };
  render(<PolicyDecisionTracePage />);
  expect(localStorage.getItem(LAST_RUN_KEY)).toBeNull();
});

test('a full/blocked localStorage does not crash the page', () => {
  const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  mockLocationState = { policies: POLICIES, result: RESULT };
  render(<PolicyDecisionTracePage />);
  expect(screen.getByTestId('policy-decision-tree')).toHaveTextContent('1 nodes / PERMIT');
  setItemSpy.mockRestore();
});
