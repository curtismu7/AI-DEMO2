import React from 'react';
import { render, screen } from '@testing-library/react';
import FallbackBadge from '../../src/components/FallbackBadge';

describe('FallbackBadge', () => {
  it('should render when isFallback is true', () => {
    render(<FallbackBadge isFallback={true} verticalId="retail" />);
    expect(screen.getByText(/fallback mode/i)).toBeInTheDocument();
  });

  it('should not render when isFallback is false', () => {
    const { container } = render(<FallbackBadge isFallback={false} verticalId="retail" />);
    expect(container.firstChild).toBeNull();
  });

  it('should display vertical hint when provided', () => {
    render(<FallbackBadge isFallback={true} verticalId="sporting-goods" />);
    expect(screen.getByText(/sporting-goods|sporting goods/i)).toBeInTheDocument();
  });

  it('should call onDismiss when close button clicked', () => {
    const onDismiss = jest.fn();
    render(
      <FallbackBadge isFallback={true} verticalId="banking" onDismiss={onDismiss} />
    );
    const closeBtn = screen.getByRole('button', { name: /dismiss|close|×/i });
    closeBtn.click();
    expect(onDismiss).toHaveBeenCalled();
  });
});
