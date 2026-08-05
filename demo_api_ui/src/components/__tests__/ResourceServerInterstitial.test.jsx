import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResourceServerInterstitial from '../ResourceServerInterstitial';

describe('ResourceServerInterstitial', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('navigates only when the user clicks View Resource Server', () => {
    vi.useFakeTimers();
    const onNavigate = vi.fn();

    render(
      <ResourceServerInterstitial
        toolName="list_orders"
        onDismiss={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'View Resource Server' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
