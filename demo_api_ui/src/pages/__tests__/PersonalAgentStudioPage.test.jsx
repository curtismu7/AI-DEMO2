import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock TokenChainContext
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => ({ events: [] }),
}));

import PersonalAgentStudioPage from '../PersonalAgentStudioPage';

describe('PersonalAgentStudioPage', () => {
  it('renders page title', () => {
    render(<PersonalAgentStudioPage />);
    expect(screen.getByText('Personal Agent')).toBeTruthy();
  });

  it('renders all four skin tabs', () => {
    render(<PersonalAgentStudioPage />);
    expect(screen.getByText('Privilege')).toBeTruthy();
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('ChatGPT')).toBeTruthy();
    expect(screen.getByText('Gemini')).toBeTruthy();
  });

  it('shows Split and Pop Out buttons', () => {
    render(<PersonalAgentStudioPage />);
    expect(screen.getByText(/Split/i)).toBeTruthy();
    expect(screen.getByText(/Pop Out/i)).toBeTruthy();
  });

  it('starts in full-agent mode — security rail hidden', () => {
    render(<PersonalAgentStudioPage />);
    expect(screen.queryByText('Security Gates')).toBeNull();
  });

  it('shows security rail after clicking Split', () => {
    render(<PersonalAgentStudioPage />);
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
  });

  it('hides security rail when Split clicked again', () => {
    render(<PersonalAgentStudioPage />);
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.queryByText('Security Gates')).toBeNull();
  });

  it('switches active skin tab', () => {
    render(<PersonalAgentStudioPage />);
    fireEvent.click(screen.getByText('Claude'));
    // AgentClientSkin renders Claude title
    expect(screen.getAllByText('Claude').length).toBeGreaterThan(0);
  });

  it('shows popped-out placeholder and security rail after Pop Out', () => {
    // Mock window.open
    vi.stubGlobal('open', vi.fn(() => ({ document: { write: vi.fn(), close: vi.fn() } })));
    render(<PersonalAgentStudioPage />);
    fireEvent.click(screen.getByText(/Pop Out/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
    expect(screen.getByText(/active in external window/i)).toBeTruthy();
  });
});
