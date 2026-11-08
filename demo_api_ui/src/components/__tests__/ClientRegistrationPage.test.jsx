import React from 'react';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const post = vi.fn();
vi.mock('../../services/apiClient', () => ({ default: { post: (...a) => post(...a) } }));

const notifySuccess = vi.fn();
const notifyError = vi.fn();
vi.mock('../../utils/appToast', () => ({
  notifySuccess: (...a) => notifySuccess(...a),
  notifyError: (...a) => notifyError(...a),
}));

vi.mock('../../context/EducationUIContext', () => ({ useEducationUI: () => ({ openPanel: vi.fn() }) }));
vi.mock('../../context/ThemeContext', () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));

import ClientRegistrationPage from '../ClientRegistrationPage';

const RESULT = {
  pingone_client_id: 'app-123',
  client_secret: 'secret-xyz',
  cimd_url: 'https://host/.well-known/oauth-client/app-123',
  cimd_document: { client_id: 'https://host/.well-known/oauth-client/app-123' },
};

const renderPage = () => render(<MemoryRouter><ClientRegistrationPage user={{ role: 'admin' }} /></MemoryRouter>);
const nameField = () => screen.getByLabelText(/client name/i);
const submit = () => screen.getByRole('button', { name: /register client|registering/i });

beforeEach(() => {
  post.mockReset();
  notifySuccess.mockReset();
  notifyError.mockReset();
});

