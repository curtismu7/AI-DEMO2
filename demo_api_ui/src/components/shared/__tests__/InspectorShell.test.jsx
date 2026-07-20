// demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import InspectorShell from '../InspectorShell';

describe('InspectorShell', () => {
  it('renders the title and status text', () => {
    render(
      <InspectorShell title="MCP Inspector" statusText="Connected · banking-mcp" />
    );
    expect(screen.getByRole('heading', { name: 'MCP Inspector' })).toBeInTheDocument();
    expect(screen.getByText('Connected · banking-mcp')).toBeInTheDocument();
  });

  it('renders the status dot as "on" by default and toggles "off"', () => {
    const { container, rerender } = render(<InspectorShell title="X" />);
    const dot = container.querySelector('.inspector-shell-topbar__dot');
    expect(dot).not.toHaveClass('inspector-shell-topbar__dot--off');

    rerender(<InspectorShell title="X" statusOn={false} />);
    expect(container.querySelector('.inspector-shell-topbar__dot')).toHaveClass(
      'inspector-shell-topbar__dot--off',
    );
  });

  it('renders actions in the topbar when provided', () => {
    render(<InspectorShell title="X" actions={<button type="button">Refresh</button>} />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('omits the actions wrapper when no actions are provided', () => {
    const { container } = render(<InspectorShell title="X" />);
    expect(container.querySelector('.inspector-shell-topbar__right')).toBeNull();
  });

  it('renders left/middle/right slot content in the correct grid columns', () => {
    const { container } = render(
      <InspectorShell
        title="X"
        left={<div data-testid="left-content">left</div>}
        middle={<div data-testid="middle-content">middle</div>}
        right={<div data-testid="right-content">right</div>}
      />,
    );
    expect(
      container.querySelector('.inspector-shell-col-left')?.contains(screen.getByTestId('left-content')),
    ).toBe(true);
    expect(
      container.querySelector('.inspector-shell-col-middle')?.contains(screen.getByTestId('middle-content')),
    ).toBe(true);
    expect(
      container.querySelector('.inspector-shell-col-right')?.contains(screen.getByTestId('right-content')),
    ).toBe(true);
  });
});
