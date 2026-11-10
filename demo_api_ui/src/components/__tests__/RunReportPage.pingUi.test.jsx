// Ping UI Standard conversion of /reports: banner first, cards/chips/kv, exactly one primary per state,
// aria-disabled (never `disabled`) on action buttons, results kept with the thing they belong to, and honest
// states for a signed-out visitor, a lapsed session, a failed run and a failed history read.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../utils/authUi', () => ({ navigateToCustomerOAuthLogin: vi.fn() }));

import bffAxios from '../../services/bffAxios';
import { navigateToCustomerOAuthLogin } from '../../utils/authUi';
import RunReportPage from '../RunReportPage';

const USER = { role: 'customer', vertical: 'banking' };
const RUN_A = {
  runId: 'aaaaaaaa-1111', vertical: 'banking', startedAt: '2026-11-09T20:00:00.000Z',
  prompt: 'show my account balance', toolsCalled: ['get_balance'], hasCibaStepUp: false,
};
const RUN_B = {
  runId: 'bbbbbbbb-2222', vertical: 'healthcare', startedAt: '2026-11-09T20:05:00.000Z',
  prompt: 'x'.repeat(100), toolsCalled: ['get_records'], hasCibaStepUp: true,
};

function seed({ runs = [RUN_A, RUN_B], history, invoke } = {}) {
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/reports/history') return history ? history() : Promise.resolve({ data: { runs } });
    if (url === '/api/verticals/list') return Promise.resolve({ data: [{ id: 'banking', displayName: 'Banking' }, { id: 'retail', displayName: 'Retail' }] });
    return Promise.reject(Object.assign(new Error('boom'), { response: { status: 500 } }));
  });
  bffAxios.post.mockImplementation(invoke || (() => Promise.resolve({ data: { success: true, runId: 'new-run-1', toolsCalled: ['get_balance'] } })));
}

const primaries = (container) => [...container.querySelectorAll('button')].filter((b) => b.classList.contains('pu-btn--primary'));

beforeEach(() => {
  vi.clearAllMocks();
});

test('the banner is the first element, says what is not checked, and the page has one h1', async () => {
  seed();
  const { container } = render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  expect(container.firstElementChild).toHaveClass('pu-page', 'run-report-page');
  const banner = container.querySelector('.pu-page > :first-child [role="note"]');
  expect(banner).toHaveAttribute('data-testid', 'rr-banner');
  expect(banner.textContent).toMatch(/not checked here/i);
  expect(banner.textContent).not.toMatch(/simulated|mock mode is on/i);
  expect(container.querySelectorAll('h1')).toHaveLength(1);
  expect(container.querySelector('main')).toBeNull();
});

test('signed in with runs: one primary (Run Demo Flow), the row actions are secondaries with run names', async () => {
  seed();
  const { container } = render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  expect(primaries(container).map((b) => b.textContent)).toEqual(['Run Demo Flow']);
  expect(screen.getByRole('button', { name: /MD: download the Markdown report for run aaaaaaaa/ })).toHaveClass('pu-btn');
  expect(screen.getByRole('button', { name: /Share: copy the share link for run bbbbbbbb/ })).not.toHaveClass('pu-btn--primary');
  expect(screen.getByText('CIBA').closest('.pu-chip')).toBeInTheDocument();
  expect(screen.getByTestId('rr-history-status')).toHaveTextContent('Loaded');
});

test('a long prompt is cut with an ellipsis only when it is longer than 60 characters', async () => {
  seed();
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  const table = within(screen.getByTestId('rr-table'));
  expect(table.getByText('show my account balance')).toBeInTheDocument();
  expect(table.getByText(`${'x'.repeat(60)}…`)).toBeInTheDocument();
});

test('signed out: banner says so, Sign in is the only (primary) action, nothing is requested, no silent navigation', async () => {
  const { container } = render(<RunReportPage user={null} />);
  expect(screen.getByTestId('rr-banner')).toHaveTextContent(/SIGNED OUT/);
  expect(primaries(container).map((b) => b.textContent)).toEqual(['Sign in']);
  expect(screen.getByTestId('rr-signed-out')).toHaveTextContent('Signed out');
  expect(bffAxios.get).not.toHaveBeenCalled();
  expect(bffAxios.post).not.toHaveBeenCalled();
  expect(navigateToCustomerOAuthLogin).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(navigateToCustomerOAuthLogin).toHaveBeenCalledWith('/reports');
});

