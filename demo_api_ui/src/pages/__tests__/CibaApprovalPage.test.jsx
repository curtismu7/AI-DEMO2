/**
 * CibaApprovalPage — UC22 separate-device CIBA approval.
 *
 * State machine: loading → pending | expired | error → approved | denied
 * Driven by:
 *   GET  /api/auth/ciba/request/:authReqId   (loads details)
 *   POST /api/auth/ciba/approve-now/:authReqId
 *   POST /api/auth/ciba/deny/:authReqId
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CibaApprovalPage from '../CibaApprovalPage';

vi.mock('../../components/DraggableModal', () => ({
  default: ({ children, footer, title, isOpen }) =>
    isOpen ? (
      <div>
        <div data-testid="modal-title">{title}</div>
        <div data-testid="modal-body">{children}</div>
        {footer && <div data-testid="modal-footer">{footer}</div>}
      </div>
    ) : null,
}));

function renderPage(authReqId = 'req-123') {
  const search = authReqId ? `?authReqId=${authReqId}` : '';
  return render(
    <MemoryRouter initialEntries={[`/ciba/approve${search}`]}>
      <Routes>
        <Route path="/ciba/approve" element={<CibaApprovalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CibaApprovalPage — initial loading state', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => new Promise(() => {})); // never resolves
  });

  it('shows the loading message while fetch is in-flight', () => {
    renderPage();
    expect(screen.getByText(/Loading approval request/i)).toBeInTheDocument();
  });

  it('renders the "PingOne Identity Verification" modal title', () => {
    renderPage();
    expect(screen.getByTestId('modal-title')).toHaveTextContent('PingOne Identity Verification');
  });
});

describe('CibaApprovalPage — error states', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows error state when authReqId is missing from URL', () => {
    renderPage('');
    expect(screen.getByText(/Could not load this approval request/i)).toBeInTheDocument();
  });

  it('shows expired state on 410 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 410, ok: false });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/approval request has expired/i)).toBeInTheDocument(),
    );
  });

  it('shows error state on non-ok non-410 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500, ok: false });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Could not load this approval request/i)).toBeInTheDocument(),
    );
  });

  it('shows error state on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network Error'));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Could not load this approval request/i)).toBeInTheDocument(),
    );
  });
});

describe('CibaApprovalPage — pending state', () => {
  const details = { binding_message: 'Approve transfer of $750' };

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => details,
    });
  });

  it('shows the binding_message and Approve/Deny buttons', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Approve transfer of $750')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('shows monetary transfer details when amount is present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        amount: 750,
        from_account_label: 'Checking ••1234',
        to_account_label: 'Savings ••5678',
      }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/750\.00/)).toBeInTheDocument());
    expect(screen.getByText(/Checking ••1234/)).toBeInTheDocument();
    expect(screen.getByText(/Savings ••5678/)).toBeInTheDocument();
  });
});

describe('CibaApprovalPage — Approve / Deny actions', () => {
  const details = { binding_message: 'Please approve' };

  beforeEach(() => {
    global.fetch = vi.fn()
      // First call: load request details
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => details })
      // Second call: approve/deny action — overridden per test
      .mockResolvedValue({ ok: true });
  });

  it('transitions to approved state after clicking Approve', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(screen.getByText(/Approved.*close this tab/i)).toBeInTheDocument(),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/ciba/approve-now/req-123'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('transitions to denied state after clicking Deny', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() =>
      expect(screen.getByText(/Denied.*close this tab/i)).toBeInTheDocument(),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/ciba/deny/req-123'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows error state when approve POST fails', async () => {
    global.fetch
      .mockReset()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => details })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(screen.getByText(/Could not load this approval request/i)).toBeInTheDocument(),
    );
  });

  it('disables buttons while action is in-flight', async () => {
    // Make the action call hang so we can assert the busy state
    global.fetch
      .mockReset()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => details })
      .mockReturnValueOnce(new Promise(() => {}));
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled(),
    );
  });
});

// The phone used to be a dead end in every non-pending state. footer was
// `undefined`, and DraggableModal (DraggableModal.jsx:240) reads an undefined
// footer as "render my default Close footer" — so the user's Approve/Deny were
// silently replaced by a lone Close with no explanation and no way forward,
// while the dashboard kept polling. The mock above renders nothing for an
// undefined footer, which is why the real dead end was invisible to these tests.
describe('CibaApprovalPage — non-pending states are not dead ends', () => {
  const details = { amount: 300, from_account_label: 'Checking', to_account_label: 'Savings' };

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('offers a retry when the load itself failed', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 });
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument(),
    );
  });

  it('retry re-requests the challenge and can recover into pending', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => details });
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument(),
    );
    const callsBefore = global.fetch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // A second GET goes out, and the page reaches a state where approval is
    // possible again — the recovery the old page could never make.
    await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThan(callsBefore));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument(),
    );
  });

  it('expiry says where a new request comes from rather than "try again"', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 410 });
    renderPage();
    // Expiry is terminal for this request — the BFF deleted it, so a retry here
    // cannot help and must not be offered.
    await waitFor(() =>
      expect(screen.getByText(/Start the transfer again from the dashboard/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
