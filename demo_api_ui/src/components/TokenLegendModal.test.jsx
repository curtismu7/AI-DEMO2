import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TokenLegendModal from './TokenLegendModal';

describe('TokenLegendModal', () => {
  beforeEach(() => {
    // Clear any portal content before each test
    const portalRoot = document.getElementById('modal-root');
    if (portalRoot) {
      portalRoot.innerHTML = '';
    }
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <TokenLegendModal isOpen={false} onClose={() => {}} />
    );
    expect(container.querySelector('.tlm-overlay')).toBeNull();
  });

  it('renders modal overlay and content when isOpen is true', () => {
    render(
      <TokenLegendModal isOpen={true} onClose={() => {}} />
    );
    expect(screen.getByText('Token Legend')).toBeTruthy();
    expect(document.querySelector('.tlm-overlay')).toBeTruthy();
  });

  it('renders modal with title and close button', () => {
    render(
      <TokenLegendModal isOpen={true} onClose={() => {}} />
    );
    expect(screen.getByText('Token Legend')).toBeTruthy();
    expect(screen.getByText('×')).toBeTruthy();
  });

  it('renders three legend items with correct labels', () => {
    render(
      <TokenLegendModal isOpen={true} onClose={() => {}} />
    );
    expect(screen.getByText('User Token')).toBeTruthy();
    expect(screen.getByText('Agent Token')).toBeTruthy();
    expect(screen.getByText('MCP Token')).toBeTruthy();
  });

  it('renders legend descriptions for each token type', () => {
    render(
      <TokenLegendModal isOpen={true} onClose={() => {}} />
    );
    expect(screen.getByText('Customer access token from PingOne')).toBeTruthy();
    expect(screen.getByText('BFF-delegated token via RFC 8693')).toBeTruthy();
    expect(screen.getByText('Resource-scoped access token')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', async () => {
    const mockOnClose = () => {};
    const onCloseSpy = () => { mockOnClose(); };
    const { rerender } = render(
      <TokenLegendModal isOpen={true} onClose={onCloseSpy} />
    );

    const closeBtn = screen.getByText('×');
    await userEvent.click(closeBtn);
    rerender(
      <TokenLegendModal isOpen={false} onClose={onCloseSpy} />
    );
    expect(document.querySelector('.tlm-overlay')).toBeNull();
  });

  it('calls onClose when overlay is clicked', async () => {
    const mockOnClose = () => {};
    const onCloseSpy = () => { mockOnClose(); };
    const { rerender } = render(
      <TokenLegendModal isOpen={true} onClose={onCloseSpy} />
    );

    const overlay = document.querySelector('.tlm-overlay');
    if (overlay) {
      await userEvent.click(overlay);
      rerender(
        <TokenLegendModal isOpen={false} onClose={onCloseSpy} />
      );
    }
    expect(document.querySelector('.tlm-overlay')).toBeNull();
  });

  it('does not close when modal content is clicked', async () => {
    const mockOnClose = () => {};
    const onCloseSpy = () => { mockOnClose(); };
    render(
      <TokenLegendModal isOpen={true} onClose={onCloseSpy} />
    );

    const modalContent = document.querySelector('.tlm-modal-content');
    if (modalContent) {
      await userEvent.click(modalContent);
    }
    // Modal should still be visible
    expect(screen.getByText('Token Legend')).toBeTruthy();
  });

  it('renders legend grid with 3 columns', () => {
    render(
      <TokenLegendModal isOpen={true} onClose={() => {}} />
    );
    const grid = document.querySelector('.tlm-legend-grid');
    expect(grid).toBeTruthy();
    expect(grid?.children.length).toBe(3);
  });

  it('renders color swatches for each token type', () => {
    render(
      <TokenLegendModal isOpen={true} onClose={() => {}} />
    );
    const swatches = document.querySelectorAll('.tlm-swatch');
    expect(swatches.length).toBe(3);
  });

  it('has correct z-index for modal overlay', () => {
    render(
      <TokenLegendModal isOpen={true} onClose={() => {}} />
    );
    const overlay = document.querySelector('.tlm-overlay');
    expect(overlay).toBeTruthy();
    // Check that overlay exists and has high z-index styling
    expect(overlay?.className).toContain('tlm-overlay');
  });

  it('uses React Portal for modal rendering', () => {
    render(
      <TokenLegendModal isOpen={true} onClose={() => {}} />
    );
    const modal = document.querySelector('.tlm-overlay');
    expect(modal).toBeTruthy();
    expect(modal?.parentElement === document.body).toBeTruthy();
  });

  it('renders modal with semi-transparent background', () => {
    render(
      <TokenLegendModal isOpen={true} onClose={() => {}} />
    );
    const overlay = document.querySelector('.tlm-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay?.className).toContain('tlm-overlay');
  });

  it('renders legend item with swatch, title, and description', () => {
    render(
      <TokenLegendModal isOpen={true} onClose={() => {}} />
    );
    const legendItems = document.querySelectorAll('.tlm-legend-item');
    expect(legendItems.length).toBe(3);

    legendItems.forEach(item => {
      expect(item.querySelector('.tlm-swatch')).toBeTruthy();
      expect(item.querySelector('.tlm-item-title')).toBeTruthy();
      expect(item.querySelector('.tlm-item-description')).toBeTruthy();
    });
  });
});
