import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AuthErrorBanner from '../AuthErrorBanner';

describe('AuthErrorBanner', () => {
  const baseError = {
    classification: {
      category: 'USER',
      userAction: 're-auth',
      retryable: false,
    },
    requestId: 'err_123_abc',
    timestamp: new Date().toISOString(),
    message: 'Token expired',
  };

  describe('USER errors', () => {
    it('renders USER error with session expired message', () => {
      const error = {
        ...baseError,
        classification: {
          ...baseError.classification,
          category: 'USER',
        },
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByText('Your session has expired')).toBeInTheDocument();
      expect(screen.getByText(/authentication session is no longer valid/)).toBeInTheDocument();
    });

    it('renders Refresh and Sign In buttons for USER error', () => {
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'USER' },
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('calls onRetry when Refresh is clicked', () => {
      const onRetry = jest.fn();
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'USER' },
      };

      render(<AuthErrorBanner error={error} onRetry={onRetry} />);

      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      expect(onRetry).toHaveBeenCalled();
    });

    it('dismisses when close button is clicked', () => {
      const onDismiss = jest.fn();
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'USER' },
      };

      render(<AuthErrorBanner error={error} onDismiss={onDismiss} />);

      fireEvent.click(screen.getAllByRole('button').find((btn) => btn.textContent === '✕'));
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  describe('TRANSIENT errors', () => {
    it('renders TRANSIENT error with connecting message', () => {
      const error = {
        ...baseError,
        classification: {
          ...baseError.classification,
          category: 'TRANSIENT',
        },
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByText('Connecting...')).toBeInTheDocument();
      expect(screen.getByText(/temporary connection issue/)).toBeInTheDocument();
    });

    it('shows spinner icon for TRANSIENT error', () => {
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'TRANSIENT' },
      };

      const { container } = render(<AuthErrorBanner error={error} />);

      const spinner = container.querySelector('.banner-icon.spinner');
      expect(spinner).toBeInTheDocument();
    });

    it('does not show action buttons for TRANSIENT error', () => {
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'TRANSIENT' },
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /contact support/i })).not.toBeInTheDocument();
    });
  });

  describe('CONFIG errors', () => {
    it('renders CONFIG error with system config issue message', () => {
      const error = {
        ...baseError,
        classification: {
          ...baseError.classification,
          category: 'CONFIG',
        },
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByText('System configuration issue')).toBeInTheDocument();
      expect(screen.getByText(/support team has been notified/)).toBeInTheDocument();
    });

    it('displays request ID for CONFIG error', () => {
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'CONFIG' },
        requestId: 'err_test_12345',
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByText(/err_test_12345/)).toBeInTheDocument();
    });

    it('renders Contact Support button for CONFIG error', () => {
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'CONFIG' },
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByRole('button', { name: /contact support/i })).toBeInTheDocument();
    });

    it('calls onContactSupport when Contact Support is clicked', async () => {
      const onContactSupport = jest.fn().mockResolvedValue(undefined);
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'CONFIG' },
      };

      render(<AuthErrorBanner error={error} onContactSupport={onContactSupport} />);

      fireEvent.click(screen.getByRole('button', { name: /contact support/i }));
      expect(onContactSupport).toHaveBeenCalledWith(error);
    });

    it('hides sensitive config details', () => {
      const error = {
        ...baseError,
        classification: {
          ...baseError.classification,
          category: 'CONFIG',
          context: {
            jwksUri: 'https://auth.pingone.com/abc/as/jwks',
            issuer: 'https://auth.pingone.com/abc/as',
          },
        },
      };

      const { container } = render(<AuthErrorBanner error={error} />);

      expect(container.textContent).not.toContain('jwksUri');
      expect(container.textContent).not.toContain('https://auth.pingone.com');
    });
  });

  describe('UNKNOWN errors', () => {
    it('renders UNKNOWN error with generic message', () => {
      const error = {
        ...baseError,
        classification: {
          ...baseError.classification,
          category: 'UNKNOWN',
        },
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByText('Unexpected error')).toBeInTheDocument();
    });

    it('shows Status Page link for UNKNOWN error', () => {
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'UNKNOWN' },
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByRole('link', { name: /status page/i })).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper ARIA labels on buttons', () => {
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'USER' },
      };

      render(<AuthErrorBanner error={error} />);

      expect(screen.getByRole('button', { name: /refresh authentication/i })).toBeInTheDocument();
    });

    it('renders without error when error prop is null', () => {
      const { container } = render(<AuthErrorBanner error={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders without error when classification is missing', () => {
      const error = { requestId: 'test', message: 'error' };
      const { container } = render(<AuthErrorBanner error={error} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('responsive layout', () => {
    it('has correct CSS classes for styling', () => {
      const error = {
        ...baseError,
        classification: { ...baseError.classification, category: 'CONFIG' },
      };

      const { container } = render(<AuthErrorBanner error={error} className="custom-class" />);

      expect(container.querySelector('.auth-error-banner')).toHaveClass('config', 'custom-class');
    });
  });
});
