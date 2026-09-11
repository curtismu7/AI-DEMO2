import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import ActivityPanel from '../ActivityPanel';

const hop = (n, extra = {}) => ({
  stepId: `step-${n}`,
  request: { method: 'POST', url: `/api/demo/hop-${n}`, body: { n } },
  response: { status: 200, statusText: 'OK', body: { ok: n } },
  decodedToken: null,
  ...extra,
});

const rowFor = (n, scope = screen) =>
  scope.getByRole('button', { name: new RegExp(`POST /api/demo/hop-${n}\\b`) });

describe('ActivityPanel — compact token chain', () => {
  test('only the newest hop is open; opening another closes it', () => {
    render(<ActivityPanel results={[hop(1), hop(2)]} error={null} />);

    expect(rowFor(1)).toHaveAttribute('aria-expanded', 'false');
    expect(rowFor(2)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    // No token was decoded, so the detail opens on Request and offers no Token tab.
    expect(screen.queryByRole('tab', { name: 'Token' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Request' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(rowFor(1));
    expect(rowFor(1)).toHaveAttribute('aria-expanded', 'true');
    expect(rowFor(2)).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(rowFor(1));
    expect(screen.queryAllByRole('tabpanel')).toHaveLength(0);
  });

  test('re-running a step adds its own row; only that newest run is open', () => {
    // The engine appends a second result with the same stepId on a re-run.
    render(<ActivityPanel results={[hop(1), hop(2), hop(1)]} error={null} />);

    const rows = screen.getAllByRole('button', { name: /POST \/api\/demo\/hop-1\b/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('aria-expanded', 'false');
    expect(rows[1]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  test('a decoded token opens on the Token tab; tabs switch the detail', () => {
    const decodedToken = { isValid: true, payload: { sub: 'user-1', act: { sub: 'client-app' } } };
    render(<ActivityPanel results={[hop(1, { decodedToken })]} error={null} />);

    expect(screen.getByRole('tab', { name: 'Token' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tabpanel')).getByText('"client-app"')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Request' }));
    expect(within(screen.getByRole('tabpanel')).getByText('"/api/demo/hop-1"')).toBeInTheDocument();
  });

  test('Pop out opens the chain in a draggable window', () => {
    render(<ActivityPanel results={[hop(1)]} error={null} />);

    fireEvent.click(screen.getByRole('button', { name: /Pop out/ }));

    const win = document.querySelector('.dm-panel .pp-chain-window');
    expect(win).not.toBeNull();
    expect(rowFor(1, within(win))).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Pop out/ })).toBeDisabled();
  });
});

describe('ActivityPanel — sign-in prompt on 401', () => {
  test('shows a Sign in link when a step result is a 401', () => {
    render(
      <ActivityPanel
        results={[{ stepId: 'step-1', response: { status: 401, body: {} } }]}
        error="Missing value for :authReqId — the step that provides it did not complete successfully."
      />
    );

    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/api/auth/oauth/user/login?return_to=/protocol-playground');
  });

  test('does not show a Sign in link for a non-401 error', () => {
    render(
      <ActivityPanel
        results={[{ stepId: 'step-1', response: { status: 500, body: {} } }]}
        error="Backend error"
      />
    );

    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  test('does not show a Sign in link when there is no error', () => {
    render(
      <ActivityPanel
        results={[{ stepId: 'step-1', response: { status: 401, body: {} } }]}
        error={null}
      />
    );

    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