test('a 401 on the history read shows Signed out (not Empty), starts no demo run and makes Sign in the one primary', async () => {
  seed({ history: () => Promise.reject(Object.assign(new Error('nope'), { response: { status: 401 } })) });
  const { container } = render(<RunReportPage user={USER} />);
  await waitFor(() => expect(screen.getByTestId('rr-history-status')).toHaveTextContent('Signed out'));
  expect(screen.queryByTestId('rr-empty')).toBeNull();
  expect(bffAxios.post).not.toHaveBeenCalled();
  expect(primaries(container).map((b) => b.textContent)).toEqual(['Sign in']);
  expect(screen.getByRole('button', { name: 'Run Demo Flow' })).not.toHaveClass('pu-btn--primary');
});

test('a failed history read says Unavailable, never "no runs", and does not auto-run', async () => {
  seed({ history: () => Promise.reject(new Error('down')) });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<RunReportPage user={USER} />);
  await waitFor(() => expect(screen.getByTestId('rr-history-status')).toHaveTextContent('Unavailable'));
  expect(screen.getByTestId('rr-history-status')).not.toHaveTextContent(/Empty/);
  expect(screen.queryByTestId('rr-empty')).toBeNull();
  expect(bffAxios.post).not.toHaveBeenCalled();
});

test('with no reports a demo run starts once on its own, and the result says it was automatic', async () => {
  let calls = 0;
  seed({
    history: () => {
      calls += 1;
      return Promise.resolve({ data: { runs: calls === 1 ? [] : [{ ...RUN_A, runId: 'new-run-1' }] } });
    },
  });
  render(<RunReportPage user={USER} />);
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).toHaveTextContent('Completed'));
  expect(bffAxios.post).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('rr-result')).toHaveTextContent('Automatically');
});

test('a successful demo run keeps its result in the run card and checks that the run is in the history', async () => {
  seed({ runs: [RUN_A] });
  let calls = 0;
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/reports/history') {
      calls += 1;
      return Promise.resolve({ data: { runs: calls === 1 ? [RUN_A] : [RUN_A, { ...RUN_A, runId: 'new-run-1' }] } });
    }
    return Promise.reject(new Error('x'));
  });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await userEvent.click(screen.getByRole('button', { name: 'Run Demo Flow' }));
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).toHaveTextContent('Completed'));
  const result = screen.getByTestId('rr-result');
  expect(result).toHaveTextContent('new-run-1');
  expect(result).toHaveTextContent(/Yes, the run is in the list/);
  expect(bffAxios.post).toHaveBeenCalledWith('/api/agent/invoke', { prompt: 'show my account balance', vertical: 'banking' });
});

test('a success the history does not show is reported as not in the list, not as recorded', async () => {
  seed({ runs: [RUN_A] });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await userEvent.click(screen.getByRole('button', { name: 'Run Demo Flow' }));
  await waitFor(() => expect(screen.getByTestId('rr-result')).toHaveTextContent(/No, the list below does not contain it/));
});

test('while a run is in flight the button is aria-disabled (not disabled), keeps its name and focus, and ignores a second click', async () => {
  let release;
  seed({ invoke: () => new Promise((resolve) => { release = () => resolve({ data: { success: true, runId: 'r', toolsCalled: [] } }); }) });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  const button = screen.getByRole('button', { name: 'Run Demo Flow' });
  button.focus();
  await userEvent.click(button);
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).toHaveTextContent('Running'));
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).not.toBeDisabled();
  expect(button).toHaveTextContent('Run Demo Flow');
  expect(button).toHaveFocus();
  await userEvent.click(button);
  expect(bffAxios.post).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('rr-table')).toBeInTheDocument(); // the list stays mounted during the reload
  release();
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).not.toHaveTextContent('Running'));
  expect(button).toHaveFocus();
});

