import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InspectorReplayBar from '../InspectorReplayBar';

describe('InspectorReplayBar', () => {
  it('renders step, denied, and token counts', () => {
    render(<InspectorReplayBar stepCount={6} deniedCount={1} tokenCount={3} />);
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('applies the warn style only when deniedCount > 0', () => {
    const { container, rerender } = render(<InspectorReplayBar deniedCount={0} />);
    expect(container.querySelector('.inspector-shell-replay-bar__item--warn')).toBeNull();

    rerender(<InspectorReplayBar deniedCount={2} />);
    expect(container.querySelector('.inspector-shell-replay-bar__item--warn')).toBeInTheDocument();
  });

  it('fires onPrev, onNext, and onClear from their respective buttons', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onClear = vi.fn();
    render(<InspectorReplayBar onPrev={onPrev} onNext={onNext} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /Prev/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('disables Clear when clearDisabled is true', () => {
    render(<InspectorReplayBar clearDisabled />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });
});
