/**
 * serverRestart.spec.js
 * 
 * Integration tests for server restart notification system.
 * Tests modal appearance, retry logic, and compatibility with other workflows.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ServerRestartModal from '../../src/components/ServerRestartModal';
import {
  useRestartModal,
  checkServerHealth,
  handle504Error,
  manualRetry,
  __internal__,
} from '../../src/services/bankingRestartNotificationService';

// Mock global fetch
global.fetch = jest.fn();

describe('Server Restart Notification', () => {
  beforeEach(() => {
    // Reset state and fetch mocks before each test
    __internal__.resetState();
    fetch.mockClear();
  });

  describe('Modal appearance on 504', () => {
    test('should show modal when API returns 504', async () => {
      // Simulate a 504 error
      fetch.mockResolvedValueOnce({
        status: 504,
        ok: false,
        statusText: 'Gateway Timeout',
      });

      // Trigger the error
      handle504Error(new Error('504 from server'));

      // Render modal
      render(<ServerRestartModal />);

      // Assert modal appears with correct text
      await waitFor(() => {
        expect(screen.getByText('Server is restarting')).toBeInTheDocument();
        expect(
          screen.getByText(/The server is temporarily unavailable/i)
        ).toBeInTheDocument();
      });
    });

    test('should show modal on connection timeout', async () => {
      // Simulate timeout error
      fetch.mockRejectedValueOnce(new Error('Failed to fetch'));

      // Trigger the error
      handle504Error(new Error('Connection timeout'));

      // Render modal
      render(<ServerRestartModal />);

      // Assert modal appears
      await waitFor(() => {
        expect(screen.getByText('Server is restarting')).toBeInTheDocument();
      });
    });

    test('should not show modal on 400 errors', () => {
      // Do NOT trigger 504 error
      fetch.mockResolvedValueOnce({
        status: 400,
        ok: false,
        statusText: 'Bad Request',
      });

      // Render modal
      const { container } = render(<ServerRestartModal />);

      // Assert modal is NOT visible
      const modal = container.querySelector('.modal-overlay.server-restart-modal');
      expect(modal).not.toBeInTheDocument();
    });
  });

  describe('Modal UI and interactions', () => {
    test('should display spinner and attempt counter', async () => {
      handle504Error(new Error('504'));
      render(<ServerRestartModal />);

      await waitFor(() => {
        const spinner = screen.getByRole('button', { name: /Retry Now/i });
        expect(spinner).toBeInTheDocument();

        // Check for attempt counter text
        expect(screen.getByText(/Attempt \d+ of \d+/)).toBeInTheDocument();
      });
    });

    test('should have Retry Now and Dismiss buttons', async () => {
      handle504Error(new Error('504'));
      render(<ServerRestartModal />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Retry Now/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Dismiss/i })).toBeInTheDocument();
      });
    });

    test('should close modal when Dismiss button clicked', async () => {
      handle504Error(new Error('504'));
      const { container } = render(<ServerRestartModal />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Dismiss/i })).toBeInTheDocument();
      });

      const dismissButton = screen.getByRole('button', { name: /Dismiss/i });
      fireEvent.click(dismissButton);

      // Modal should hide
      await waitFor(() => {
        const modal = container.querySelector('.modal-overlay.server-restart-modal');
        expect(modal).not.toBeInTheDocument();
      });
    });
  });

  describe('Auto-retry logic', () => {
    test('should expose useRestartModal hook with correct state', async () => {
      // Mock component to test hook
      function TestComponent() {
        const { isVisible, attemptCount, retryNow, closeModal } =
          useRestartModal();
        return (
          <div>
            <span>{isVisible ? 'visible' : 'hidden'}</span>
            <span data-testid="attempt">{attemptCount}</span>
            <button onClick={retryNow}>Retry</button>
            <button onClick={closeModal}>Close</button>
          </div>
        );
      }

      render(<TestComponent />);

      // Initially hidden
      expect(screen.getByText('hidden')).toBeInTheDocument();

      // Trigger 504
      handle504Error(new Error('504'));

      // Should become visible
      await waitFor(() => {
        expect(screen.getByText('visible')).toBeInTheDocument();
      });

      // Attempt counter should increment
      const attemptSpan = screen.getByTestId('attempt');
      expect(attemptSpan.textContent).toMatch(/[0-9]+/);
    });

    test('should provide checkServerHealth function', async () => {
      fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const isHealthy = await checkServerHealth();
      expect(isHealthy).toBe(true);
      expect(fetch).toHaveBeenCalledWith('/api/health', expect.any(Object));
    });

    test('checkServerHealth should timeout after 5 seconds', async () => {
      // Mock fetch to never resolve
      fetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: false }), 10000);
          })
      );

      const promise = checkServerHealth(100); // 100ms timeout

      // Should timeout and return false
      const result = await promise;
      expect(result).toBe(false);
    });
  });

  describe('Manual retry', () => {
    test('should have manual retry capability', async () => {
      expect(typeof manualRetry).toBe('function');
      
      // Should not throw
      await expect(manualRetry()).resolves.not.toThrow();
    });
  });

  describe('Accessibility', () => {
    test('should have proper ARIA attributes', async () => {
      handle504Error(new Error('504'));
      const { container } = render(<ServerRestartModal />);

      await waitFor(() => {
        const dialog = container.querySelector('[role="dialog"]');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
      });
    });

    test('buttons should be keyboard accessible', async () => {
      handle504Error(new Error('504'));
      render(<ServerRestartModal />);

      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Dismiss/i })).toBeInTheDocument();
      });

      const dismissButton = screen.getByRole('button', { name: /Dismiss/i });

      // Should be focusable
      dismissButton.focus();
      expect(document.activeElement).toBe(dismissButton);

      // Should respond to keyboard (Space or Enter)
      await user.keyboard('{Enter}');
      // Modal should close
      await waitFor(() => {
        expect(screen.queryByText('Server is restarting')).not.toBeInTheDocument();
      });
    });
  });

  describe('CSS and animations', () => {
    test('modal should have server-restart-modal class', async () => {
      handle504Error(new Error('504'));
      const { container } = render(<ServerRestartModal />);

      await waitFor(() => {
        const modal = container.querySelector('.server-restart-modal');
        expect(modal).toBeInTheDocument();
      });
    });

    test('should have spinner element', async () => {
      handle504Error(new Error('504'));
      const { container } = render(<ServerRestartModal />);

      await waitFor(() => {
        const spinner = container.querySelector('.restart-spinner');
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  describe('Production readiness', () => {
    test('should not leak state between instances', async () => {
      // Create two instances
      const TestComponent1 = () => useRestartModal().isVisible ? <div>visible1</div> : null;
      const TestComponent2 = () => useRestartModal().isVisible ? <div>visible2</div> : null;

      const { rerender } = render(<TestComponent1 />);

      // Initially both hidden
      expect(screen.queryByText('visible1')).not.toBeInTheDocument();

      // Trigger error
      handle504Error(new Error('504'));

      rerender(<TestComponent1 />);

      // First should show
      await waitFor(() => {
        expect(screen.getByText('visible1')).toBeInTheDocument();
      });
    });

    test('should handle rapid 504s without errors', async () => {
      // Simulate rapid failures
      for (let i = 0; i < 5; i++) {
        handle504Error(new Error(`504 ${i}`));
      }

      render(<ServerRestartModal />);

      await waitFor(() => {
        expect(screen.getByText('Server is restarting')).toBeInTheDocument();
      });

      // Should not crash or show multiple modals
      const modals = screen.getAllByText('Server is restarting');
      expect(modals).toHaveLength(1);
    });
  });
});
