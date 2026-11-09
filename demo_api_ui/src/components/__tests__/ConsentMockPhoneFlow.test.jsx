import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react'; // eslint-disable-line no-unused-vars -- JSX transform needs React in scope
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../DraggableModal', () => ({ default: ({ isOpen, children }) => (isOpen ? <div>{children}</div> : null) }));

import apiClient from '../../services/apiClient';
import ConsentMockPhoneFlow from '../ConsentMockPhoneFlow';

const scenario = { id: 's', label: 'High-Value Transfer ($15,000)', snapshot: { amount: 15000, type: 'transfer', description: 'Investment portfolio transfer' } };
const pendingView = { state: 'pending', loginHint: 'demouser', amount: 15000, type: 'transfer', description: 'Investment portfolio transfer', trace: [] };

describe('ConsentMockPhoneFlow', () => {
  beforeEach(() => { vi.clearAllMocks(); apiClient.post.mockResolvedValueOnce({ data: pendingView }); });

  it('starts a request with the scenario, shows the push, and renders the approved outcome', async () => {
    render(<ConsentMockPhoneFlow scenario={scenario} onDone={vi.fn()} />);
    expect(await screen.findByTestId('consent-mock-phone')).toBeTruthy();
    expect(apiClient.post).toHaveBeenCalledWith('/api/consent-mock-phone/start', scenario.snapshot);
    expect(screen.getByText('Investment portfolio transfer')).toBeTruthy();
    apiClient.post.mockResolvedValueOnce({ data: { ...pendingView, state: 'approved' } });
    fireEvent.click(screen.getByText('Approve on mock phone'));
    await waitFor(() => expect(screen.getByTestId('consent-outcome').textContent).toMatch(/Approved on the phone/));
    expect(apiClient.post).toHaveBeenLastCalledWith('/api/consent-mock-phone/decision', { decision: 'approve' });
    expect(screen.queryByTestId('consent-mock-phone')).toBeNull();
  });

  it('deny blocks the transaction', async () => {
    render(<ConsentMockPhoneFlow scenario={scenario} onDone={vi.fn()} />);
    await screen.findByTestId('consent-mock-phone');
    apiClient.post.mockResolvedValueOnce({ data: { ...pendingView, state: 'denied' } });
    fireEvent.click(screen.getByText('Deny on mock phone'));
    await waitFor(() => expect(screen.getByTestId('consent-outcome').textContent).toMatch(/Denied/));
  });

  describe('embedded in another page', () => {
    it('drops the page heading and reports the answer once through onDecision', async () => {
      const onDecision = vi.fn();
      render(<ConsentMockPhoneFlow embedded scenario={scenario} onDone={vi.fn()} onDecision={onDecision} />);
      await screen.findByTestId('consent-mock-phone');
      expect(screen.queryByRole('heading', { name: /Transaction Consent/ })).toBeNull();
      expect(onDecision).not.toHaveBeenCalled(); // still pending: nothing to report yet

      apiClient.post.mockResolvedValueOnce({ data: { ...pendingView, state: 'approved' } });
      fireEvent.click(screen.getByText('Approve on mock phone'));
      await waitFor(() => expect(onDecision).toHaveBeenCalledWith('approved'));
      expect(onDecision).toHaveBeenCalledTimes(1);
    });

    it('reports a denial', async () => {
      const onDecision = vi.fn();
      render(<ConsentMockPhoneFlow embedded scenario={scenario} onDone={vi.fn()} onDecision={onDecision} />);
      await screen.findByTestId('consent-mock-phone');
      apiClient.post.mockResolvedValueOnce({ data: { ...pendingView, state: 'denied' } });
      fireEvent.click(screen.getByText('Deny on mock phone'));
      await waitFor(() => expect(onDecision).toHaveBeenCalledWith('denied'));
    });

    it('hands a failed start to onError with the HTTP status so the host can ask for sign-in', async () => {
      apiClient.post.mockReset();
      const failure = Object.assign(new Error('Sign in first'), { response: { status: 401, data: { message: 'Sign in first' } } });
      apiClient.post.mockRejectedValueOnce(failure);
      const onError = vi.fn();
      render(<ConsentMockPhoneFlow embedded scenario={scenario} onDone={vi.fn()} onError={onError} />);
      await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
      expect(screen.getByRole('alert')).toHaveTextContent('Sign in first');
    });

    it('offers Close once answered, not "Pick another scenario"', async () => {
      render(<ConsentMockPhoneFlow embedded scenario={scenario} onDone={vi.fn()} />);
      await screen.findByTestId('consent-mock-phone');
      apiClient.post.mockResolvedValueOnce({ data: { ...pendingView, state: 'approved' } });
      fireEvent.click(screen.getByText('Approve on mock phone'));
      await screen.findByTestId('consent-outcome');
      expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Pick another scenario' })).toBeNull();
    });
  });
});

