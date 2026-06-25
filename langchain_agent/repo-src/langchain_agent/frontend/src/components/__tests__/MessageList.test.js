import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessageList from '../MessageList';

const mockMessages = [
  {
    id: '1',
    content: 'Hello, how can I help you?',
    role: 'assistant',
    timestamp: '2023-12-01T10:00:00Z'
  },
  {
    id: '2',
    content: 'I need help with authentication',
    role: 'user',
    timestamp: '2023-12-01T10:01:00Z'
  }
];

describe('MessageList', () => {
  test('renders welcome message when no messages provided', () => {
    render(<MessageList messages={[]} isLoading={false} />);
    
    expect(screen.getByText('Welcome to Banking Digital Assistant')).toBeInTheDocument();
    expect(screen.getByText(/Start a conversation by typing a message/)).toBeInTheDocument();
  });

  test('renders messages when provided', () => {
    render(<MessageList messages={mockMessages} isLoading={false} />);
    
    expect(screen.getByText('Hello, how can I help you?')).toBeInTheDocument();
    expect(screen.getByText('I need help with authentication')).toBeInTheDocument();
  });

  test('renders loading indicator when isLoading is true', () => {
    render(<MessageList messages={mockMessages} isLoading={true} />);
    
    expect(screen.getByText('Agent is thinking...')).toBeInTheDocument();
  });

  test('does not render loading indicator when isLoading is false', () => {
    render(<MessageList messages={mockMessages} isLoading={false} />);
    
    expect(screen.queryByText('Agent is thinking...')).not.toBeInTheDocument();
  });

  test('renders correct number of messages', () => {
    render(<MessageList messages={mockMessages} isLoading={false} />);
    
    const messages = screen.getAllByText(/Hello, how can I help you\?|I need help with authentication/);
    expect(messages).toHaveLength(2);
  });
});