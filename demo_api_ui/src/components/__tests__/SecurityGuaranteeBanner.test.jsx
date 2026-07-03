import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SecurityGuaranteeBanner } from '../SecurityGuaranteeBanner';

describe('SecurityGuaranteeBanner', () => {
  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();
  });

  describe('rendering', () => {
    it('renders the banner with security message', () => {
      render(<SecurityGuaranteeBanner />);

      expect(screen.getByText(/Security guarantee:/i)).toBeInTheDocument();
      expect(screen.getByText(/User Token and Agent Token are secrets/i)).toBeInTheDocument();
    });

    it('renders a dismiss button', () => {
      render(<SecurityGuaranteeBanner />);

      const dismissButton = screen.getByRole('button', { name: /dismiss security/i });
      expect(dismissButton).toBeInTheDocument();
      expect(dismissButton.textContent).toBe('×');
    });

    it('applies the correct CSS class', () => {
      const { container } = render(<SecurityGuaranteeBanner />);

      expect(container.querySelector('.utfi-security-guarantee')).toBeInTheDocument();
    });
  });

  describe('dismissal behavior', () => {
    it('hides the banner when dismiss button is clicked', () => {
      render(<SecurityGuaranteeBanner />);

      expect(screen.getByText(/Security guarantee:/i)).toBeInTheDocument();

      const dismissButton = screen.getByRole('button', { name: /dismiss security/i });
      fireEvent.click(dismissButton);

      expect(screen.queryByText(/Security guarantee:/i)).not.toBeInTheDocument();
    });

    it('persists dismissal state to sessionStorage', () => {
      render(<SecurityGuaranteeBanner />);

      const dismissButton = screen.getByRole('button', { name: /dismiss security/i });
      fireEvent.click(dismissButton);

      expect(sessionStorage.getItem('utfi_security_banner_dismissed')).toBe('true');
    });

    it('stays dismissed after re-render when dismissal is stored in sessionStorage', () => {
      // First render and dismiss
      const { unmount } = render(<SecurityGuaranteeBanner />);
      const dismissButton = screen.getByRole('button', { name: /dismiss security/i });
      fireEvent.click(dismissButton);

      // Unmount and re-render
      unmount();
      render(<SecurityGuaranteeBanner />);

      // Banner should be hidden
      expect(screen.queryByText(/Security guarantee:/i)).not.toBeInTheDocument();
    });

    it('shows banner again when sessionStorage is cleared', () => {
      // First render and dismiss
      const { unmount } = render(<SecurityGuaranteeBanner />);
      const dismissButton = screen.getByRole('button', { name: /dismiss security/i });
      fireEvent.click(dismissButton);

      // Clear sessionStorage
      sessionStorage.clear();

      // Re-render
      unmount();
      render(<SecurityGuaranteeBanner />);

      // Banner should be visible again
      expect(screen.getByText(/Security guarantee:/i)).toBeInTheDocument();
    });
  });

  describe('sessionStorage isolation', () => {
    it('treats each session independently (new session shows banner)', () => {
      // Simulate first session: dismiss banner
      const { unmount: unmount1 } = render(<SecurityGuaranteeBanner />);
      const dismissButton1 = screen.getByRole('button', { name: /dismiss security/i });
      fireEvent.click(dismissButton1);
      unmount1();

      // Simulate new session: clear sessionStorage and re-render
      sessionStorage.clear();
      render(<SecurityGuaranteeBanner />);

      // Banner should be visible in new session
      expect(screen.getByText(/Security guarantee:/i)).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper aria-label on dismiss button', () => {
      render(<SecurityGuaranteeBanner />);

      const dismissButton = screen.getByRole('button', { name: /dismiss security/i });
      expect(dismissButton).toHaveAttribute('aria-label');
      expect(dismissButton.getAttribute('aria-label')).toMatch(/dismiss/i);
    });
  });
});
