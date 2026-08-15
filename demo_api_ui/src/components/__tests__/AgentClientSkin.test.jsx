import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentClientSkin from '../AgentClientSkin';

const baseProps = {
  skin: 'privilege',
  theme: 'dark',
  messages: [{ role: 'agent', text: 'Hello!' }],
  onSend: vi.fn(),
  showPopOutButton: false,
  onPopOut: vi.fn(),
};

describe('AgentClientSkin', () => {
  it('renders Privilege skin with correct title', () => {
    render(<AgentClientSkin {...baseProps} skin="privilege" />);
    expect(screen.getByText('Privilege AI Agent')).toBeTruthy();
  });

  it('renders Claude skin with correct title', () => {
    render(<AgentClientSkin {...baseProps} skin="claude" />);
    expect(screen.getByText('Claude')).toBeTruthy();
  });

  it('renders ChatGPT skin with correct title', () => {
    render(<AgentClientSkin {...baseProps} skin="gpt" />);
    expect(screen.getByText('ChatGPT')).toBeTruthy();
  });

  it('renders Gemini skin with correct title', () => {
    render(<AgentClientSkin {...baseProps} skin="gemini" />);
    expect(screen.getByText('Gemini')).toBeTruthy();
  });

  it('shows user and agent messages', () => {
    const messages = [
      { role: 'agent', text: 'Hello agent' },
      { role: 'user', text: 'Hello user' },
    ];
    render(<AgentClientSkin {...baseProps} messages={messages} />);
    expect(screen.getByText('Hello agent')).toBeTruthy();
    expect(screen.getByText('Hello user')).toBeTruthy();
  });

  it('calls onSend when input submitted', () => {
    const onSend = vi.fn();
    render(<AgentClientSkin {...baseProps} onSend={onSend} />);
    const input = screen.getByPlaceholderText(/Message/i);
    fireEvent.change(input, { target: { value: 'test message' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('test message');
  });

  it('shows pop-out button only when showPopOutButton is true', () => {
    const { rerender } = render(<AgentClientSkin {...baseProps} showPopOutButton={false} />);
    expect(screen.queryByText(/Pop Out/i)).toBeNull();
    rerender(<AgentClientSkin {...baseProps} showPopOutButton={true} />);
    expect(screen.getByText(/Pop Out/i)).toBeTruthy();
  });

  it('calls onPopOut when pop-out button clicked', () => {
    const onPopOut = vi.fn();
    render(<AgentClientSkin {...baseProps} showPopOutButton={true} onPopOut={onPopOut} />);
    fireEvent.click(screen.getByText(/Pop Out/i));
    expect(onPopOut).toHaveBeenCalled();
  });
});
