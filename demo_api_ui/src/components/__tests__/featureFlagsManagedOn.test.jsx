import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlagCard } from '../FeatureFlagsPage';

/**
 * ff_weather_mcp_allowed_state is only half a control on its own: the mode
 * 'any-except-blocked' is meaningless without the deny list edited beside it on
 * the Weather MCP page. Offering a bare dropdown on the flags page invites
 * setting a mode whose city list you cannot see from there.
 *
 * So a flag carrying `managedOn` shows its VALUE plus a link, and no control.
 * These go RED if the flags page starts offering a second place to set it.
 */
const MANAGED = {
  id: 'ff_weather_mcp_allowed_state',
  name: 'Weather MCP — Allowed State',
  category: 'MCP / Agent',
  description: 'Which region the gateway allows.',
  type: 'enum',
  value: 'texas',
  options: ['texas', 'michigan', 'any', 'any-except-blocked'],
  managedOn: { path: '/weather-mcp', label: 'Weather MCP page' },
};

const PLAIN_ENUM = { ...MANAGED, managedOn: undefined };

describe('FlagCard managedOn', () => {
  it('links to the owning page instead of rendering a control', () => {
    render(<FlagCard flag={MANAGED} onToggle={vi.fn()} saving={null} />);

    const link = screen.getByRole('link', { name: /Weather MCP page/ });
    expect(link).toHaveAttribute('href', '/weather-mcp');
    // The control must be gone, not merely hidden behind the link.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still shows the current value, so the flags page stays a full inventory', () => {
    render(<FlagCard flag={MANAGED} onToggle={vi.fn()} saving={null} />);
    expect(screen.getByText('TEXAS')).toBeInTheDocument();
  });

  it('an enum WITHOUT managedOn keeps its dropdown', () => {
    // Guards the obvious over-correction: managedOn must not suppress every enum.
    render(<FlagCard flag={PLAIN_ENUM} onToggle={vi.fn()} saving={null} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
