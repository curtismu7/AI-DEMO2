import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Stub window.location.search
Object.defineProperty(window, 'location', {
  writable: true,
  value: { search: '?skin=privilege&theme=dark' },
});

import PersonalAgentClientWindow from '../PersonalAgentClientWindow';

describe('PersonalAgentClientWindow', () => {
  it('renders without nav shell', () => {
    const { container } = render(<PersonalAgentClientWindow />);
    // No AdminSideNav — check nav element absent
    expect(container.querySelector('nav')).toBeNull();
  });

  it('renders Privilege AI Agent title for skin=privilege', () => {
    render(<PersonalAgentClientWindow />);
    expect(screen.getByText('Privilege AI Agent')).toBeTruthy();
  });

  it('renders live badge', () => {
    render(<PersonalAgentClientWindow />);
    expect(screen.getByText(/Live/i)).toBeTruthy();
  });
});
