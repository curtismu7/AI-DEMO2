import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SupportConsole from '../SupportConsole';

vi.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../utils/appToast', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn() }));
import bffAxios from '../../../services/bffAxios';

// A mockImplementation from one case must not leak into the next.
beforeEach(() => { bffAxios.get.mockReset(); bffAxios.post.mockReset(); });

const LOOKUP = {
  user: { id: 'u1', name: 'Marcus Hall' },
  data: { orders: [{ id: 'o1', product: 'Trail Runner GTX', amount: 189, status: 'Delivered' }] },
};

// The console issues more than one GET (permissions on mount, lookup on submit,
// case notes), so key the mock by URL — mockResolvedValueOnce chains break the
// moment another request is added.
function mockGets({ scopes = ['transactions:write', 'general:write'], source = 'introspection' } = {}) {
  bffAxios.get.mockImplementation((url) => {
    if (url.endsWith('/permissions')) return Promise.resolve({ data: { scopes, source } });
    if (url.includes('/lookup')) return Promise.resolve({ data: LOOKUP });
    if (url.includes('/notes')) return Promise.resolve({ data: { data: { notes: [] } } });
    return Promise.resolve({ data: {} });
  });
}

async function lookUpMarcus() {
  fireEvent.change(screen.getByPlaceholderText(/Look up a member/i), { target: { value: 'marcus' } });
  fireEvent.submit(screen.getByTestId('vops-lookup-form'));
  await waitFor(() => expect(screen.getByText('Marcus Hall')).toBeInTheDocument());
}

it('renders the vertical hero and applies the accent theme var', () => {
  mockGets();
  const { container } = render(<SupportConsole vertical="healthcare" user={{ role: 'user' }} />);
  expect(screen.getByText('Healthcare Ops')).toBeInTheDocument();
  const rootEl = container.querySelector('.vops');
  expect(rootEl.style.getPropertyValue('--accent')).toBe('#0d9488');
});

it('looks up a customer and renders category cards from the response', async () => {
  mockGets();
  render(<SupportConsole vertical="sporting-goods" user={{ role: 'admin' }} />);
  await lookUpMarcus();
  expect(bffAxios.get).toHaveBeenCalledWith('/api/admin/sporting-goods/lookup', { params: { q: 'marcus' } });
  expect(within(screen.getByTestId('vops-grid')).getByText('Orders')).toBeInTheDocument();
});

it('disables gated action buttons until the customer is verified', async () => {
  mockGets();
  render(<SupportConsole vertical="sporting-goods" user={{ role: 'admin' }} />);
  await lookUpMarcus();
  expect(screen.getByRole('button', { name: /Cancel order/i })).toBeDisabled();
});

it('enables gated action buttons after verification', async () => {
  mockGets();
  const expiresAt = Date.now() + 900000;
  bffAxios.post.mockResolvedValueOnce({ data: { ok: true, customerId: 'u1', expiresAt } });

  render(<SupportConsole vertical="sporting-goods" user={{ role: 'admin' }} />);
  await lookUpMarcus();

  fireEvent.click(screen.getByRole('button', { name: /send one-time code/i }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Cancel order/i })).toBeEnabled(),
  );
});

it('denies actions whose scope the operator does not hold, even when verified', async () => {
  mockGets({ scopes: ['general:read'] });
  const expiresAt = Date.now() + 900000;
  bffAxios.post.mockResolvedValueOnce({ data: { ok: true, customerId: 'u1', expiresAt } });

  render(<SupportConsole vertical="sporting-goods" user={{ role: 'admin' }} />);
  await lookUpMarcus();
  fireEvent.click(screen.getByRole('button', { name: /send one-time code/i }));

  await waitFor(() => expect(screen.getByTestId('identity-gate')).toHaveAttribute('data-verified', 'true'));
  expect(screen.getByRole('button', { name: /Cancel order/i })).toBeDisabled();
});

it('says scopes could not be read rather than rendering a blanket denial', async () => {
  mockGets({ scopes: [], source: 'none' });
  render(<SupportConsole vertical="sporting-goods" user={{ role: 'admin' }} />);
  await lookUpMarcus();
  expect(screen.getByText(/Could not read your granted permissions/i)).toBeInTheDocument();
});

it('keeps verification across the refresh that follows a successful write', async () => {
  mockGets();
  const expiresAt = Date.now() + 900000;
  // 1st post = verify/initiate, 2nd = the action itself.
  bffAxios.post
    .mockResolvedValueOnce({ data: { ok: true, customerId: 'u1', expiresAt } })
    .mockResolvedValueOnce({ data: { ok: true, item: { id: 'o1' } } });

  render(<SupportConsole vertical="sporting-goods" user={{ role: 'admin' }} />);
  await lookUpMarcus();
  fireEvent.click(screen.getByRole('button', { name: /send one-time code/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Cancel order/i })).toBeEnabled());

  // runAction re-runs doLookup to refresh. The server's verification for u1 is
  // still live, so the strip must not fall back to "Not verified".
  fireEvent.click(screen.getByRole('button', { name: /Cancel order/i }));
  await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByTestId('identity-gate')).toHaveAttribute('data-verified', 'true'),
  );
  expect(screen.getByRole('button', { name: /Cancel order/i })).toBeEnabled();
});

it('drops verification when the lookup resolves a different customer', async () => {
  mockGets();
  const expiresAt = Date.now() + 900000;
  bffAxios.post.mockResolvedValueOnce({ data: { ok: true, customerId: 'u1', expiresAt } });

  render(<SupportConsole vertical="sporting-goods" user={{ role: 'admin' }} />);
  await lookUpMarcus();
  fireEvent.click(screen.getByRole('button', { name: /send one-time code/i }));
  await waitFor(() => expect(screen.getByTestId('identity-gate')).toHaveAttribute('data-verified', 'true'));

  // Same session, different person — verification must not carry over.
  bffAxios.get.mockImplementation((url) => {
    if (url.endsWith('/permissions')) return Promise.resolve({ data: { scopes: ['transactions:write', 'general:write'], source: 'introspection' } });
    if (url.includes('/lookup')) return Promise.resolve({ data: { user: { id: 'u2', name: 'Casey Stone' }, data: { orders: [] } } });
    return Promise.resolve({ data: { data: { notes: [] } } });
  });
  fireEvent.change(screen.getByPlaceholderText(/Look up a member/i), { target: { value: 'casey' } });
  fireEvent.submit(screen.getByTestId('vops-lookup-form'));

  await waitFor(() => expect(screen.getByText('Casey Stone')).toBeInTheDocument());
  expect(screen.getByTestId('identity-gate')).toHaveAttribute('data-verified', 'false');
});
