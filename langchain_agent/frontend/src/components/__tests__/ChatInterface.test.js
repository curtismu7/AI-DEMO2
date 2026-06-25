/* eslint-disable import/first, testing-library/no-node-access */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatInterface from '../ChatInterface';

// Mock the useWebSocket hook
jest.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: jest.fn()
}));

import { useWebSocket } from '../../hooks/useWebSocket';

describe('ChatInterface', () => {
  beforeEach(() => {
    // Default mock implementation
    useWebSocket.mockReturnValue({
      connectionState: 'disconnected',
      isConnected: false,
      lastMessage: null,
      error: null,
      sendMessage: jest.fn(() => true),
      reconnect: jest.fn(),
      disconnect: jest.fn(),
      sessionId: 'test-session-id'
    });
  });

  test('renders chat interface with header and input', () => {
    render(<ChatInterface />);
    
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    // When disconnected, the placeholder shows "Connecting..." initially
    expect(screen.getByPlaceholderText(/Connecting/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
  });

  test('displays welcome message when no messages exist', () => {
    render(<ChatInterface />);
    
    expect(screen.getByText('Welcome to Banking Digital Assistant')).toBeInTheDocument();
    expect(screen.getByText(/Start a conversation by typing a message/)).toBeInTheDocument();
  });

  test('shows disconnected status initially', () => {
    render(<ChatInterface />);
    
    const statusIndicator = document.querySelector('.status-indicator');
    expect(statusIndicator).toHaveClass('disconnected');
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  test('adds user message when sending a message', async () => {
    // Mock connected state for this test
    useWebSocket.mockReturnValue({
      connectionState: 'connected',
      isConnected: true,
      lastMessage: null,
      error: null,
      sendMessage: jest.fn(() => true),
      reconnect: jest.fn(),
      disconnect: jest.fn(),
      sessionId: 'test-session-id'
    });

    render(<ChatInterface />);
    
    const input = screen.getByPlaceholderText(/Type your message/);
    const sendButton = screen.getByRole('button', { name: /send message/i });
    
    fireEvent.change(input, { target: { value: 'Hello, agent!' } });
    fireEvent.click(sendButton);
    
    expect(screen.getByText('Hello, agent!')).toBeInTheDocument();
  });

  test('shows loading indicator while processing message', async () => {
    // Mock connected state for this test
    useWebSocket.mockReturnValue({
      connectionState: 'connected',
      isConnected: true,
      lastMessage: null,
      error: null,
      sendMessage: jest.fn(() => true),
      reconnect: jest.fn(),
      disconnect: jest.fn(),
      sessionId: 'test-session-id'
    });

    render(<ChatInterface />);
    
    const input = screen.getByPlaceholderText(/Type your message/);
    const sendButton = screen.getByRole('button', { name: /send message/i });
    
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);
    
    expect(screen.getByText('Agent is thinking...')).toBeInTheDocument();
  });

  test('clears input after sending message', () => {
    // Mock connected state for this test
    useWebSocket.mockReturnValue({
      connectionState: 'connected',
      isConnected: true,
      lastMessage: null,
      error: null,
      sendMessage: jest.fn(() => true),
      reconnect: jest.fn(),
      disconnect: jest.fn(),
      sessionId: 'test-session-id'
    });

    render(<ChatInterface />);
    
    const input = screen.getByPlaceholderText(/Type your message/);
    const sendButton = screen.getByRole('button', { name: /send message/i });
    
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);
    
    expect(input.value).toBe('');
  });

  test('shows reconnect button when disconnected', () => {
    render(<ChatInterface />);
    
    expect(screen.getByText('Reconnect')).toBeInTheDocument();
  });

  test('handles reconnect button click', () => {
    const mockReconnect = jest.fn();
    useWebSocket.mockReturnValue({
      connectionState: 'disconnected',
      isConnected: false,
      lastMessage: null,
      error: 'Connection lost',
      sendMessage: jest.fn(() => false),
      reconnect: mockReconnect,
      disconnect: jest.fn(),
      sessionId: 'test-session-id'
    });

    render(<ChatInterface />);
    
    const reconnectButton = screen.getByText('Reconnect');
    fireEvent.click(reconnectButton);
    
    expect(mockReconnect).toHaveBeenCalled();
  });

  test('disables input when disconnected', () => {
    render(<ChatInterface />);
    
    const sendButton = screen.getByRole('button', { name: /send message/i });
    expect(sendButton).toBeDisabled();
  });

  test('shows error message when present', () => {
    useWebSocket.mockReturnValue({
      connectionState: 'disconnected',
      isConnected: false,
      lastMessage: null,
      error: 'Connection failed',
      sendMessage: jest.fn(() => false),
      reconnect: jest.fn(),
      disconnect: jest.fn(),
      sessionId: 'test-session-id'
    });

    render(<ChatInterface />);
    
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });});