test('a run the BFF reports as failed shows Failed with the reason, and no green Completed', async () => {
  seed({ invoke: () => Promise.resolve({ data: { success: false, reply: 'tool denied' } }) });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await userEvent.click(screen.getByRole('button', { name: 'Run Demo Flow' }));
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).toHaveTextContent('Failed'));
  expect(screen.getByTestId('rr-run-status')).toHaveTextContent('tool denied');
  expect(screen.getByTestId('rr-run-status')).not.toHaveTextContent('Completed');
  expect(screen.getByTestId('rr-result')).toHaveTextContent('Not checked');
});

test('a 401 on the run makes Sign in the one primary and demotes Run Demo Flow', async () => {
  seed({ invoke: () => Promise.reject(Object.assign(new Error('x'), { response: { status: 401 } })) });
  const { container } = render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await userEvent.click(screen.getByRole('button', { name: 'Run Demo Flow' }));
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).toHaveTextContent('Signed out'));
  expect(primaries(container).map((b) => b.textContent)).toEqual(['Sign in']);
  expect(screen.getByRole('button', { name: 'Run Demo Flow' })).not.toHaveClass('pu-btn--primary');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(navigateToCustomerOAuthLogin).toHaveBeenCalledWith('/reports');
});

test('a failed download shows its result in that run\'s row only', async () => {
  seed();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/reports/history') return Promise.resolve({ data: { runs: [RUN_A, RUN_B] } });
    if (url.startsWith('/api/reports/bbbbbbbb-2222/download')) return Promise.reject(Object.assign(new Error('x'), { response: { status: 500 } }));
    return Promise.reject(new Error('x'));
  });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await userEvent.click(screen.getByRole('button', { name: /MD: download the Markdown report for run bbbbbbbb/ }));
  const statuses = await screen.findAllByTestId('rr-row-status');
  expect(statuses).toHaveLength(1);
  expect(statuses[0]).toHaveTextContent('Markdown download failed (HTTP 500)');
  const rowB = screen.getByText('healthcare').closest('tr');
  expect(within(rowB).getByTestId('rr-row-status')).toBeInTheDocument();
  expect(screen.getByTestId('rr-action-status')).toHaveTextContent('Run bbbbbbbb');
});

test('the admin export is a secondary, shows its result, and is absent for a non-admin', async () => {
  seed();
  const { container, unmount } = render(<RunReportPage user={{ ...USER, role: 'admin' }} />);
  await screen.findByTestId('rr-table');
  expect(screen.getByTestId('rr-bulk-export')).toHaveClass('pu-btn');
  expect(screen.getByTestId('rr-bulk-export')).not.toHaveClass('pu-btn--primary');
  expect(primaries(container)).toHaveLength(1);
  expect(screen.getByTestId('rr-admin-status')).toHaveTextContent('Idle');
  unmount();
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  expect(screen.queryByTestId('rr-admin')).toBeNull();
});

test('a vertical the list does not offer is not run silently: the select and the request agree', async () => {
  seed({ runs: [RUN_A] });
  render(<RunReportPage user={{ ...USER, vertical: 'workforce' }} />);
  await screen.findByTestId('rr-table');
  await waitFor(() => expect(screen.getByTestId('rr-vertical')).toHaveValue('banking'));
  await userEvent.click(screen.getByRole('button', { name: 'Run Demo Flow' }));
  await waitFor(() => expect(bffAxios.post).toHaveBeenCalled());
  expect(bffAxios.post.mock.calls[0][1].vertical).toBe('banking');
});

// ---- skeptic follow-ups ----

const chipOf = (testId) => screen.getByTestId(testId).querySelector('.pu-chip');

test('a 200 with no success flag is not reported as the BFF reporting success, and a found run id is the only green', async () => {
  let calls = 0;
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/reports/history') {
      calls += 1;
      return Promise.resolve({ data: { runs: calls === 1 ? [RUN_A] : [RUN_A, { ...RUN_A, runId: 'new-run-1' }] } });
    }
    return Promise.reject(new Error('x'));
  });
  bffAxios.post.mockResolvedValue({ data: { reply: 'Your balance is 10', runId: 'new-run-1' } });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await userEvent.click(screen.getByRole('button', { name: 'Run Demo Flow' }));
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).toHaveTextContent('Recorded'));
  const status = screen.getByTestId('rr-run-status');
  expect(status).toHaveTextContent(/without a success flag/);
  expect(status).not.toHaveTextContent(/reported success/);
  expect(chipOf('rr-run-status')).toHaveClass('pu-chip--ok');
  expect(screen.getByTestId('rr-result')).toHaveClass('pu-card--ok');
});

