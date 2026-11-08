import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import SecuritySettings from '../components/SecuritySettings';
import apiClient from '../services/apiClient';

vi.mock('../services/apiClient', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
const openEdu = vi.fn();
vi.mock('../context/EducationUIContext', () => ({ useEducationUI: () => ({ open: openEdu }) }));
vi.mock('../components/SecuritySettings.css', () => ({}), { virtual: true });

const SETTINGS = {
  stepUpEnabled: true,
  stepUpAmountThreshold: 500,
  stepUpAcrValue: 'Multi_Factor',
  stepUpTransactionTypes: ['transfer', 'withdrawal'],
  stepUpMethod: 'email',
  stepUpWithdrawalsAlways: true,
  maxTransactionAmount: 1000,
  agentTransactionCountLimit: 0,
  agentTransactionValueLimit: 0,
  authorizeEnabled: false,
  authorizePolicyId: 'pol-1',
};
const HISTORY = [
  { timestamp: '2026-11-08T14:05:00Z', changedBy: 'a@x.test', changes: { stepUpAmountThreshold: 500 }, previous: { stepUpAmountThreshold: 250 } },
];
const LOAD = {
  data: { settings: SETTINGS, history: HISTORY, authorizeStatus: { authorizeEnabledConfig: true, activeEngine: 'simulated' } },
};

const primaries = (root = document) => root.querySelectorAll('button.pu-btn--primary');

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue(LOAD);
});

async function ready() {
  const view = render(<SecuritySettings />);
  await screen.findByText('Step-up MFA Enabled');
  return view;
}