describe('ConsentMockPhoneFlow pingUi (the /transaction-consent page chrome)', () => {
  beforeEach(() => { vi.clearAllMocks(); apiClient.post.mockResolvedValueOnce({ data: pendingView }); });

  it('drops its own heading and uses the shared button classes', async () => {
    render(<ConsentMockPhoneFlow pingUi scenario={scenario} onDone={vi.fn()} />);
    await screen.findByTestId('consent-mock-phone');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toBe('pu-btn');
  });

  it('gives the outcome a chip with a word, and keeps the default look unchanged without the prop', async () => {
    const { unmount } = render(<ConsentMockPhoneFlow pingUi scenario={scenario} onDone={vi.fn()} />);
    await screen.findByTestId('consent-mock-phone');
    apiClient.post.mockResolvedValueOnce({ data: { ...pendingView, state: 'approved' } });
    fireEvent.click(screen.getByText('Approve on mock phone'));
    const outcome = await screen.findByTestId('consent-outcome');
    expect(outcome.querySelector('.pu-chip').textContent).toBe('Approved (mock)');
    expect(screen.getByRole('button', { name: 'Pick another scenario' }).className).toBe('pu-btn pu-btn--primary');
    unmount();

    apiClient.post.mockResolvedValueOnce({ data: pendingView });
    render(<ConsentMockPhoneFlow scenario={scenario} onDone={vi.fn()} />);
    await screen.findByTestId('consent-mock-phone');
    expect(document.querySelector('.pu-chip')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toBe('cmp__back');
  });

  it('F6: a failed answer shows Failed; the retry that succeeds clears it, so Approved (mock) is not next to a red card', async () => {
    const { container } = render(<ConsentMockPhoneFlow pingUi scenario={scenario} onDone={vi.fn()} />);
    await screen.findByTestId('consent-mock-phone');
    apiClient.post.mockRejectedValueOnce(new Error('500'));
    fireEvent.click(screen.getByText('Approve on mock phone'));
    expect(await screen.findByRole('alert')).toHaveTextContent('The mock phone could not answer.');
    apiClient.post.mockResolvedValueOnce({ data: { ...pendingView, state: 'approved' } });
    fireEvent.click(screen.getByText('Approve on mock phone'));
    expect((await screen.findByTestId('consent-outcome')).textContent).toMatch(/Approved/);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.textContent).not.toMatch(/could not answer/);
    expect(container.querySelector('.pu-chip--danger')).toBeNull();
    expect(container.querySelector('.pu-card--danger')).toBeNull();
  });

  it('F6: a second press while the first answer is in flight is ignored, not sent as a duplicate', async () => {
    render(<ConsentMockPhoneFlow pingUi scenario={scenario} onDone={vi.fn()} />);
    await screen.findByTestId('consent-mock-phone');
    let release;
    apiClient.post.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ data: { ...pendingView, state: 'approved' } }); }));
    fireEvent.click(screen.getByText('Approve on mock phone'));
    fireEvent.click(screen.getByText('Approve on mock phone'));
    expect(apiClient.post.mock.calls.filter(([u]) => u.endsWith('/decision'))).toHaveLength(1);
    release();
    await screen.findByTestId('consent-outcome');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
