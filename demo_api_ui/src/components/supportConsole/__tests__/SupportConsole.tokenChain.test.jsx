import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SupportConsole from '../SupportConsole';
import { tokenChainTraceStore } from '../../../services/tokenChainTrace/tokenChainTraceStore';

vi.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../utils/appToast', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn() }));
import bffAxios from '../../../services/bffAxios';

beforeEach(() => {
  bffAxios.get.mockReset();
  bffAxios.post.mockReset();
  tokenChainTraceStore.reset();
});

const LOOKUP = {
  user: { id: 'u1', name: 'Marcus Hall' },
  data: { trainings: [{ id: 'TR-1', title: 'Security basics', dueDate: '2026-10-01', status: 'Assigned' }] },
};

const WRITE_CHAIN = [
  { id: 'operator-session', label: 'Operator session', status: 'done', vertical: 'workforce', claims: { operator: 'op-1' } },
  { id: 'operator-verification', label: 'Customer identity verified', status: 'done', vertical: 'workforce', claims: { customerId: 'u1' } },
  { id: 'operator-write', label: 'Store write — TR-1', status: 'done', vertical: 'workforce', claims: { row: 'TR-1', beforeStatus: 'Assigned', afterStatus: 'Completed' }, request: { method: 'POST', url: '/api/admin/workforce/trainings/TR-1/complete' } },
  { id: 'operator-audit', label: 'Audit recorded', status: 'done', vertical: 'workforce', claims: { operator: 'op-1' } },
];

function mockGets() {
  bffAxios.get.mockImplementation((url) => {
    if (url.endsWith('/permissions')) return Promise.resolve({ data: { scopes: ['transactions:write', 'general:write'], source: 'introspection' } });
    if (url.includes('/lookup')) return Promise.resolve({ data: LOOKUP });
    if (url.includes('/notes')) return Promise.resolve({ data: { data: { notes: [] } } });
    return Promise.resolve({ data: {} });
  });
}

// Two-phase customer verification: initiate → otp step, otp → verified+expiry.
// The mock chain order in every test below is initiate, otp, then the action.
function mockVerify() {
  bffAxios.post
    .mockResolvedValueOnce({ data: { ok: true, step: 'otp', maskedContact: '••••86' } })
    .mockResolvedValueOnce({ data: { ok: true, verified: true, expiresAt: Date.now() + 900000, tokenChain: [] } });
}

async function verifyCustomer() {
  fireEvent.click(screen.getByRole('button', { name: /verify customer/i }));
  await waitFor(() => expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/one-time code/i), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /submit code/i }));
}

it('a successful operator write feeds its token chain to the rail', async () => {
  mockGets();
  mockVerify();
  bffAxios.post
    .mockResolvedValueOnce({ data: { ok: true, item: { id: 'TR-1', status: 'Completed' }, tokenChain: WRITE_CHAIN } });

  render(<SupportConsole vertical="workforce" user={{ role: 'admin' }} />);
  fireEvent.change(screen.getByPlaceholderText(/Look up an employee/i), { target: { value: 'marcus' } });
  fireEvent.submit(screen.getByTestId('vops-lookup-form'));
  await waitFor(() => expect(screen.getByText('Marcus Hall')).toBeInTheDocument());

  await verifyCustomer();
  await waitFor(() => expect(screen.getByRole('button', { name: /Complete/i })).toBeEnabled());

  fireEvent.click(screen.getByRole('button', { name: /Complete/i }));
  await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(3));

  // The rail holds the operator chain, not the banking pipeline.
  const { steps, trace } = tokenChainTraceStore.getState();
  expect(steps.map((s) => s.id)).toContain('operator-write');
  expect(trace.prompt?.message).toMatch(/Complete Security basics/);

  // The rail renders it: the operator hops are visible on this console.
  const traceDetails = screen.getByTestId('vops-token-chain');
  expect(traceDetails).not.toHaveAttribute('hidden');
});

it('hides a chain minted by a different vertical', async () => {
  mockGets();
  mockVerify();
  // The server tags every chain with its vertical — this one came from banking.
  const foreignChain = WRITE_CHAIN.map((e) => ({ ...e, vertical: 'banking' }));
  bffAxios.post
    .mockResolvedValueOnce({ data: { ok: true, item: { id: 'TR-1', status: 'Completed' }, tokenChain: foreignChain } });

  render(<SupportConsole vertical="workforce" user={{ role: 'admin' }} />);
  fireEvent.change(screen.getByPlaceholderText(/Look up an employee/i), { target: { value: 'marcus' } });
  fireEvent.submit(screen.getByTestId('vops-lookup-form'));
  await waitFor(() => expect(screen.getByText('Marcus Hall')).toBeInTheDocument());

  await verifyCustomer();
  await waitFor(() => expect(screen.getByRole('button', { name: /Complete/i })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Complete/i }));
  await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(3));

  // The store holds the foreign chain, but THIS console does not render it.
  expect(tokenChainTraceStore.getState().steps.map((s) => s.id)).toContain('operator-write');
  expect(screen.getByTestId('vops-token-chain')).toHaveAttribute('hidden');
});
