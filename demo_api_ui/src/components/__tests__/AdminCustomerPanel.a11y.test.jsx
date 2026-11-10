// AdminCustomerPanel (inside /admin): focus survives selecting and clearing a customer, button names stay put while
// an action runs (a mounted status line speaks instead), no stale result or error sits beside a new action, and the
// PingOne note is true when the BFF fell back to the demo store.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminCustomerPanel from '../AdminCustomerPanel';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../services/bffAxios', () => ({ default: { get: mocks.get, post: mocks.post } }));

const USER = { id: 'u1', username: 'jdoe', firstName: 'Jane', lastName: 'Doe', email: 'j@x.test' };
const ACCOUNTS = [{ id: 'acc1', name: 'Checking', accountNumber: '1111', balance: 100, currency: 'USD' }];
const LOOKUP_UNLINKED = {
  user: USER, accounts: ACCOUNTS, transactions: [],
  pingOne: { linked: false, reason: 'not_found' },
};

function setup({ lookup = LOOKUP_UNLINKED, profile } = {}) {
  mocks.get.mockImplementation((url) => {
    if (url === '/api/admin/users/hints') return Promise.resolve({ data: { users: [] } });
    if (url === '/api/admin/agent/lookup') return Promise.resolve({ data: { users: [USER] } });
    if (url === '/api/admin/agent/users/u1') return profile ? profile() : Promise.resolve({ data: { user: USER } });
    if (url === '/api/admin/agent/users/u1/accounts') return Promise.resolve({ data: { accounts: ACCOUNTS } });
    return Promise.resolve({ data: {} });
  });
  mocks.post.mockImplementation((url) => {
    if (url === '/api/admin/transactions/lookup') return Promise.resolve({ data: lookup });
    return Promise.resolve({ data: { newBalance: 150, accountId: 'acc1' } });
  });
}

async function selectJane() {
  const search = screen.getByLabelText('Search customers');
  fireEvent.change(search, { target: { value: 'jane' } });
  const match = await screen.findByRole('button', { name: /Jane Doe/ }, { timeout: 3000 });
  match.focus();
  fireEvent.click(match);
  return search;
}

describe('AdminCustomerPanel — focus, live regions, stale state', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('selecting a match with the keyboard moves focus to the "Acting on" block, and Clear returns it to the search box', async () => {
    setup();
    render(<AdminCustomerPanel />);
    const search = await selectJane();
    const acting = await screen.findByLabelText('Acting on Jane Doe');
    await waitFor(() => expect(document.activeElement).toBe(acting));
    expect(document.activeElement).not.toBe(document.body);
    // the selection block is not itself a live region that mounts with its text
    expect(acting.getAttribute('role')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it('action buttons keep their names while running; the always-mounted status line speaks and the result is a named region', async () => {
    let release;
    setup({ profile: () => new Promise((r) => { release = () => r({ data: { user: USER } }); }) });
    render(<AdminCustomerPanel />);
    const live = document.querySelector('.acp-run-status');
    expect(live.getAttribute('role')).toBe('status');
    await selectJane();
    const view = await screen.findByRole('button', { name: 'View Profile' });
    view.focus();
    fireEvent.click(view);
    await waitFor(() => expect(live).toHaveTextContent('Running profile…'));
    expect(screen.getByRole('button', { name: 'View Profile' })).toBe(view); // name unchanged
    expect(view.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(view);
    await act(async () => { release(); });
    await waitFor(() => expect(live).toHaveTextContent('Profile loaded.'));
    expect(screen.getByRole('region', { name: 'Customer action result' })).toBeInTheDocument();
    expect(document.activeElement).toBe(view);
  });

  it('a failed action clears the previous result and shows the error in an alert that was mounted before it', async () => {
    let fail = false;
    setup({ profile: () => (fail ? Promise.reject({ message: 'boom' }) : Promise.resolve({ data: { user: USER } })) });
    render(<AdminCustomerPanel />);
    await selectJane();
    fireEvent.click(await screen.findByRole('button', { name: 'View Accounts' }));
    await screen.findByRole('region', { name: 'Customer action result' });
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0); // empty slots are already in the DOM
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'View Profile' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some((a) => a.textContent.includes('boom'))).toBe(true));
    expect(screen.queryByRole('region', { name: 'Customer action result' })).toBeNull(); // no stale accounts beside the error
    for (const a of alerts) expect(document.body.contains(a)).toBe(true); // same nodes, not re-mounted
  });

  it('Apply adjustment: focus lands on the result when the form it was pressed in goes away', async () => {
    setup();
    render(<AdminCustomerPanel />);
    await selectJane();
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust Balance' }));
    const select = await screen.findByLabelText('Account');
    fireEvent.change(select, { target: { value: 'acc1' } });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '50' } });
    const apply = screen.getByRole('button', { name: 'Apply adjustment' });
    apply.focus();
    fireEvent.click(apply);
    const result = await screen.findByRole('region', { name: 'Customer action result' });
    await waitFor(() => expect(within(result).getByText(/Balance adjusted/)).toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(result));
  });

  it('says so when no PingOne record is linked, so the profile is known to come from the demo store', async () => {
    setup();
    render(<AdminCustomerPanel />);
    await selectJane();
    expect(await screen.findByText(/No PingOne record is linked to this customer \(not_found\)/)).toBeInTheDocument();
    expect(screen.getByText(/demo store only/)).toBeInTheDocument();
  });
});
