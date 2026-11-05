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

  it('keeps line breaks in a multi-line agent reply', () => {
    const text = 'Line one\n\nLine two';
    render(<AgentClientSkin {...baseProps} skin="claude" messages={[{ role: 'agent', text }]} />);
    expect(screen.getByText((_, el) => el?.textContent === text && el.style.whiteSpace === 'pre-wrap')).toBeTruthy();
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

    it('after a reply, keeps the prompts not yet run as "Try next" and drops the one just sent', () => {
      const messages = [{ role: 'agent', text: 'Hi' }, { role: 'user', text: 'Always book me an aisle seat' }, { role: 'agent', text: 'Noted.' }];
      render(<AgentClientSkin {...baseProps} skin="dot" messages={messages} suggestions={suggestions} />);
      expect(screen.queryByRole('button', { name: 'Always book me an aisle seat' })).toBeNull();
      expect(screen.getByRole('button', { name: 'What do you remember about me?' })).toBeTruthy();
      expect(screen.getByText('Try next:')).toBeTruthy();
    });

    it('shows no "Try next" label on the empty state, and no chips once every prompt has been run', () => {
      const { rerender } = render(<AgentClientSkin {...baseProps} skin="dot" suggestions={suggestions} />);
      expect(screen.queryByText('Try next:')).toBeNull();
      const all = [{ role: 'agent', text: 'Hi' }, ...suggestions.map((t) => ({ role: 'user', text: t })), { role: 'agent', text: 'Done.' }];
      rerender(<AgentClientSkin {...baseProps} skin="dot" messages={all} suggestions={suggestions} />);
      expect(screen.queryByRole('group', { name: /suggested/i })).toBeNull();
    });

    it('renders no chips when none are passed (other skins unchanged)', () => {
      render(<AgentClientSkin {...baseProps} />);
      expect(screen.queryByRole('group', { name: /suggested/i })).toBeNull();
    });
  });

  it('constrains its root to the container so a long conversation scrolls instead of pushing the composer out of view', () => {
    const { container } = render(<AgentClientSkin {...baseProps} />);
    const root = container.querySelector('.agent-client-skin');
    expect(root.style.height).toBe('100%');
    expect(root.style.minHeight).toBe('0');
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

  it('never calls scrollIntoView — that scrolls the whole page, not just the chat', () => {
    const spy = vi.fn();
    // setupTests.js mocks this on HTMLElement.prototype, which shadows Element.prototype
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = spy;
    try {
      const { rerender } = render(<AgentClientSkin {...baseProps} />);
      rerender(<AgentClientSkin {...baseProps} messages={[...baseProps.messages, { role: 'user', text: 'hi' }]} />);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
