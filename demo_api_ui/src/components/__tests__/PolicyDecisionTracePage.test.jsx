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

// ---- Ping UI Standard (P2 banner, P4 cards, P5 kv, P7 chips, P9 one primary per state) ----

const primaries = () => Array.from(document.querySelectorAll('button')).filter((b) => b.className.includes('--primary') || b.className.includes('pdt-modal-primary'));

test('the banner is the first element of the page, a role=note, and says nothing is evaluated here', () => {
  mockLocationState = { policies: POLICIES, result: RESULT };
  render(<PolicyDecisionTracePage />);
  const banner = screen.getByTestId('pdt-banner');
  expect(banner).toHaveAttribute('role', 'note');
  expect(banner).toHaveTextContent(/nothing is evaluated on this page/i);
  expect(banner).toHaveTextContent(/derived here/i);
  expect(document.querySelector('.pdt-page').firstElementChild).toContainElement(banner);
});

test('the decision card carries a chip with the verdict word and says which engine answered', () => {
  mockLocationState = { policies: POLICIES, result: { ...RESULT, engine: 'pingone', raw: { statements: [{ code: 'x' }], elapsedMicroseconds: 2500 } } };
  render(<PolicyDecisionTracePage />);
  const card = screen.getByTestId('pdt-decision');
  expect(card.querySelector('.pu-chip')).toHaveTextContent('Approved');
  expect(card).toHaveTextContent('PingOne Authorize');
  expect(card).toHaveTextContent('2.500 ms');
  expect(card).toHaveTextContent('Returned by the PingOne Authorize decision endpoint.');
  expect(card).not.toHaveTextContent('Saved run');
});

test('a simulated engine is not described as a PingOne decision', () => {
  mockLocationState = { policies: POLICIES, result: { ...RESULT, decision: 'DENY', engine: 'simulated' } };
  render(<PolicyDecisionTracePage />);
  const card = screen.getByTestId('pdt-decision');
  expect(card.querySelector('.pu-chip')).toHaveTextContent('Denied');
  expect(card).toHaveTextContent('Simulated rules');
  expect(card).toHaveTextContent('Returned by this app, not by a PingOne decision endpoint.');
  expect(card).toHaveTextContent('Not reported');
});

test('the Evaluated row follows the engine for a fresh trace (never PingOne for a simulated run)', () => {
  mockLocationState = { policies: POLICIES, result: { ...RESULT, engine: 'simulated' } };
  const { unmount } = render(<PolicyDecisionTracePage />);
  let card = screen.getByTestId('pdt-decision');
  expect(card).toHaveTextContent('Just now, simulated by this app');
  expect(card).not.toHaveTextContent('Just now, from PingOne Authorize');
  unmount();

  mockLocationState = { policies: POLICIES, result: { ...RESULT, engine: 'pingone' } };
  render(<PolicyDecisionTracePage />);
  card = screen.getByTestId('pdt-decision');
  expect(card).toHaveTextContent('Just now, from PingOne Authorize');
  expect(card).not.toHaveTextContent('simulated by this app');
});

test('step-up beats the engine decision, and a result with no engine says so', () => {
  mockLocationState = { policies: POLICIES, result: { decision: 'PERMIT', stepUpRequired: true, raw: {} } };
  render(<PolicyDecisionTracePage />);
  const card = screen.getByTestId('pdt-decision');
  expect(card.querySelector('.pu-chip')).toHaveTextContent('Step-up required');
  expect(card).toHaveTextContent('Not recorded');
});

test('a saved run keeps a persistent "Saved run" chip after the modal is dismissed', () => {
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ policies: POLICIES, result: RESULT, savedAt: 123 }));
  render(<PolicyDecisionTracePage />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.getByTestId('pdt-decision')).toHaveTextContent('Saved run');
});

test('exactly one primary button per state: header while viewing, modal while the saved-run modal is open', () => {
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ policies: POLICIES, result: RESULT, savedAt: 123 }));
  render(<PolicyDecisionTracePage />);
  // Modal open: the modal's button is the only primary.
  expect(primaries().map((b) => b.textContent)).toEqual(['Go to PingOne Authorize']);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  // Modal closed: the header button is the only primary.
  expect(primaries().map((b) => b.textContent)).toEqual(['Back to PingOne Authorize']);
});

test('fresh trace and empty state each have exactly one primary (the header button)', () => {
  mockLocationState = { policies: POLICIES, result: RESULT };
  const { unmount } = render(<PolicyDecisionTracePage />);
  expect(primaries().map((b) => b.textContent)).toEqual(['Back to PingOne Authorize']);
  unmount();
  mockLocationState = null;
  localStorage.clear(); // the fresh render above saved its run; the empty state needs none
  render(<PolicyDecisionTracePage />);
  expect(primaries().map((b) => b.textContent)).toEqual(['Back to PingOne Authorize']);
});

test('the header button navigates to PingOne Authorize and the empty state is a card with a chip word', () => {
  render(<PolicyDecisionTracePage />);
  fireEvent.click(screen.getByRole('button', { name: 'Back to PingOne Authorize' }));
  expect(mockNavigate).toHaveBeenCalledWith('/pingone-authorize?tab=guided');
  const empty = screen.getByTestId('pdt-empty');
  expect(empty.querySelector('.pu-chip')).toHaveTextContent('No evaluation');
  expect(screen.getByTestId('pdt-banner')).toHaveTextContent('NO EVALUATION LOADED');
});

test('the dark mode toggle stays a secondary and reports its state', () => {
  render(<PolicyDecisionTracePage />);
  const toggle = screen.getByRole('button', { name: /Dark mode|Light mode/ });
  expect(toggle).toHaveAttribute('aria-pressed');
  expect(toggle.className).toBe('pu-btn');
});

test('keyboard: Dismiss takes focus when the saved-run modal opens, and closing it moves focus to the header button', async () => {
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify({ policies: POLICIES, result: RESULT, savedAt: 123 }));
  render(<PolicyDecisionTracePage />);
  expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Back to PingOne Authorize' })).toHaveFocus());
});
