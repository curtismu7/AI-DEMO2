/* eslint-disable testing-library/no-node-access */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Message from '../Message';

const mockUserMessage = {
  id: '1',
  content: 'Hello, agent!',
  role: 'user',
  timestamp: '2023-12-01T10:00:00Z'
};

const mockAssistantMessage = {
  id: '2',
  content: 'Hello! How can I help you today?',
  role: 'assistant',
  timestamp: '2023-12-01T10:01:00Z'
};

describe('Message', () => {
  test('renders user message with correct styling', () => {
    render(<Message message={mockUserMessage} />);
    
    expect(screen.getByText('Hello, agent!')).toBeInTheDocument();
    
    const messageElement = screen.getByText('Hello, agent!').closest('.message');
    expect(messageElement).toHaveClass('message-user');
  });

  test('renders assistant message with correct styling', () => {
    render(<Message message={mockAssistantMessage} />);
    
    expect(screen.getByText('Hello! How can I help you today?')).toBeInTheDocument();
    
    const messageElement = screen.getByText('Hello! How can I help you today?').closest('.message');
    expect(messageElement).toHaveClass('message-assistant');
  });

  test('displays formatted timestamp', () => {
    render(<Message message={mockUserMessage} />);
    
    // The timestamp should be formatted as time (e.g., "10:00 AM")
    const timestampElement = document.querySelector('.message-timestamp');
    expect(timestampElement).toBeInTheDocument();
    expect(timestampElement.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  test('renders message content correctly', () => {
    const messageWithSpecialChars = {
      ...mockUserMessage,
      content: 'Test message with <special> characters & symbols!'
    };
    
    render(<Message message={messageWithSpecialChars} />);
    
    expect(screen.getByText('Test message with <special> characters & symbols!')).toBeInTheDocument();
  });

  test('handles long message content', () => {
    const longMessage = {
      ...mockUserMessage,
      content: 'This is a very long message that should wrap properly and not break the layout. '.repeat(10)
    };
    
    render(<Message message={longMessage} />);
    
    const messageText = screen.getByText((content, element) => {
      return element && element.textContent === longMessage.content;
    });
    expect(messageText).toBeInTheDocument();
  });
});