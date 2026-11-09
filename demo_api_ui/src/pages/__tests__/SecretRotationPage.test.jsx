import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const APPS = [
  { id: 'a1', clientId: 'c1', name: 'Demo App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', vaultKey: 'PINGONE_AGENT_CLIENT_SECRET', isWorker: false },
  { id: 'a2', clientId: 'c2', name: 'Other App', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', vaultKey: 'AGENT_CLIENT_SECRET', isWorker: false },
  { id: 'a3', clientId: 'c3', name: 'Demo AI App - Introspection Worker', tokenEndpointAuthMethod: 'CLIENT_SECRET_POST', vaultKey: 'PINGONE_WORKER_CLIENT_SECRET', isWorker: true },
];

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '../../services/apiClient';
import SecretRotationPage from '../SecretRotationPage';

// The real app (src/index.js) always renders inside React.StrictMode, which
// double-invokes effects in dev — mount, synthetic unmount, synthetic
// remount. A bare `render()` never exercises that and would have missed the
// bug this file's tests exist to catch: a `useRef` "cancelled" guard set
// `true` by the synthetic unmount's cleanup and never reset, silently
// dropping every `setApps`/`setStatus` call for the rest of the component's
// real life. See memory: StrictMode defeats useRef first-run guards.
function renderPage(ui) {
  return render(<React.StrictMode>{ui}</React.StrictMode>);
}

/** Arms apiClient.get: the apps list, then a run poll returning `run`. */
function arm(run) {
  apiClient.get.mockImplementation((url) => (url.endsWith('/apps')
    ? Promise.resolve({ data: { apps: APPS } })
    : Promise.resolve({ data: run })));
  apiClient.post.mockResolvedValue({ data: { runId: '11111111-1111-1111-1111-111111111111' } });
}

async function rotate(user, appName) {
  await user.click(await screen.findByText(appName));
  await user.click(screen.getByRole('button', { name: /rotate secret/i }));
  await user.type(screen.getByLabelText(/reason/i), 'rotating a leaked credential');
  await user.click(screen.getByRole('button', { name: /arm rotation/i }));
  await user.click(screen.getByRole('button', { name: /yes, rotate/i }));
}

describe('SecretRotationPage', () => {
  // clearAllMocks wipes call history, not an implementation — every test arms
  // its own.
  beforeEach(() => {
    vi.clearAllMocks();
    arm({ status: 'running', lines: [] });
  });

  test('lists rotatable apps', async () => {
    renderPage(<SecretRotationPage />);
    expect(await screen.findByText('Demo App')).toBeInTheDocument();
  });

  test('requires a reason before arming, and requires arming before rotating', async () => {
    renderPage(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo App'));
    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));

    const armButton = screen.getByRole('button', { name: /arm rotation/i });
    expect(armButton).toBeDisabled();
    expect(screen.queryByRole('button', { name: /yes, rotate/i })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/reason/i), 'rotating a leaked credential');
    expect(armButton).toBeEnabled();

    await userEvent.click(armButton);
    expect(apiClient.post).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /yes, rotate/i }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      '/api/admin/secret-rotation/start',
      expect.objectContaining({ appId: 'a1', reason: 'rotating a leaked credential' }),
    ));
  });

  // C2/I6: the vault key is server-derived. The page used to fall back to a key
  // invented from the display name, which can never match a real vault entry.
  test('sends the server-supplied vaultKey verbatim and never invents one', async () => {
    renderPage(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    const body = apiClient.post.mock.calls[0][1];
    expect(body.vaultKey).toBe('PINGONE_AGENT_CLIENT_SECRET');
    expect(body.vaultKey).not.toBe('DEMO_APP_CLIENT_SECRET');
  });

  // I1: the rotation runs inside the BFF container, which ships no docker CLI
  // and no kubectl — asking for either can only fail.
  test('never asks the server for a container restart or a k8s patch', async () => {
    renderPage(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(apiClient.post.mock.calls[0][1]).toMatchObject({ restart: false, k8s: false });
  });

  // C4: a refused rotation touched nothing — showing the mask claims a secret
  // that was never written.
  test('an aborted run shows no secret mask', async () => {
    arm({ status: 'aborted', lines: ['[rotate] DONE aborted: Refusing to rotate "X".'] });
    renderPage(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    expect(await screen.findByText(/nothing was changed/i)).toBeInTheDocument();
    expect(screen.queryByText('••••••••')).not.toBeInTheDocument();
  });

  test('a completed run shows the mask and the fingerprint', async () => {
    arm({ status: 'done', lines: ['[rotate] rotated. fingerprint=deadbeef', '[rotate] DONE ok'] });
    renderPage(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    expect(await screen.findByText('••••••••')).toBeInTheDocument();
    expect(screen.getByText('deadbeef')).toBeInTheDocument();
  });

  // T6
  test('selecting another app clears the previous run\'s fingerprint and status', async () => {
    arm({ status: 'done', lines: ['[rotate] rotated. fingerprint=deadbeef', '[rotate] DONE ok'] });
    renderPage(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    expect(await screen.findByText('deadbeef')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Other App'));

    expect(screen.queryByText('deadbeef')).not.toBeInTheDocument();
    expect(screen.queryByText('••••••••')).not.toBeInTheDocument();
    expect(screen.queryByText(/rotating…/i)).not.toBeInTheDocument();
  });

  // With 20 rotatable apps in production, a plain button list gave no visual
  // cue which app was selected. A table with a radio + row highlight fixes
  // that; this pins the highlight actually tracking `selected`, not just
  // existing once.
  test('shows a table with the app list, and marks the selected row', async () => {
    renderPage(<SecretRotationPage />);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    const demoRadio = await screen.findByRole('radio', { name: /select demo app/i });
    const otherRadio = screen.getByRole('radio', { name: /select other app/i });
    expect(demoRadio).not.toBeChecked();

    await userEvent.click(screen.getByText('Demo App'));
    expect(demoRadio).toBeChecked();
    expect(otherRadio).not.toBeChecked();
    expect(demoRadio.closest('tr')).toHaveClass('sr-row-selected');
    expect(otherRadio.closest('tr')).not.toHaveClass('sr-row-selected');

    await userEvent.click(otherRadio);
    expect(otherRadio).toBeChecked();
    expect(demoRadio).not.toBeChecked();
    expect(otherRadio.closest('tr')).toHaveClass('sr-row-selected');
  });

  // The app list grew to 20 real apps with long names sharing the column with
  // a UUID clientId — showing the clientId under the name (not e.g. in a
  // tooltip) is what lets an operator tell two similarly-named apps apart
  // without opening each one.
  test('shows each app\'s clientId under its name', async () => {
    renderPage(<SecretRotationPage />);
    expect(await screen.findByText('Demo App')).toBeInTheDocument();
    expect(screen.getByText('c1')).toBeInTheDocument();
    expect(screen.getByText('c2')).toBeInTheDocument();
  });

  // Dragging a header's resize handle should resize that column, not its
  // neighbors — pins the handler keying off the dragged column only.
  test('dragging a column resizer resizes that column and not the others', async () => {
    renderPage(<SecretRotationPage />);
    await screen.findByText('Demo App');
    const table = screen.getByRole('table');
    const appCol = () => table.querySelectorAll('col')[1];
    const authCol = () => table.querySelectorAll('col')[2];
    const startWidth = appCol().style.width;

    fireEvent.mouseDown(screen.getByTestId('sr-col-resizer-app'), { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 360 });
    fireEvent.mouseUp(document);

    expect(appCol().style.width).toBe(`${parseInt(startWidth, 10) + 60}px`);
    expect(authCol().style.width).toBe('160px');
  });

  test('switching the selected app clears an armed rotation for the previous app', async () => {
    renderPage(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo App'));
    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));
    await userEvent.type(screen.getByLabelText(/reason/i), 'rotating a leaked credential');
    await userEvent.click(screen.getByRole('button', { name: /arm rotation/i }));
    expect(screen.getByRole('button', { name: /yes, rotate/i })).toBeInTheDocument();

    await userEvent.click(screen.getByText('Other App'));

    expect(screen.queryByRole('button', { name: /yes, rotate/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /arm rotation/i })).toBeDisabled();
  });

  test('warns specifically about the worker\'s repo-wide blast radius, not the generic per-app warning', async () => {
    renderPage(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo AI App - Introspection Worker'));
    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));

    expect(screen.getByText(/every PingOne-dependent request in the demo fails/i)).toBeInTheDocument();
    expect(screen.queryByText(/every consumer fails until propagation completes/i)).not.toBeInTheDocument();
  });

  test('shows the generic per-app warning for a non-worker app', async () => {
    renderPage(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo App'));
    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));

    expect(screen.getByText(/every consumer fails until propagation completes/i)).toBeInTheDocument();
    expect(screen.queryByText(/every PingOne-dependent request in the demo fails/i)).not.toBeInTheDocument();
  });
});

// Ping UI Standard conversion: banner, cards, chips, one primary per state, focus and honest status.
describe('SecretRotationPage on the Ping UI Standard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arm({ status: 'running', lines: [] });
  });

  const primaries = () => document.querySelectorAll('.pu-btn--primary');

  test('banner is the first child of the page, a note, and says the operation is live', async () => {
    renderPage(<SecretRotationPage />);
    await screen.findByText('Demo App');
    const page = document.querySelector('.pu-page.srot-page');
    expect(page.firstElementChild).toHaveClass('pu-banner-wrap');
    const banner = screen.getByTestId('sr-banner');
    expect(banner).toHaveAttribute('role', 'note');
    expect(banner).toHaveTextContent(/LIVE OPERATION/);
    expect(banner).toHaveTextContent(/nothing here is simulated/);
    expect(banner).toHaveTextContent(/signed-in session/);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  test('exactly one primary per view state: none, the page button, then the dialog control', async () => {
    renderPage(<SecretRotationPage />);
    await screen.findByText('Demo App');
    expect(primaries()).toHaveLength(0); // nothing selected, no action

    await userEvent.click(screen.getByText('Demo App'));
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0]).toHaveTextContent('Rotate secret');

    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));
    expect(primaries()).toHaveLength(0); // the page button steps down to a secondary
    expect(document.querySelectorAll('.srot-modal-btn--confirm')).toHaveLength(1);
  });

  test('the confirm dialog takes focus on the reason field and gives it back to Rotate secret after submit', async () => {
    renderPage(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo App'));
    const rotateBtn = screen.getByRole('button', { name: /rotate secret/i });
    await userEvent.click(rotateBtn);
    await waitFor(() => expect(screen.getByLabelText(/reason/i)).toHaveFocus());

    await userEvent.type(screen.getByLabelText(/reason/i), 'rotating a leaked credential');
    await userEvent.click(screen.getByRole('button', { name: /arm rotation/i }));
    const yes = screen.getByRole('button', { name: /yes, rotate/i });
    await userEvent.click(yes);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /rotate secret/i })).toHaveFocus();
  });

  test('while a run is going Rotate secret is aria-disabled (still focusable), refuses a click and explains why', async () => {
    renderPage(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    const btn = await screen.findByRole('button', { name: /rotate secret/i });
    await waitFor(() => expect(btn).toHaveAttribute('aria-disabled', 'true'));
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute('aria-describedby', 'sr-run-status');
    expect(screen.getByTestId('sr-run-status')).toHaveTextContent(/second run is blocked/i);

    await userEvent.click(btn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('the run status region exists before the run and carries a chip word that follows the status', async () => {
    arm({ status: 'done', lines: ['[rotate] rotated. fingerprint=deadbeef', '[rotate] DONE ok'] });
    renderPage(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo App'));
    const region = screen.getByTestId('sr-run-status');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveTextContent('Not run');
    expect(screen.getByTestId('sr-run-card')).toHaveClass('pu-card--neutral');

    await userEvent.click(screen.getByRole('button', { name: /rotate secret/i }));
    await userEvent.type(screen.getByLabelText(/reason/i), 'why');
    await userEvent.click(screen.getByRole('button', { name: /arm rotation/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, rotate/i }));
    await waitFor(() => expect(screen.getByTestId('sr-run-status')).toHaveTextContent('Rotated'));
    expect(screen.getByTestId('sr-run-card')).toHaveClass('pu-card--ok');
  });

  test.each([
    ['aborted', ['[rotate] DONE aborted: refused'], 'Refused', 'pu-card--warn'],
    ['failed', ['[rotate] DONE failed: boom'], 'Failed', 'pu-card--danger'],
  ])('a %s run shows the %s chip, no secret mask, and no claim that is not known', async (status, lines, word, card) => {
    arm({ status, lines });
    renderPage(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    await waitFor(() => expect(screen.getByTestId('sr-run-status')).toHaveTextContent(word));
    expect(screen.getByTestId('sr-run-card')).toHaveClass(card);
    expect(screen.queryByText('••••••••')).not.toBeInTheDocument();
    if (status === 'failed') {
      expect(screen.getByTestId('sr-run-status')).toHaveTextContent(/may already have been rotated/i);
      expect(screen.getByTestId('sr-run-status')).not.toHaveTextContent(/after the secret was rotated/i);
    }
  });

  test('a failed application list says so instead of reading as an empty list', async () => {
    apiClient.get.mockImplementation(() => Promise.reject(new Error('Request failed with status code 502')));
    renderPage(<SecretRotationPage />);
    expect(await screen.findByText(/application list could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no application has a rotatable vault entry/i)).not.toBeInTheDocument();
    expect(screen.getByText('Application list unavailable')).toBeInTheDocument();
  });

  test('an empty list is reported as empty, and the count reads from what was loaded', async () => {
    apiClient.get.mockImplementation(() => Promise.resolve({ data: { apps: [] } }));
    renderPage(<SecretRotationPage />);
    expect(await screen.findByText(/no application has a rotatable vault entry/i)).toBeInTheDocument();
    expect(screen.getByText('0 rotatable applications')).toBeInTheDocument();
  });

  test('with nothing selected the middle column says what to do', async () => {
    renderPage(<SecretRotationPage />);
    await screen.findByText('Demo App');
    expect(screen.getByText(/select an application to rotate/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /rotation log/i })).toHaveAttribute('tabindex', '0');
  });

  test('choosing the application that is already selected does not wipe its run', async () => {
    arm({ status: 'done', lines: ['[rotate] rotated. fingerprint=deadbeef', '[rotate] DONE ok'] });
    renderPage(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    expect(await screen.findByText('deadbeef')).toBeInTheDocument();

    // The row, its radio and its name button all select: re-choosing must be a no-op.
    await userEvent.click(screen.getByRole('radio', { name: /select demo app/i }));
    await userEvent.click(screen.getAllByText('Demo App')[0]);
    expect(screen.getByText('deadbeef')).toBeInTheDocument();
  });

  // Wave 4 lesson 4: one shared result state leaked across steps. A POST that lands after another application was chosen
  // must not put its fingerprint under the new one.
  test('a run that starts after another application was selected does not leak into it', async () => {
    let release;
    arm({ status: 'done', lines: ['[rotate] rotated. fingerprint=deadbeef', '[rotate] DONE ok'] });
    apiClient.post.mockImplementation(() => new Promise((res) => { release = () => res({ data: { runId: '11111111-1111-1111-1111-111111111111' } }); }));

    renderPage(<SecretRotationPage />);
    await rotate(userEvent, 'Demo App');
    await userEvent.click(screen.getByText('Other App'));
    release();
    await new Promise((r) => { setTimeout(r, 50); });

    expect(screen.queryByText('deadbeef')).not.toBeInTheDocument();
    expect(screen.getByTestId('sr-run-status')).toHaveTextContent('Not run');
    const polls = apiClient.get.mock.calls.filter(([u]) => u.includes('/runs/'));
    expect(polls).toHaveLength(0);
  });

  test('a worker credential is marked with a chip, not by colour alone', async () => {
    renderPage(<SecretRotationPage />);
    await userEvent.click(await screen.findByText('Demo AI App - Introspection Worker'));
    expect(screen.getByText('Worker credential')).toHaveClass('pu-chip');
  });
});