test('a 200 with no success flag and no run id is neutral: nothing was checked, nothing is green', async () => {
  seed({ runs: [RUN_A], invoke: () => Promise.resolve({ data: { reply: 'hello' } }) });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await userEvent.click(screen.getByRole('button', { name: 'Run Demo Flow' }));
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).toHaveTextContent('Answered'));
  expect(screen.getByTestId('rr-run-status')).toHaveTextContent(/without a success flag/);
  expect(chipOf('rr-run-status')).toHaveClass('pu-chip--neutral');
  expect(screen.getByTestId('rr-result')).toHaveClass('pu-card--neutral');
  expect(screen.getByTestId('rr-result')).toHaveTextContent('Not checked');
});

test('a reported success whose run id is missing from the reloaded list is a warning, not green Completed', async () => {
  seed({ runs: [RUN_A] });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await userEvent.click(screen.getByRole('button', { name: 'Run Demo Flow' }));
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).toHaveTextContent('Not in history'));
  expect(screen.getByTestId('rr-run-status')).not.toHaveTextContent('Completed');
  expect(chipOf('rr-run-status')).toHaveClass('pu-chip--warn');
  expect(screen.getByTestId('rr-result')).toHaveClass('pu-card--warn');
});

test('a reported success with a failed history refresh is neutral (Reported success, not checked), not green', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let calls = 0;
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/reports/history') {
      calls += 1;
      return calls === 1 ? Promise.resolve({ data: { runs: [RUN_A] } }) : Promise.reject(new Error('down'));
    }
    return Promise.reject(new Error('x'));
  });
  bffAxios.post.mockResolvedValue({ data: { success: true, runId: 'new-run-1' } });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await userEvent.click(screen.getByRole('button', { name: 'Run Demo Flow' }));
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).toHaveTextContent('Reported success'));
  expect(chipOf('rr-run-status')).toHaveClass('pu-chip--neutral');
  expect(screen.getByTestId('rr-result')).toHaveClass('pu-card--neutral');
  expect(screen.getByTestId('rr-result')).toHaveTextContent('Not checked');
});

test('the vertical select takes aria-disabled (not disabled) during a run, keeps focus, and ignores changes', async () => {
  let release;
  seed({ runs: [RUN_A], invoke: () => new Promise((resolve) => { release = () => resolve({ data: { success: true, runId: 'r' } }); }) });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await waitFor(() => expect(screen.getByRole('option', { name: 'Retail' })).toBeInTheDocument());
  const select = screen.getByTestId('rr-vertical');
  await userEvent.click(screen.getByRole('button', { name: 'Run Demo Flow' }));
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).toHaveTextContent('Running'));
  expect(select).toHaveAttribute('aria-disabled', 'true');
  expect(select).not.toBeDisabled();
  select.focus();
  await userEvent.selectOptions(select, 'retail');
  expect(select).toHaveValue('banking');
  expect(select).toHaveFocus();
  release();
  await waitFor(() => expect(screen.getByTestId('rr-run-status')).not.toHaveTextContent('Running'));
  expect(select).not.toHaveAttribute('aria-disabled');
  expect(select).toHaveFocus();
  await userEvent.selectOptions(select, 'retail');
  expect(select).toHaveValue('retail');
});

test('a share response without a link says so and copies nothing', async () => {
  seed();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/reports/history') return Promise.resolve({ data: { runs: [RUN_A] } });
    if (url.endsWith('/share')) return Promise.resolve({ data: {} });
    return Promise.reject(new Error('x'));
  });
  render(<RunReportPage user={USER} />);
  await screen.findByTestId('rr-table');
  await userEvent.click(screen.getByRole('button', { name: /Share: copy the share link for run aaaaaaaa/ }));
  expect(await screen.findByTestId('rr-row-status')).toHaveTextContent('no share link');
  expect(screen.getByTestId('rr-row-status')).not.toHaveTextContent(/copied to the clipboard/);
  expect(writeText).not.toHaveBeenCalled();
});
