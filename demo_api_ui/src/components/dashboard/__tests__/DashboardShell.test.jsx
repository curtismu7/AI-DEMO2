import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../../../context/ThemeContext';
import DashboardShell from '../DashboardShell';
import StatStrip from '../StatStrip';
import EventStream from '../EventStream';

const WINDOWS = ['30m', '1h', '24h', '7d'];

function shell(props = {}) {
  return render(
    <ThemeProvider>
      <DashboardShell
        title="Test"
        subtitle="sub"
        window="24h"
        windows={WINDOWS}
        onWindow={() => {}}
        onRefresh={() => {}}
        state="ready"
        {...props}
      >
        <p>body</p>
      </DashboardShell>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('DashboardShell', () => {
  it('offers every window including 7d', () => {
    shell();
    WINDOWS.forEach((w) =>
      expect(screen.getByRole('button', { name: w })).toBeInTheDocument());
  });

  it('marks the selected window pressed', () => {
    shell({ window: '7d' });
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders children only when ready', () => {
    shell({ state: 'loading' });
    expect(screen.queryByText('body')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('shows the not-configured hint on unconfigured, not an error', () => {
    shell({ state: 'unconfigured', notConfiguredHint: 'set NR_USER_API_KEY' });
    expect(screen.getByText(/set NR_USER_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an alert on error', () => {
    shell({ state: 'error' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('toggles the shared app theme', async () => {
    shell();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    screen.getByRole('switch', { name: /dark mode/i }).click();
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
  });
});

describe('StatStrip', () => {
  it('renders each item with its value and testid', () => {
    render(<StatStrip items={[
      { key: 'permit', label: 'PERMIT', value: 3 },
      { key: 'deny', label: 'DENY', value: 5, tone: 'bad' },
    ]} />);
    expect(screen.getByTestId('stat-permit')).toHaveTextContent('3');
    expect(screen.getByTestId('stat-deny')).toHaveTextContent('5');
  });

  it('renders a zero item rather than hiding it', () => {
    render(<StatStrip items={[{ key: 'failopen', label: 'fail-open', value: 0 }]} />);
    expect(screen.getByTestId('stat-failopen')).toHaveTextContent('0');
  });
});

describe('EventStream', () => {
  it('renders a row per record using the column keys', () => {
    render(<EventStream
      columns={[{ key: 'decision', label: 'Decision' }, { key: 'amount', label: 'Amount' }]}
      rows={[{ decision: 'DENY', amount: 60000 }]}
    />);
    expect(screen.getByText('DENY')).toBeInTheDocument();
    expect(screen.getByText('60000')).toBeInTheDocument();
  });

  it('renders an empty message when there are no rows', () => {
    render(<EventStream columns={[{ key: 'a', label: 'A' }]} rows={[]} />);
    expect(screen.getByText(/no events/i)).toBeInTheDocument();
  });
});

// jsdom does not apply stylesheets — static check, guarding the #1484 regression
// where a component set color but no background and went unreadable in dark mode.
describe('dashboard.css theme grounds', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../dashboard.css'), 'utf8');

  it('paints its own ground', () => {
    expect(css).toMatch(/background:\s*var\(--dash-ground\)/);
  });

  it('defines --dash-ground in both themes with different values', () => {
    const light = css.match(/\.dash\s*\{[^}]*--dash-ground:\s*(#[0-9a-f]{3,8})/i);
    const dark = css.match(/\[data-theme="dark"\][^{]*\{[^}]*--dash-ground:\s*(#[0-9a-f]{3,8})/i);
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
    expect(light[1].toLowerCase()).not.toBe(dark[1].toLowerCase());
  });
});
