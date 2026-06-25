import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessageInput from '../MessageInput';

describe('MessageInput', () => {
  const mockOnSendMessage = jest.fn();

  beforeEach(() => {
    mockOnSendMessage.mockClear();
  });

  test('renders input field and send button', () => {
    render(<MessageInput onSendMessage={mockOnSendMessage} />);
    
    expect(screen.getByPlaceholderText(/Type your message/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
  });

  test('calls onSendMessage when form is submitted', () => {
    render(<MessageInput onSendMessage={mockOnSendMessage} />);
    
    const input = screen.getByPlaceholderText(/Type your message/);
    const sendButton = screen.getByRole('button', { name: /send message/i });
    
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);
    
    expect(mockOnSendMessage).toHaveBeenCalledWith('Test message');
  });

  test('calls onSendMessage when Enter key is pressed', () => {
    render(<MessageInput onSendMessage={mockOnSendMessage} />);
    
    const input = screen.getByPlaceholderText(/Type your message/);
    
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    
    expect(mockOnSendMessage).toHaveBeenCalledWith('Test message');
  });

  test('does not call onSendMessage when Shift+Enter is pressed', () => {
    render(<MessageInput onSendMessage={mockOnSendMessage} />);
    
    const input = screen.getByPlaceholderText(/Type your message/);
    
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true });
    
    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  test('clears input after sending message', () => {
    render(<MessageInput onSendMessage={mockOnSendMessage} />);
    
    const input = screen.getByPlaceholderText(/Type your message/);
    const sendButton = screen.getByRole('button', { name: /send message/i });
    
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);
    
    expect(input.value).toBe('');
  });

  test('does not send empty or whitespace-only messages', () => {
    render(<MessageInput onSendMessage={mockOnSendMessage} />);
    
    const input = screen.getByPlaceholderText(/Type your message/);
    const sendButton = screen.getByRole('button', { name: /send message/i });
    
    // Test empty message
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(sendButton);
    expect(mockOnSendMessage).not.toHaveBeenCalled();
    
    // Test whitespace-only message
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(sendButton);
    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  test('disables input and button when disabled prop is true', () => {
    render(<MessageInput onSendMessage={mockOnSendMessage} disabled={true} />);
    
    const input = screen.getByPlaceholderText(/Connecting/);
    const sendButton = screen.getByRole('button', { name: /send message/i });
    
    expect(input).toBeDisabled();
    expect(sendButton).toBeDisabled();
  });

  test('trims whitespace from message before sending', () => {
    render(<MessageInput onSendMessage={mockOnSendMessage} />);
    
    const input = screen.getByPlaceholderText(/Type your message/);
    const sendButton = screen.getByRole('button', { name: /send message/i });
    
    fireEvent.change(input, { target: { value: '  Test message  ' } });
    fireEvent.click(sendButton);
    
    expect(mockOnSendMessage).toHaveBeenCalledWith('Test message');
  });

  test('send button is disabled when input is empty', () => {
    render(<MessageInput onSendMessage={mockOnSendMessage} />);
    
    const sendButton = screen.getByRole('button', { name: /send message/i });
    
    expect(sendButton).toBeDisabled();
  });

  test('send button is enabled when input has content', () => {
    render(<MessageInput onSendMessage={mockOnSendMessage} />);
    
    const input = screen.getByPlaceholderText(/Type your message/);
    const sendButton = screen.getByRole('button', { name: /send message/i });
    
    fireEvent.change(input, { target: { value: 'Test' } });
    
    expect(sendButton).not.toBeDisabled();
  });
});