describe('ClientRegistrationPage (Ping UI standard)', () => {
  it('puts an honest live-not-simulated banner first, as a note', () => {
    const { container } = renderPage();
    const root = screen.getByTestId('client-registration-page');
    const banner = screen.getByRole('note');
    expect(root.firstElementChild.contains(banner)).toBe(true);
    expect(container.querySelector('.pu-page')).toBe(root);
    expect(banner.textContent).toMatch(/live, not simulated/i);
    expect(banner.textContent).toMatch(/PingOne Management API/);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('CIMD Simulation');
  });

  it('has exactly one primary (Register Client) in the form view, in Ping Red form, no vertical colour classes', () => {
    const { container } = renderPage();
    const primaries = container.querySelectorAll('.pu-btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toBe(submit());
    expect(primaries[0].getAttribute('type')).toBe('submit');
    expect(container.querySelectorAll('.pu-card').length).toBeGreaterThanOrEqual(5);
    expect(container.querySelectorAll('section[aria-labelledby]').length).toBe(3);
  });

  it('names every field with a label and ties each hint to its control', () => {
    renderPage();
    for (const l of [/client name/i, /^description/i, /application type/i, /client uri/i, /logo uri/i,
      /token endpoint auth method/i, /scopes/i, /^redirect uris/i, /post-logout redirect uris/i, /contact emails/i]) {
      expect(screen.getByLabelText(l)).toBeTruthy();
    }
    expect(nameField().getAttribute('aria-required')).toBe('true');
    const hint = nameField().getAttribute('aria-describedby');
    expect(document.getElementById(hint).textContent).toMatch(/consent screens/i);
    const group = screen.getByRole('group', { name: /grant types/i });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(4);
  });

  it('keeps the submit control focusable but inert until a name is entered, with a visible reason', async () => {
    const user = userEvent.setup();
    renderPage();
    const btn = submit();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/enter a client name to register/i)).toBeTruthy();
    expect(btn.getAttribute('aria-describedby')).toBe('crp-submit-reason');
    btn.focus();
    await user.click(btn);
    expect(post).not.toHaveBeenCalled();
    await user.type(nameField(), '  Acme  ');
    expect(submit().getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText(/enter a client name to register/i)).toBeNull();
  });

  it('posts the CIMD payload and shows the result with chips, kv and focus moved to it', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: RESULT });
    const { container } = renderPage();
    await user.type(nameField(), 'Acme');
    await user.type(screen.getByLabelText(/^redirect uris/i), 'https://a.example/cb{Enter}https://a.example/auth');
    await user.click(submit());
    await waitFor(() => expect(screen.getByTestId('crp-result')).toBeTruthy());

    const [url, payload] = post.mock.calls[0];
    expect(url).toBe('/api/clients/register');
    expect(payload).toMatchObject({
      client_name: 'Acme',
      application_type: 'web',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      redirect_uris: ['https://a.example/cb', 'https://a.example/auth'],
      token_endpoint_auth_method: 'client_secret_basic',
      scope: 'openid profile email',
    });
    expect(notifySuccess).toHaveBeenCalled();

    const result = screen.getByRole('region', { name: /registration result/i });
    expect(document.activeElement).toBe(result);
    expect(result.querySelector('dl.pu-kv')).not.toBeNull();
    const chips = [...result.querySelectorAll('.pu-chip')].map((c) => c.textContent.trim());
    expect(chips).toEqual(['Registered', 'Shown once']);
    expect(within(result).getByText('app-123')).toBeTruthy();
    expect(within(result).getByText('secret-xyz')).toBeTruthy();
    // result view: no primary on purpose, every button a pu-btn secondary
    expect(container.querySelectorAll('.pu-btn--primary')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /register another client/i }).className).toBe('pu-btn');
  });

  it('does not claim the secret is shown once when PingOne returned none', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: { ...RESULT, client_secret: null } });
    renderPage();
    await user.type(nameField(), 'Acme');
    await user.click(submit());
    await waitFor(() => expect(screen.getByTestId('crp-result')).toBeTruthy());
    expect(screen.queryByTestId('crp-secret-warning')).toBeNull();
    expect(screen.getByText(/not available/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy client secret/i })).toBeNull();
  });

  it('keeps focus where it was while registering, locks the fields and reports progress', async () => {
    const user = userEvent.setup();
    let release;
    post.mockReturnValue(new Promise((r) => { release = r; }));
    renderPage();
    await user.type(nameField(), 'Acme{Enter}');
    expect(document.activeElement).toBe(nameField());
    expect(nameField().readOnly).toBe(true);
    expect(nameField().disabled).toBe(false);
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('crp-status').textContent).toMatch(/registering/i);
    // a second Enter while in flight does not post again
    await user.keyboard('{Enter}');
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => { release({ data: RESULT }); });
  });

  it('shows a failure inline (alert + Failed chip), keeps the typed values and the focus', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue({ response: { data: { error: 'nope' } }, message: 'x' });
    renderPage();
    await user.type(nameField(), 'Acme{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Failed/);
    expect(alert.textContent).toMatch(/Registration failed: nope/);
    expect(notifyError).toHaveBeenCalledWith('Registration failed: nope');
    expect(nameField().value).toBe('Acme');
    expect(nameField().readOnly).toBe(false);
    expect(document.activeElement).toBe(nameField());
    expect(screen.queryByText(/nothing has been sent/i)).toBeNull();
  });

  it('reports a failed copy instead of an unhandled rejection, and a good copy politely', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: RESULT });
    renderPage();
    await user.type(nameField(), 'Acme');
    await user.click(submit());
    await screen.findByTestId('crp-result');
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: /copy cimd document url/i }));
    await waitFor(() => expect(screen.getByRole('status', { name: '' }).textContent).toMatch(/copy failed/i));
    await user.click(screen.getByRole('button', { name: /copy cimd document url/i }));
    await waitFor(() => expect(screen.getByText(/copied to the clipboard/i)).toBeTruthy());
    expect(writeText).toHaveBeenLastCalledWith(RESULT.cimd_url);
  });

  it('Register another client clears the form and returns focus to the first field', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: RESULT });
    renderPage();
    await user.type(nameField(), 'Acme');
    await user.click(submit());
    await screen.findByTestId('crp-result');
    await user.click(screen.getByRole('button', { name: /register another client/i }));
    expect(screen.queryByTestId('crp-result')).toBeNull();
    expect(nameField().value).toBe('');
    expect(document.activeElement).toBe(nameField());
  });
});
