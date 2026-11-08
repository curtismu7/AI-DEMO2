/**
 * Ping UI Standard behaviour of /scope-audit: honest banner first, exactly one primary button per
 * view state (and it is the same element, so keyboard focus survives), aria-disabled instead of
 * disabled while PingOne is being written to, an announced outcome, and focus handed to a real
 * control when the one that was pressed disappears.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ScopeAuditPage from '../ScopeAuditPage';

vi.mock('../CapabilityCallout', () => ({ default: () => null }));
vi.mock('../../utils/appToast', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

const mkResource = (id, missing = []) => ({
  id,
  name: `Resource ${id}`,
  audience: `https://${id}.example`,
  type: 'CUSTOM',
  scopes: [{ id: 's0', name: 'read' }],
  expected: {
    allRequiredPresent: missing.length === 0,
    requiredScopes: ['read', ...missing],
    optionalScopes: [],
    missingRequired: missing,
    missingOptional: [],
  },
});

function stubApi({ resources, status = 200, error, failScope } = {}) {
  let current = resources;
  const posts = [];
  global.fetch = vi.fn((url, opts) => {
    if (String(url).includes('/scope-audit/scopes') && opts?.method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push(body);
      if (body.scopeName === failScope) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) });
      }
      current = current.map((r) => {
        if (r.id !== body.resourceId) return r;
        const missing = r.expected.missingRequired.filter((s) => s !== body.scopeName);
        return {
          ...r,
          scopes: [...r.scopes, { id: `n-${body.scopeName}`, name: body.scopeName }],
          expected: { ...r.expected, missingRequired: missing, allRequiredPresent: missing.length === 0 },
        };
      });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(error ? { error } : { resources: current, environment: 'env-live-123', region: 'eu' }),
    });
  });
  return { posts };
}

const primaries = (c) => c.querySelectorAll('.pu-btn--primary');
const run = async () => {
  fireEvent.click(screen.getByRole('button', { name: /run audit/i }));
  await waitFor(() => expect(screen.getByTestId('scope-audit-primary').getAttribute('aria-disabled')).toBeNull());
};

describe('ScopeAuditPage, Ping UI Standard', () => {
  afterEach(() => { delete global.fetch; });

  it('puts the honest banner first and names the environment only once the BFF has answered', async () => {
    stubApi({ resources: [mkResource('a', ['write'])] });
    const { container } = render(<ScopeAuditPage />);
    const page = container.querySelector('.pu-page.scope-audit-page');
    const banner = page.firstElementChild.querySelector('[role="note"]');
    expect(page.firstElementChild.className).toContain('pu-banner-wrap');
    expect(banner).toHaveTextContent(/nothing has been read from pingone yet/i);
    expect(banner).toHaveTextContent(/nothing on this page is simulated/i);
    expect(banner.textContent).not.toMatch(/env-live-123/);
    await run();
    expect(screen.getByTestId('scope-audit-banner')).toHaveTextContent(/live data/i);
    expect(screen.getByTestId('scope-audit-banner')).toHaveTextContent(/env-live-123/);
    expect(screen.getByTestId('scope-audit-banner')).toHaveTextContent(/region eu/i);
  });

  it('has exactly one primary in each view state', async () => {
    stubApi({ resources: [mkResource('a', ['write'])] });
    const first = render(<ScopeAuditPage />);
    expect(primaries(first.container)).toHaveLength(1); // idle: Run Audit
    await run();
    expect(primaries(first.container)).toHaveLength(1); // missing: Fix All Missing
    expect(screen.getByTestId('scope-audit-primary')).toHaveTextContent(/fix all missing \(1\)/i);
    expect(screen.getByTestId('scope-audit-refresh').className).not.toContain('pu-btn--primary');
    first.unmount();

    stubApi({ resources: [mkResource('a')] });
    const clean = render(<ScopeAuditPage />);
    await run();
    expect(primaries(clean.container)).toHaveLength(1); // nothing missing: Refresh audit is the primary
    expect(screen.getByTestId('scope-audit-primary')).toHaveTextContent(/refresh audit/i);
    expect(screen.queryByTestId('scope-audit-refresh')).toBeNull();
    expect(screen.getByTestId('scope-audit-status')).toHaveTextContent(/all required present/i);
    clean.unmount();

    stubApi({ status: 502, error: 'upstream timeout' });
    const failed = render(<ScopeAuditPage />);
    fireEvent.click(screen.getByRole('button', { name: /run audit/i }));
    await screen.findByText(/failed to connect to pingone/i);
    expect(primaries(failed.container)).toHaveLength(1); // failed: Retry audit
    expect(screen.getByTestId('scope-audit-primary')).toHaveTextContent(/retry audit/i);
    expect(screen.getByTestId('scope-audit-banner')).toHaveTextContent(/no resources or scopes are shown/i);
    failed.unmount();

    stubApi({ status: 403, error: 'insufficient_scope' });
    const signedOut = render(<ScopeAuditPage />);
    fireEvent.click(screen.getByRole('button', { name: /run audit/i }));
    await screen.findByText(/admin sign-in required/i);
    expect(primaries(signedOut.container)).toHaveLength(0); // the sign-in prompt is the one call to action
    expect(screen.getByTestId('scope-audit-banner')).toHaveTextContent(/no audit data is shown/i);
  });

  it('keeps one primary element (and its focus) from Run Audit through the results', async () => {
    stubApi({ resources: [mkResource('a', ['write'])] });
    render(<ScopeAuditPage />);
    const btn = screen.getByTestId('scope-audit-primary');
    btn.focus();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-disabled')).toBe('true'); // running: aria-disabled, never disabled
    expect(btn.disabled).toBe(false);
    await waitFor(() => expect(btn).toHaveTextContent(/fix all missing/i));
    expect(screen.getByTestId('scope-audit-primary')).toBe(btn);
    expect(document.activeElement).toBe(btn);
  });

  it('ignores a second press while scopes are being created, and announces the outcome', async () => {
    const { posts } = stubApi({ resources: [mkResource('a', ['write', 'admin'])] });
    render(<ScopeAuditPage />);
    await run();
    const btn = screen.getByTestId('scope-audit-primary');
    btn.focus();
    fireEvent.click(btn);
    fireEvent.click(btn); // busy: must be ignored
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    await waitFor(() => expect(screen.getByTestId('scope-audit-fix-note')).toBeInTheDocument());
    expect(posts).toHaveLength(2);
    expect(screen.getByTestId('scope-audit-fix-note')).toHaveTextContent(/created 2 scopes in pingone\./i);
    expect(screen.getByTestId('scope-audit-fix-note').getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(btn);
    expect(btn).toHaveTextContent(/refresh audit/i);
  });

  it('says so when a scope could not be created', async () => {
    stubApi({ resources: [mkResource('a', ['write', 'admin'])], failScope: 'admin' });
    render(<ScopeAuditPage />);
    await run();
    fireEvent.click(screen.getByTestId('scope-audit-primary'));
    await waitFor(() => expect(screen.getByTestId('scope-audit-fix-note')).toBeInTheDocument());
    expect(screen.getByTestId('scope-audit-fix-note')).toHaveTextContent(/created 1 scope in pingone, 1 failed/i);
  });

  it('makes the resource header a real toggle button with aria-expanded', async () => {
    stubApi({ resources: [mkResource('a'), mkResource('b', ['write'])] });
    render(<ScopeAuditPage />);
    await run();
    const a = screen.getByRole('button', { name: /^resource a/i });
    const b = screen.getByRole('button', { name: /^resource b/i });
    expect(a.getAttribute('aria-expanded')).toBe('false'); // fine: closed
    expect(b.getAttribute('aria-expanded')).toBe('true'); // missing scopes: open
    fireEvent.click(a);
    expect(a.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(a.getAttribute('aria-controls'))).not.toBeNull();
  });

  it('hands focus to the resource header when the pressed Add button disappears', async () => {
    stubApi({ resources: [mkResource('b', ['write'])] });
    render(<ScopeAuditPage />);
    await run();
    const add = screen.getByRole('button', { name: /add scope write to resource b/i });
    add.focus();
    await act(async () => { fireEvent.click(add); });
    await waitFor(() => expect(screen.queryByRole('button', { name: /add scope write/i })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^resource b/i })));
    expect(screen.getByTestId('scope-audit-fix-note')).toHaveTextContent(/created scope write/i);
  });

  it('shows no rows from an earlier audit once a re-audit fails', async () => {
    stubApi({ resources: [mkResource('a', ['write'])] });
    render(<ScopeAuditPage />);
    await run();
    expect(screen.getByText('Resource a')).toBeInTheDocument();
    stubApi({ status: 502, error: 'upstream timeout' });
    fireEvent.click(screen.getByTestId('scope-audit-refresh'));
    await screen.findByText(/failed to connect to pingone/i);
    expect(screen.queryByText('Resource a')).toBeNull();
  });

  it('uses the page-prefixed classes only (the old scope-table names collided with another page)', async () => {
    stubApi({ resources: [mkResource('a', ['write'])] });
    const { container } = render(<ScopeAuditPage />);
    await run();
    expect(container.querySelector('.scopeaudit-table')).not.toBeNull();
    expect(container.querySelector('.scope-table')).toBeNull();
    expect(container.querySelector('.scope-audit-btn')).toBeNull();
    expect(container.querySelector('table').getAttribute('aria-label')).toBe('Scopes on Resource a');
    expect(container.querySelectorAll('td[data-label]').length).toBeGreaterThan(0);
  });
});