describe('SecuritySettings on the Ping UI Standard', () => {
  it('puts a role=note banner first, then the page title, and says the settings are live', async () => {
    const { container } = await ready();
    const page = container.querySelector('.pu-page');
    expect(page.firstElementChild).toHaveClass('pu-banner-wrap');
    const banner = screen.getByTestId('sset-banner');
    expect(banner).toHaveAttribute('role', 'note');
    expect(banner).toHaveTextContent(/live settings/i);
    expect(banner).not.toHaveTextContent(/nothing on this page is simulated/i);
    expect(banner).toHaveTextContent(/server.s memory/i);
    expect(screen.getByRole('heading', { level: 1, name: 'Security Settings' })).toBeInTheDocument();
  });

  it('has exactly one primary button, Save Changes, and Discard is a secondary', async () => {
    await ready();
    const prim = primaries();
    expect(prim).toHaveLength(1);
    expect(prim[0]).toHaveTextContent('Save Changes');
    expect(screen.getByRole('button', { name: 'Discard' })).not.toHaveClass('pu-btn--primary');
  });

  it('keeps Save and Discard focusable but inert until a field changes (aria-disabled, never disabled)', async () => {
    await ready();
    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toBeDisabled();
    expect(save).toHaveAccessibleDescription(/nothing to save/i);
    fireEvent.click(save);
    expect(apiClient.put).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Step-up Threshold ($)'), { target: { value: '750' } });
    expect(save).not.toHaveAttribute('aria-disabled');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('saves without the read-only authorizeEnabled, keeps focus on Save and announces the result once', async () => {
    apiClient.put.mockResolvedValue({ data: { settings: { ...SETTINGS, stepUpAmountThreshold: '750' } } });
    await ready();
    fireEvent.change(screen.getByLabelText('Step-up Threshold ($)'), { target: { value: '750' } });
    const save = screen.getByRole('button', { name: /save changes/i });
    save.focus();
    fireEvent.click(save);

    await screen.findByText(/settings saved successfully/i);
    expect(apiClient.put).toHaveBeenCalledTimes(1);
    const payload = apiClient.put.mock.calls[0][1];
    expect(payload.stepUpAmountThreshold).toBe('750');
    expect('authorizeEnabled' in payload).toBe(false);
    expect(screen.getAllByText(/settings saved successfully/i)).toHaveLength(1);
    expect(screen.getByTestId('sset-status')).toHaveAttribute('aria-live', 'polite');
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(save);
  });

  it('shows the server reason in an alert when saving fails, keeps the edits and stays dirty', async () => {
    apiClient.put.mockRejectedValue({ response: { data: { error_description: 'Something went wrong' } } });
    await ready();
    fireEvent.change(screen.getByLabelText('Step-up Threshold ($)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).toHaveTextContent('Not saved');
    expect(screen.getByLabelText('Step-up Threshold ($)')).toHaveValue(5);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('does not report a failed save when only the history refresh after a good save fails', async () => {
    apiClient.put.mockResolvedValue({ data: { settings: SETTINGS } });
    await ready();
    apiClient.get.mockRejectedValueOnce(new Error('network'));
    fireEvent.change(screen.getByLabelText('Required ACR Value'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText(/settings saved successfully/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Discard puts the saved values back and keeps focus', async () => {
    await ready();
    const acr = screen.getByLabelText('Required ACR Value');
    fireEvent.change(acr, { target: { value: 'changed' } });
    const discard = screen.getByRole('button', { name: 'Discard' });
    discard.focus();
    fireEvent.click(discard);
    expect(acr).toHaveValue('Multi_Factor');
    expect(discard).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(discard);
  });

  it('names the switch, exposes aria-pressed and the On / Off word', async () => {
    await ready();
    const sw = screen.getByRole('button', { name: 'Step-up MFA Enabled' });
    expect(sw).toHaveAttribute('aria-pressed', 'true');
    expect(sw.parentElement).toHaveTextContent('On');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-pressed', 'false');
    expect(sw.parentElement).toHaveTextContent('Off');
  });

  it('shows a check mark on selected transaction types and toggles them', async () => {
    await ready();
    const group = screen.getByRole('group', { name: 'Transaction Types Requiring Step-up' });
    const transfer = within(group).getByRole('button', { name: /transfer/ });
    const deposit = within(group).getByRole('button', { name: /deposit/ });
    expect(transfer).toHaveAttribute('aria-pressed', 'true');
    expect(transfer).toHaveTextContent('✓');
    expect(deposit).toHaveAttribute('aria-pressed', 'false');
    expect(deposit).not.toHaveTextContent('✓');
    fireEvent.click(deposit);
    expect(deposit).toHaveAttribute('aria-pressed', 'true');
    expect(deposit).toHaveTextContent('✓');
  });

  it('puts a $ only on the dollar fields, not on the agent count limit', async () => {
    const { container } = await ready();
    const prefixOf = (label) => screen.getByLabelText(label).closest('.sset-number').querySelector('.sset-number__prefix');
    expect(prefixOf('Step-up Threshold ($)')).toHaveTextContent('$');
    expect(prefixOf('Agent Transaction Value Limit ($)')).toHaveTextContent('$');
    expect(prefixOf('Agent Transaction Count Limit')).toBeNull();
    expect(container.querySelectorAll('.sset-number__prefix')).toHaveLength(3);
  });

  it('labels CIBA as mock phone or email, never a real push', async () => {
    await ready();
    const select = screen.getByLabelText('Step-up MFA Method');
    expect(within(select).getByRole('option', { name: /CIBA approval \(mock phone or email\)/ })).toBeInTheDocument();
    expect(screen.queryByText(/push approval/i)).not.toBeInTheDocument();
  });

  const loadWith = (authorizeStatus) =>
    apiClient.get.mockResolvedValue({ data: { settings: SETTINGS, history: HISTORY, authorizeStatus } });
  const statusRow = () => screen.getByTestId('sset-field-authorizeEnabled');
  const gateRow = () => screen.getByText('PingOne Authorize gate').nextElementSibling;
  const chipsIn = (el) => [...el.querySelectorAll('.pu-chip')];

  describe('Authorize engine wording follows activeEngine', () => {
    it('simulated: a neutral-info "Simulated engine" chip, never green Active, banner says the engine is simulated', async () => {
      await ready();
      const chip = chipsIn(statusRow())[0];
      expect(chip).toHaveTextContent('Simulated engine');
      expect(chip).toHaveClass('pu-chip--info');
      expect(chip).not.toHaveClass('pu-chip--ok');
      expect(screen.queryByText('Active')).not.toBeInTheDocument();
      expect(statusRow()).toHaveTextContent(/settings are real, the decision engine is simulated/i);
      const gate = chipsIn(gateRow())[0];
      expect(gate).toHaveTextContent('Simulated engine');
      expect(gateRow()).toHaveTextContent(/policy: pol-1/);
      const banner = screen.getByTestId('sset-banner');
      expect(banner).toHaveTextContent(/settings are real, but the Authorize decision engine is simulated/i);
      expect(banner).not.toHaveTextContent(/nothing on this page is simulated/i);
    });

    it('pingone: the only case that gets the green Active chip', async () => {
      loadWith({ authorizeEnabledConfig: true, activeEngine: 'pingone' });
      await ready();
      const chip = chipsIn(statusRow())[0];
      expect(chip).toHaveTextContent('Active');
      expect(chip).toHaveClass('pu-chip--ok');
      expect(chipsIn(gateRow())[0]).toHaveClass('pu-chip--ok');
      expect(screen.getByTestId('sset-banner')).toHaveTextContent(/decisions come from PingOne/i);
      expect(screen.getByTestId('sset-banner')).not.toHaveTextContent(/simulated/i);
    });

    it('pending_config: an amber "Not configured yet" chip, never Active, and not the raw engine key', async () => {
      loadWith({ authorizeEnabledConfig: true, activeEngine: 'pending_config' });
      const { container } = await ready();
      const chip = chipsIn(statusRow())[0];
      expect(chip).toHaveTextContent('Not configured yet');
      expect(chip).toHaveClass('pu-chip--warn');
      expect(screen.queryByText('Active')).not.toBeInTheDocument();
      expect(chipsIn(gateRow())[0]).toHaveClass('pu-chip--warn');
      expect(container).not.toHaveTextContent('pending_config');
      expect(screen.getByTestId('sset-banner')).toHaveTextContent(/no decision endpoint or policy yet/i);
    });

    it('off (authorizeEnabledConfig false): amber Inactive', async () => {
      loadWith({ authorizeEnabledConfig: false, activeEngine: 'off' });
      await ready();
      expect(chipsIn(statusRow())[0]).toHaveTextContent('Inactive');
      expect(chipsIn(statusRow())[0]).toHaveClass('pu-chip--warn');
      expect(screen.queryByText('Active')).not.toBeInTheDocument();
      expect(screen.getByTestId('sset-banner')).toHaveTextContent(/Authorize is off/i);
    });

    it('an engine key the page does not know: neutral, no green, raw key not shown', async () => {
      loadWith({ authorizeEnabledConfig: true, activeEngine: 'quantum' });
      const { container } = await ready();
      expect(chipsIn(statusRow())[0]).toHaveClass('pu-chip--neutral');
      expect(screen.queryByText('Active')).not.toBeInTheDocument();
      expect(container).not.toHaveTextContent('quantum');
    });

    it('every chip carries a word', async () => {
      const { container } = await ready();
      container.querySelectorAll('.pu-chip').forEach((chip) => {
        expect(chip.textContent.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('says status is unavailable (not Active) when the server sent no authorizeStatus', async () => {
    apiClient.get.mockResolvedValue({ data: { settings: SETTINGS, history: [] } });
    await ready();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.getAllByText('Status unavailable').length).toBe(2);
    expect(screen.getByTestId('sset-banner')).toHaveTextContent(/did not report which/i);
  });

  it('renders history as a focusable region with removed and added values, and tolerates a missing previous', async () => {
    apiClient.get.mockResolvedValue({
      data: { settings: SETTINGS, history: [...HISTORY, { timestamp: '2026-11-08T13:05:00Z', changedBy: 'b@x.test', changes: { stepUpAcrValue: 'Y' } }] },
    });
    const { container } = await ready();
    const region = screen.getByRole('region', { name: 'Recent setting changes' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(container.querySelector('.sset-history del')).toHaveTextContent('250');
    expect(container.querySelector('.sset-history ins')).toHaveTextContent('500');
    expect(within(region).getByText('b@x.test')).toBeInTheDocument();
  });

  it('opens the education panels from the two "What is" buttons', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'What is step-up MFA?' }));
    fireEvent.click(screen.getByRole('button', { name: 'What is PingOne Authorize?' }));
    expect(openEdu).toHaveBeenCalledTimes(2);
  });

  describe('when the settings cannot be loaded', () => {
    it('shows an error with Try again as the only primary instead of crashing', async () => {
      apiClient.get.mockRejectedValueOnce({ response: { data: { error: 'boom' } } });
      render(<SecuritySettings />);
      const err = await screen.findByTestId('sset-load-error');
      expect(err).toHaveTextContent('boom');
      expect(primaries()).toHaveLength(1);
      expect(primaries()[0]).toHaveTextContent('Try again');
      expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
      expect(screen.queryByText('Step-up MFA Enabled')).not.toBeInTheDocument();
    });

    it('Try again loads the form and moves focus to it', async () => {
      apiClient.get.mockRejectedValueOnce(new Error('down'));
      render(<SecuritySettings />);
      const retry = await screen.findByRole('button', { name: 'Try again' });
      retry.focus();
      fireEvent.click(retry);
      await screen.findByText('Step-up MFA Enabled');
      const form = screen.getByRole('region', { name: 'Security settings form' });
      await waitFor(() => expect(document.activeElement).toBe(form));
      expect(primaries()).toHaveLength(1);
      expect(primaries()[0]).toHaveTextContent('Save Changes');
    });

    it('a second failed Try again changes the alert text and re-mounts it, so it is announced again', async () => {
      apiClient.get.mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down'));
      render(<SecuritySettings />);
      const first = await screen.findByTestId('sset-load-error');
      const firstText = first.textContent;
      expect(firstText).not.toMatch(/attempt/i);
      const retry = screen.getByRole('button', { name: 'Try again' });
      retry.focus();

      fireEvent.click(retry);
      await waitFor(() => expect(screen.getByTestId('sset-load-error').textContent).toMatch(/attempt 2/i));
      const second = screen.getByTestId('sset-load-error');
      expect(second.textContent).not.toBe(firstText);
      expect(second).not.toBe(first); // a fresh role=alert node
      expect(second).toHaveAttribute('role', 'alert');

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(screen.getByTestId('sset-load-error').textContent).toMatch(/attempt 3/i));
      expect(screen.getByTestId('sset-load-error').textContent).not.toBe(second.textContent);
    });

    it('after a failed retry focus stays on Try again, and a later success still moves focus to the form', async () => {
      apiClient.get.mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down'));
      render(<SecuritySettings />);
      const retry = await screen.findByRole('button', { name: 'Try again' });
      retry.focus();
      fireEvent.click(retry);
      await waitFor(() => expect(screen.getByTestId('sset-load-error').textContent).toMatch(/attempt 2/i));
      const again = screen.getByRole('button', { name: 'Try again' });
      expect(document.activeElement).toBe(again);
      expect(primaries()).toHaveLength(1);

      fireEvent.click(again);
      await screen.findByText('Step-up MFA Enabled');
      const form = screen.getByRole('region', { name: 'Security settings form' });
      await waitFor(() => expect(document.activeElement).toBe(form));
    });
  });
});
