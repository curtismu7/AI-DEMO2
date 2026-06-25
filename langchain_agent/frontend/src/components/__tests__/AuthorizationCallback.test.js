import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AuthorizationCallback from '../AuthorizationCallback';

// Mock window properties
const mockClose = jest.fn();
const mockPostMessage = jest.fn();

Object.defineProperty(window, 'close', {
  writable: true,
  value: mockClose
});

Object.defineProperty(window, 'opener', {
  writable: true,
  value: {
    postMessage: mockPostMessage
  }
});

// Mock URLSearchParams
const mockGet = jest.fn();
global.URLSearchParams = jest.fn().mockImplementation(() => ({
  get: mockGet
}));

describe('AuthorizationCallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders processing state initially', () => {
    mockGet.mockReturnValue(null);
    
    render(<AuthorizationCallback />);
    
    expect(screen.getByText('Authorization Processing')).toBeInTheDocument();
    expect(screen.getByText('Processing authorization...')).toBeInTheDocument();
  });

  test('handles successful authorization with code', async () => {
    mockGet.mockImplementation((param) => {
      if (param === 'code') return 'auth-code-123';
      if (param === 'state') return 'state-456';
      return null;
    });
    
    render(<AuthorizationCallback />);
    
    await waitFor(() => {
      expect(screen.getByText('Authorization Complete')).toBeInTheDocument();
    });
    
    expect(screen.getByText(/Authorization successful/)).toBeInTheDocument();
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'OAUTH_SUCCESS',
      code: 'auth-code-123',
      state: 'state-456'
    }, window.location.origin);
    
    // Fast-forward timers to trigger window close
    jest.advanceTimersByTime(1500);
    expect(mockClose).toHaveBeenCalled();
  });

  test('handles authorization error', async () => {
    mockGet.mockImplementation((param) => {
      if (param === 'error') return 'access_denied';
      if (param === 'error_description') return 'User denied access';
      return null;
    });
    
    render(<AuthorizationCallback />);
    
    await waitFor(() => {
      expect(screen.getByText('Authorization Failed')).toBeInTheDocument();
    });
    
    expect(screen.getByText('User denied access')).toBeInTheDocument();
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'OAUTH_ERROR',
      error: 'User denied access'
    }, window.location.origin);
    
    // Fast-forward timers to trigger window close
    jest.advanceTimersByTime(3000);
    expect(mockClose).toHaveBeenCalled();
  });

  test('handles missing authorization code', async () => {
    mockGet.mockReturnValue(null);
    
    render(<AuthorizationCallback />);
    
    await waitFor(() => {
      expect(screen.getByText('Authorization Failed')).toBeInTheDocument();
    });
    
    expect(screen.getByText('No authorization code received')).toBeInTheDocument();
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'OAUTH_ERROR',
      error: 'No authorization code received'
    }, window.location.origin);
  });

  test('handles error without description', async () => {
    mockGet.mockImplementation((param) => {
      if (param === 'error') return 'server_error';
      return null;
    });
    
    render(<AuthorizationCallback />);
    
    await waitFor(() => {
      expect(screen.getByText('Authorization Failed')).toBeInTheDocument();
    });
    
    expect(screen.getByText('server_error')).toBeInTheDocument();
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: 'OAUTH_ERROR',
      error: 'server_error'
    }, window.location.origin);
  });

  test('shows close button on error', async () => {
    mockGet.mockImplementation((param) => {
      if (param === 'error') return 'access_denied';
      return null;
    });
    
    render(<AuthorizationCallback />);
    
    await waitFor(() => {
      expect(screen.getByText('Close Window')).toBeInTheDocument();
    });
  });

  test('handles case when no opener window exists', async () => {
    Object.defineProperty(window, 'opener', {
      writable: true,
      value: null
    });
    
    mockGet.mockImplementation((param) => {
      if (param === 'code') return 'auth-code-123';
      return null;
    });
    
    render(<AuthorizationCallback />);
    
    await waitFor(() => {
      expect(screen.getByText('Authorization Complete')).toBeInTheDocument();
    });
    
    // Should not throw error even without opener
    expect(mockPostMessage).not.toHaveBeenCalled();
  });
});