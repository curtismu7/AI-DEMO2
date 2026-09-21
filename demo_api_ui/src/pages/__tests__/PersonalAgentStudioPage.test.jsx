import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock TokenChainContext
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => ({ events: [] }),
}));

import PersonalAgentStudioPage from '../PersonalAgentStudioPage';

const renderStudio = () => render(
  <MemoryRouter>
    <PersonalAgentStudioPage />
  </MemoryRouter>,
);

describe('PersonalAgentStudioPage', () => {
  it('renders page title', () => {
    renderStudio();
    expect(screen.getByText('Personal Agent')).toBeTruthy();
  });

  it('renders all skin tabs', () => {
    renderStudio();
    expect(screen.getByText('Privilege')).toBeTruthy();
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('Terminal')).toBeTruthy();
    expect(screen.getByText('ChatGPT')).toBeTruthy();
    expect(screen.getByText('Gemini')).toBeTruthy();
  });

  it('shows Split and Pop Out buttons', () => {
    renderStudio();
    expect(screen.getByText(/Split/i)).toBeTruthy();
    expect(screen.getByText(/🪟 Pop Out/i)).toBeTruthy();
  });

  it('starts in full-agent mode — security rail hidden', () => {
    renderStudio();
    expect(screen.queryByText('Security Gates')).toBeNull();
  });

  it('shows security rail after clicking Split', () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
  });

  it('hides security rail when Split clicked again', () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.queryByText('Security Gates')).toBeNull();
  });

  it('switches active skin tab', () => {
    renderStudio();
    fireEvent.click(screen.getByText('Claude'));
    // AgentClientSkin renders Claude title
    expect(screen.getAllByText('Claude').length).toBeGreaterThan(0);
  });

  it('shows popped-out placeholder and security rail after Pop Out', () => {
    // Mock window.open
    vi.stubGlobal('open', vi.fn(() => ({ document: { write: vi.fn(), close: vi.fn() } })));
    renderStudio();
    fireEvent.click(screen.getByText(/🪟 Pop Out/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
    expect(screen.getByText(/active in external window/i)).toBeTruthy();
  });
});
