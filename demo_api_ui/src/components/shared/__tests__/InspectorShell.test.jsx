// demo_api_ui/src/components/shared/__tests__/InspectorShell.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InspectorShell from '../InspectorShell';

describe('InspectorShell', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

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

  it('applies the embedded grid modifier only when fullHeight is false', () => {
    const { container, rerender } = render(<InspectorShell title="X" />);
    expect(container.querySelector('.inspector-shell-grid')).not.toHaveClass(
      'inspector-shell-grid--embedded',
    );

    rerender(<InspectorShell title="X" fullHeight={false} />);
    expect(container.querySelector('.inspector-shell-grid')).toHaveClass(
      'inspector-shell-grid--embedded',
    );
  });

  it('applies the fill grid modifier when fullHeight="fill"', () => {
    const { container } = render(<InspectorShell title="X" fullHeight="fill" />);
    const grid = container.querySelector('.inspector-shell-grid');
    expect(grid).toHaveClass('inspector-shell-grid--fill');
    expect(grid).not.toHaveClass('inspector-shell-grid--embedded');
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

  it('renders banner content between the topbar and the grid when provided', () => {
    const { container } = render(
      <InspectorShell title="X" banner={<div data-testid="banner-content">banner</div>} />,
    );
    const topbar = container.querySelector('.inspector-shell-topbar');
    const banner = screen.getByTestId('banner-content');
    const grid = container.querySelector('.inspector-shell-grid');
    expect(topbar.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no extra element when banner is not provided', () => {
    const { container } = render(<InspectorShell title="X" />);
    expect(container.querySelector('.inspector-shell-page').children).toHaveLength(2);
  });

  it('defaults the grid to 240px/380px columns plus two resize-handle tracks', () => {
    const { container } = render(<InspectorShell title="X" />);
    expect(container.querySelector('.inspector-shell-grid').style.gridTemplateColumns).toBe(
      '240px 6px 380px 6px 1fr',
    );
    expect(container.querySelectorAll('.inspector-shell-resize-handle')).toHaveLength(2);
  });

  it('dragging the left resize handle updates the left column width', () => {
    const { container } = render(<InspectorShell title="X" />);
    const [leftHandle] = container.querySelectorAll('.inspector-shell-resize-handle');
    const grid = container.querySelector('.inspector-shell-grid');

    fireEvent.mouseDown(leftHandle, { clientX: 240 });
    fireEvent.mouseMove(document, { clientX: 300 });
    fireEvent.mouseUp(document);

    expect(grid.style.gridTemplateColumns).toBe('300px 6px 380px 6px 1fr');
  });

  it('dragging the middle resize handle updates the middle column width', () => {
    const { container } = render(<InspectorShell title="X" />);
    const middleHandle = container.querySelectorAll('.inspector-shell-resize-handle')[1];
    const grid = container.querySelector('.inspector-shell-grid');

    fireEvent.mouseDown(middleHandle, { clientX: 620 });
    fireEvent.mouseMove(document, { clientX: 570 });
    fireEvent.mouseUp(document);

    expect(grid.style.gridTemplateColumns).toBe('240px 6px 330px 6px 1fr');
  });

  it('clamps a drag past the minimum width', () => {
    const { container } = render(<InspectorShell title="X" />);
    const [leftHandle] = container.querySelectorAll('.inspector-shell-resize-handle');
    const grid = container.querySelector('.inspector-shell-grid');

    fireEvent.mouseDown(leftHandle, { clientX: 240 });
    fireEvent.mouseMove(document, { clientX: -1000 });
    fireEvent.mouseUp(document);

    expect(grid.style.gridTemplateColumns).toBe('160px 6px 380px 6px 1fr');
  });

  it('persists widths to localStorage after a drag ends, and restores them on next mount', () => {
    const { container, unmount } = render(<InspectorShell title="X" />);
    const [leftHandle] = container.querySelectorAll('.inspector-shell-resize-handle');

    fireEvent.mouseDown(leftHandle, { clientX: 240 });
    fireEvent.mouseMove(document, { clientX: 320 });
    fireEvent.mouseUp(document);

    // Per-column keys since the drag logic converged on useDividerDrag; the
    // middle key is only written when its own divider is dragged.
    expect(window.localStorage.getItem('inspector-shell-left-width')).toBe('320');

    unmount();
    const { container: container2 } = render(<InspectorShell title="X" />);
    expect(container2.querySelector('.inspector-shell-grid').style.gridTemplateColumns).toBe(
      '320px 6px 380px 6px 1fr',
    );
  });

  it('renders a left-collapse toggle button only when a left prop is provided', () => {
    const { rerender } = render(<InspectorShell title="X" left={<div>tools</div>} />);
    expect(screen.getByRole('button', { name: 'Hide tools' })).toBeInTheDocument();

    rerender(<InspectorShell title="X" />);
    expect(screen.queryByRole('button', { name: /tools/i })).toBeNull();
  });

  it('toggles the button label and aria-expanded when clicked', () => {
    render(<InspectorShell title="X" left={<div>tools</div>} />);
    const button = screen.getByRole('button', { name: 'Hide tools' });
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Show tools' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show tools' }));
    expect(screen.getByRole('button', { name: 'Hide tools' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('persists the collapsed state to its own localStorage key, independent of widths', () => {
    const { unmount } = render(<InspectorShell title="X" left={<div>tools</div>} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide tools' }));

    expect(window.localStorage.getItem('inspector-shell-left-collapsed')).toBe('true');
    expect(window.localStorage.getItem('inspector-shell-panel-widths')).toBeNull();

    unmount();
    render(<InspectorShell title="X" left={<div>tools</div>} />);
    expect(screen.getByRole('button', { name: 'Show tools' })).toBeInTheDocument();
  });

  it('zeroes the left column and its handle track when collapsed, and restores a dragged width on expand', () => {
    const { container } = render(<InspectorShell title="X" left={<div>tools</div>} />);
    const [leftHandle] = container.querySelectorAll('.inspector-shell-resize-handle');
    const grid = container.querySelector('.inspector-shell-grid');

    fireEvent.mouseDown(leftHandle, { clientX: 240 });
    fireEvent.mouseMove(document, { clientX: 300 });
    fireEvent.mouseUp(document);
    expect(grid.style.gridTemplateColumns).toBe('300px 6px 380px 6px 1fr');

    fireEvent.click(screen.getByRole('button', { name: 'Hide tools' }));
    expect(grid.style.gridTemplateColumns).toBe('0px 0px 380px 6px 1fr');

    fireEvent.click(screen.getByRole('button', { name: 'Show tools' }));
    expect(grid.style.gridTemplateColumns).toBe('300px 6px 380px 6px 1fr');
  });

  it('hides the left column from assistive tech and applies the collapsed modifier class, without unmounting its content', () => {
    const { container } = render(
      <InspectorShell title="X" left={<div data-testid="left-content">tools</div>} />,
    );
    const leftCol = container.querySelector('.inspector-shell-col-left');
    expect(leftCol).not.toHaveClass('inspector-shell-col-left--collapsed');
    expect(leftCol).not.toHaveAttribute('aria-hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Hide tools' }));

    expect(leftCol).toHaveClass('inspector-shell-col-left--collapsed');
    expect(leftCol).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('left-content')).toBeInTheDocument();
  });

  it('marks the left resize handle inert while collapsed without removing it from the DOM', () => {
    const { container } = render(<InspectorShell title="X" left={<div>tools</div>} />);
    const [leftHandle] = container.querySelectorAll('.inspector-shell-resize-handle');
    expect(leftHandle).not.toHaveAttribute('aria-hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Hide tools' }));

    expect(container.querySelectorAll('.inspector-shell-resize-handle')).toHaveLength(2);
    expect(leftHandle).toHaveAttribute('aria-hidden', 'true');
    expect(leftHandle).toHaveStyle({ pointerEvents: 'none' });
  });
});
