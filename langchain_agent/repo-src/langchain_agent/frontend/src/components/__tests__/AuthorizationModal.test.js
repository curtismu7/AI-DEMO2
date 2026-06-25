import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AuthorizationModal from '../AuthorizationModal';

// Mock window.open
const mockOpen = jest.fn();
const mockClose = jest.fn();
const mockAddEventListener = jest.fn();
const mockRemoveEventListener = jest.fn();

// Mock window object
Object.defineProperty(window, 'open', {
  writable: true,
  value: mockOpen
});

Object.defineProperty(window, 'addEventListener', {
  writable: true,
  value: mockAddEventListener
});

Object.defineProperty(window, 'removeEventListener', {
  writable: true,
  value: mockRemoveEventListener
});

describe('AuthorizationModal', () => {
  const mockProps = {
    isOpen: true,
    authorizationUrl: 'https://example.com/oauth/authorize',
    onClose: jest.fn(),
    onAuthorizationComplete: jest.fn(),
    onAuthorizationError: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOpen.mockReturnValue({
      closed: false,
      close: mockClose
    });
  });

  test('renders modal when open', () => {
    render(<AuthorizationModal {...mockProps} />);
    
    expect(screen.getByText('Authorization Required')).toBeInTheDocument();
    expect(screen.getByText(/The agent needs your permission/)).toBeInTheDocument();
    expect(screen.getByText('Authorize')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  test('does not render when closed', () => {
    render(<AuthorizationModal {...mockProps} isOpen={false} />);
    
    expect(screen.queryByText('Authorization Required')).not.toBeInTheDocument();
  });

  test('calls onClose when cancel button is clicked', () => {
    render(<AuthorizationModal {...mockProps} />);
    
    fireEvent.click(screen.getByText('Cancel'));
    
    expect(mockProps.onClose).toHaveBeenCalled();
  });

  test('calls onClose when close button is clicked', () => {
    render(<AuthorizationModal {...mockProps} />);
    
    fireEvent.click(screen.getByLabelText('Close'));
    
    expect(mockProps.onClose).toHaveBeenCalled();
  });

  test('opens authorization window when authorize button is clicked', () => {
    render(<AuthorizationModal {...mockProps} />);
    
    fireEvent.click(screen.getByText('Authorize'));
    
    expect(mockOpen).toHaveBeenCalledWith(
      'https://example.com/oauth/authorize',
      'oauth-authorization',
      'width=600,height=700,scrollbars=yes,resizable=yes'
    );
    expect(mockAddEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  test('shows error when no authorization URL provided', () => {
    render(<AuthorizationModal {...mockProps} authorizationUrl={null} />);
    
    // The button should be disabled, but let's force the click to test the error handling
    const authorizeButton = screen.getByText('Authorize');
    
    // Enable the button temporarily to test the error case
    authorizeButton.disabled = false;
    fireEvent.click(authorizeButton);
    
    expect(screen.getByText('No authorization URL provided')).toBeInTheDocument();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  test('shows error when popup is blocked', () => {
    mockOpen.mockReturnValue(null);
    
    render(<AuthorizationModal {...mockProps} />);
    
    fireEvent.click(screen.getByText('Authorize'));
    
    expect(screen.getByText(/Failed to open authorization window/)).toBeInTheDocument();
  });

  test('disables authorize button when no URL provided', () => {
    render(<AuthorizationModal {...mockProps} authorizationUrl={null} />);
    
    const authorizeButton = screen.getByText('Authorize');
    expect(authorizeButton).toBeDisabled();
  });

  test('shows loading state when authorizing', () => {
    render(<AuthorizationModal {...mockProps} />);
    
    fireEvent.click(screen.getByText('Authorize'));
    
    expect(screen.getByText('Authorizing...')).toBeInTheDocument();
    expect(screen.getByText(/Please complete the authorization in the popup window/)).toBeInTheDocument();
  });

  test('handles successful authorization message', () => {
    render(<AuthorizationModal {...mockProps} />);
    
    fireEvent.click(screen.getByText('Authorize'));
    
    // Simulate receiving success message
    const messageHandler = mockAddEventListener.mock.calls.find(
      call => call[0] === 'message'
    )[1];
    
    messageHandler({
      origin: window.location.origin,
      data: {
        type: 'OAUTH_SUCCESS',
        code: 'auth-code-123',
        state: 'state-456'
      }
    });
    
    expect(mockProps.onAuthorizationComplete).toHaveBeenCalledWith('auth-code-123', 'state-456');
    expect(mockProps.onClose).toHaveBeenCalled();
  });

  test('handles authorization error message', async () => {
    render(<AuthorizationModal {...mockProps} />);
    
    fireEvent.click(screen.getByText('Authorize'));
    
    // Simulate receiving error message
    const messageHandler = mockAddEventListener.mock.calls.find(
      call => call[0] === 'message'
    )[1];
    
    messageHandler({
      origin: window.location.origin,
      data: {
        type: 'OAUTH_ERROR',
        error: 'access_denied'
      }
    });
    
    expect(mockProps.onAuthorizationError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'access_denied' })
    );
    
    // Wait for the error to be displayed
    await waitFor(() => {
      expect(screen.getByText('access_denied')).toBeInTheDocument();
    });
  });

  test('ignores messages from different origins', () => {
    render(<AuthorizationModal {...mockProps} />);
    
    fireEvent.click(screen.getByText('Authorize'));
    
    // Simulate receiving message from different origin
    const messageHandler = mockAddEventListener.mock.calls.find(
      call => call[0] === 'message'
    )[1];
    
    messageHandler({
      origin: 'https://malicious-site.com',
      data: {
        type: 'OAUTH_SUCCESS',
        code: 'malicious-code'
      }
    });
    
    expect(mockProps.onAuthorizationComplete).not.toHaveBeenCalled();
  });
});