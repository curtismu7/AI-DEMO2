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
});
