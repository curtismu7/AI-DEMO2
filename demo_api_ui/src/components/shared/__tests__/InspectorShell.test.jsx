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

    expect(JSON.parse(window.localStorage.getItem('inspector-shell-panel-widths'))).toEqual({
      left: 320,
      middle: 380,
    });

    unmount();
    const { container: container2 } = render(<InspectorShell title="X" />);
    expect(container2.querySelector('.inspector-shell-grid').style.gridTemplateColumns).toBe(
      '320px 6px 380px 6px 1fr',
    );
  });
});
