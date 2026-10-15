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
    expect(screen.getByText(/🪟 Pop Out/i)).toBeTruthy();
  });

  it('calls onPopOut when pop-out button clicked', () => {
    const onPopOut = vi.fn();
    render(<AgentClientSkin {...baseProps} showPopOutButton={true} onPopOut={onPopOut} />);
    fireEvent.click(screen.getByText(/🪟 Pop Out/i));
    expect(onPopOut).toHaveBeenCalled();
  });
  describe('suggestions (empty-state chips)', () => {
    const suggestions = ['Always book me an aisle seat', 'What do you remember about me?'];

    it('shows chips while only the greeting is on screen, and clicking one sends it', () => {
      const onSend = vi.fn();
      render(<AgentClientSkin {...baseProps} skin="dot" onSend={onSend} suggestions={suggestions} />);
      fireEvent.click(screen.getByRole('button', { name: 'Always book me an aisle seat' }));
      expect(onSend).toHaveBeenCalledWith('Always book me an aisle seat');
      expect(screen.getByRole('button', { name: 'What do you remember about me?' })).toBeTruthy();
    });

    it('accepts {label, message} chips: shows the label, sends the message', () => {
      const onSend = vi.fn();
      render(<AgentClientSkin {...baseProps} skin="dot" onSend={onSend} suggestions={[{ label: 'Check balance', message: 'What is my checking account balance?' }]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Check balance' }));
      expect(onSend).toHaveBeenCalledWith('What is my checking account balance?');
    });

    it('hides the chips once the conversation has started', () => {
      const messages = [{ role: 'agent', text: 'Hi' }, { role: 'user', text: 'Hello' }];
      render(<AgentClientSkin {...baseProps} skin="dot" messages={messages} suggestions={suggestions} />);
      expect(screen.queryByRole('button', { name: 'Always book me an aisle seat' })).toBeNull();
    });

    it('renders no chips when none are passed (other skins unchanged)', () => {
      render(<AgentClientSkin {...baseProps} />);
      expect(screen.queryByRole('group', { name: /suggested/i })).toBeNull();
    });
  });

  it('Dot shows what Ping decided under a reply, only when there is a verdict', () => {
    const messages = [
      { role: 'agent', text: 'Booked.', governance: { decision: 'PERMIT', tools: ['book_flight'] } },
      { role: 'agent', text: 'I cannot move miles.', governance: { decision: 'DENY', tools: ['transfer_miles'] } },
      { role: 'agent', text: 'Hello again.' },
    ];
    render(<AgentClientSkin {...baseProps} skin="dot" messages={messages} />);
    const cards = screen.getAllByTestId('dot-governance');
    expect(cards).toHaveLength(2); // the reply with no verdict shows nothing
    expect(cards[0].textContent).toContain('PERMIT');
    expect(cards[0].textContent).toContain('book_flight');
    expect(cards[1].textContent).toContain('DENY');
    expect(cards[1].textContent).toContain('transfer_miles');
  });

  it('other skins never show the governance card', () => {
    render(<AgentClientSkin {...baseProps} skin="claude" messages={[{ role: 'agent', text: 'Booked.', governance: { decision: 'PERMIT', tools: ['book_flight'] } }]} />);
    expect(screen.queryByTestId('dot-governance')).toBeNull();
  });
});
