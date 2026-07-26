// demo_api_ui/src/components/shared/__tests__/InspectorListItem.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InspectorListItem from '../InspectorListItem';

describe('InspectorListItem', () => {
  it('renders the label', () => {
    render(<InspectorListItem label="get_account_balance" />);
    expect(screen.getByText('get_account_balance')).toBeInTheDocument();
  });

  it('applies the active modifier class when active', () => {
    const { rerender } = render(<InspectorListItem label="x" active={false} />);
    expect(screen.getByRole('button')).not.toHaveClass('inspector-shell-tree-item--active');

    rerender(<InspectorListItem label="x" active />);
    expect(screen.getByRole('button')).toHaveClass('inspector-shell-tree-item--active');
  });

  it('applies the correct dot modifier class', () => {
    const { container, rerender } = render(<InspectorListItem label="x" dot="write" />);
    expect(container.querySelector('.inspector-shell-tree-item__dot')).toHaveClass(
      'inspector-shell-tree-item__dot--write',
    );

    rerender(<InspectorListItem label="x" dot="sensitive" />);
    expect(container.querySelector('.inspector-shell-tree-item__dot')).toHaveClass(
      'inspector-shell-tree-item__dot--sensitive',
    );

    rerender(<InspectorListItem label="x" dot="default" />);
    const dot = container.querySelector('.inspector-shell-tree-item__dot');
    expect(dot).not.toHaveClass('inspector-shell-tree-item__dot--write');
    expect(dot).not.toHaveClass('inspector-shell-tree-item__dot--sensitive');
  });

  it('renders both badges when a tool is both write and sensitive', () => {
    render(<InspectorListItem label="delete_user" badges={['write', 'sensitive']} />);
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
  });

  it('renders no badges by default', () => {
    render(<InspectorListItem label="get_account_balance" />);
    expect(screen.queryByText('W')).toBeNull();
    expect(screen.queryByText('S')).toBeNull();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<InspectorListItem label="x" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a round dot by default (kind="step")', () => {
    const { container } = render(<InspectorListItem label="get_accounts" onClick={() => {}} />);
    expect(container.querySelector('.inspector-shell-tree-item__dot')).toBeInTheDocument();
    expect(container.querySelector('.inspector-shell-tree-item__token-icon')).toBeNull();
  });

  it('renders a token icon instead of a dot when kind="token"', () => {
    const { container } = render(
      <InspectorListItem label="Exchanged Access Token" kind="token" onClick={() => {}} />
    );
    expect(container.querySelector('.inspector-shell-tree-item__token-icon')).toBeInTheDocument();
    expect(container.querySelector('.inspector-shell-tree-item__dot')).toBeNull();
  });

  it('colors the token icon using the dot prop, same palette as step dots', () => {
    const { container } = render(
      <InspectorListItem label="Denied step token" kind="token" dot="sensitive" onClick={() => {}} />
    );
    expect(
      container.querySelector('.inspector-shell-tree-item__token-icon--sensitive')
    ).toBeInTheDocument();
  });

  it('still fires onClick and applies the active class for both kinds', () => {
    const onClick = vi.fn();
    render(<InspectorListItem label="x" kind="token" active onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button')).toHaveClass('inspector-shell-tree-item--active');
  });
});
