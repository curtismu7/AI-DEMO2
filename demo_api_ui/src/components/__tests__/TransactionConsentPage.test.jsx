import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react'; // eslint-disable-line no-unused-vars -- JSX transform needs React in scope
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../DraggableModal', () => ({ default: ({ isOpen, children }) => (isOpen ? <div role="dialog">{children}</div> : null) }));
vi.mock('../EmbeddedFlowDiagram', () => ({ default: ({ testId }) => <div data-testid={testId} /> }));
vi.mock('../TransactionConsentModal', () => ({ default: () => <div data-testid="live-modal" /> }));
vi.mock('../SignInPrompt', () => ({ default: () => <div data-testid="sign-in" /> }));

import apiClient from '../../services/apiClient';
import TransactionConsentPage from '../TransactionConsentPage';

const user = { id: 'u1', role: 'customer' };
const pendingView = { state: 'pending', loginHint: 'demouser', amount: 500, type: 'transfer', description: 'Monthly rent payment', trace: [] };
const renderAt = (path, u = user) => render(
  <MemoryRouter initialEntries={[path]}><TransactionConsentPage user={u} /></MemoryRouter>,
);

describe('TransactionConsentPage (simulate mode, Ping UI Standard)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('puts an honest simulation banner first, before the page header', () => {
    const { container } = renderAt('/transaction-consent');
    const page = container.querySelector('.pu-page');
    expect(page.firstElementChild.querySelector('[role="note"]')).toBe(screen.getByTestId('tc-banner'));
    expect(screen.getByTestId('tc-banner').textContent).toMatch(/SIMULATED/);
    expect(screen.getByTestId('tc-banner').textContent).toMatch(/PingOne is not called/);
    expect(screen.getByTestId('tc-banner').textContent).toMatch(/What is real/);
    expect(page.children[1].tagName).toBe('HEADER');
  });

  it('shows one card per scenario, each with a worded chip, a kv list and a named Simulate button', () => {
    renderAt('/transaction-consent');
    for (const id of ['standard-transfer', 'high-value', 'withdrawal', 'agent-initiated']) {
      const card = screen.getByTestId(`tc-scenario-${id}`);
      expect(card.querySelector('.pu-chip').textContent.trim().length).toBeGreaterThan(0);
      expect(card.querySelector('dl.pu-kv')).toBeTruthy();
      expect(within(card).getByRole('button', { name: /^Simulate / })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Simulate High-Value Transfer ($15,000)' })).toBeTruthy();
  });

  it('has exactly one primary on the picker: Simulate on the standard transfer', () => {
    const { container } = renderAt('/transaction-consent');
    const primaries = container.querySelectorAll('.pu-btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0].getAttribute('data-testid')).toBe('tc-start-standard-transfer');
  });

  it('starts the mock request with the scenario snapshot and moves focus to the run region', async () => {
    apiClient.post.mockResolvedValueOnce({ data: pendingView });
    renderAt('/transaction-consent');
    fireEvent.click(screen.getByTestId('tc-start-high-value'));
    await screen.findByTestId('consent-pending');
    expect(apiClient.post).toHaveBeenCalledWith('/api/consent-mock-phone/start', {
      amount: 15000, type: 'transfer', description: 'Investment portfolio transfer',
    });
    expect(screen.queryByTestId('tc-start-high-value')).toBeNull();
    // The scenario button that started the run is gone: focus must be on the page, not dropped to <body>.
    expect(document.activeElement).not.toBe(document.body);
  });

  it('has no page primary while the mock phone is open, a primary once it is closed, and a worded chip', async () => {
    apiClient.post.mockResolvedValueOnce({ data: pendingView });
    const { container } = renderAt('/transaction-consent');
    fireEvent.click(screen.getByTestId('tc-start-standard-transfer'));
    await screen.findByTestId('consent-mock-phone');
    expect(container.querySelectorAll('.pu-btn--primary')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toBe('pu-btn');
    expect(screen.getByTestId('consent-pending').textContent).toMatch(/Waiting \(mock\)/);
  });

  it('after the answer: a worded outcome chip, one primary ("Pick another scenario"), focus kept, and back to the picker on the same scenario', async () => {
    apiClient.post.mockResolvedValueOnce({ data: pendingView });
    const { container } = renderAt('/transaction-consent');
    fireEvent.click(screen.getByTestId('tc-start-standard-transfer'));
    await screen.findByTestId('consent-mock-phone');

    apiClient.post.mockResolvedValueOnce({ data: { ...pendingView, state: 'denied' } });
    fireEvent.click(screen.getByText('Deny on mock phone'));
    const outcome = await screen.findByTestId('consent-outcome');
    expect(outcome.querySelector('.pu-chip').textContent).toMatch(/Denied \(mock\)/);
    expect(outcome.textContent).toMatch(/Denied on the phone/);
    const primaries = container.querySelectorAll('.pu-btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toBe('Pick another scenario');
    // The phone's buttons unmounted with the answer: focus is on the run region, not <body>.
    await waitFor(() => expect(document.activeElement.getAttribute('aria-label')).toBe('Mock approval request'));

    fireEvent.click(primaries[0]);
    expect(await screen.findByTestId('tc-start-standard-transfer')).toBe(document.activeElement);
  });

  it('a failed start shows a worded failure and offers "Pick another scenario" as the primary', async () => {
    apiClient.post.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 500, data: { message: 'BFF down' } } }));
    const { container } = renderAt('/transaction-consent');
    fireEvent.click(screen.getByTestId('tc-start-withdrawal'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Failed/);
    expect(alert.textContent).toMatch(/BFF down/);
    expect(container.querySelectorAll('.pu-btn--primary')).toHaveLength(1);
  });

  it('keeps the live deep link and the signed-out prompt unchanged (no simulation banner)', () => {
    renderAt('/transaction-consent?challenge=abc');
    expect(screen.getByTestId('live-modal')).toBeTruthy();
    expect(screen.queryByTestId('tc-banner')).toBeNull();
  });

  it('asks a signed-out visitor to sign in', () => {
    renderAt('/transaction-consent', null);
    expect(screen.getByTestId('sign-in')).toBeTruthy();
  });

  it('describes production CIBA as email or SMS, with the mock phone as the local stand-in, and never as a device push or push link', () => {
    const { container } = renderAt('/transaction-consent');
    const text = container.textContent;
    expect(text).toMatch(/delivers the approval request to the user by\s+email or SMS through DaVinci/);
    expect(text).toMatch(/mock phone on this\s+page is the local stand-in for that email or SMS/);
    expect(screen.getByTestId('tc-banner').textContent).toMatch(/email or SMS/);
    expect(text).not.toMatch(/push (notification|link)/i);
    expect(text).not.toMatch(/sends push|push to the user|push to the user's device|push\W+to user/i);
    expect(text).not.toMatch(/mock phone gets the push/i);
  });
});
