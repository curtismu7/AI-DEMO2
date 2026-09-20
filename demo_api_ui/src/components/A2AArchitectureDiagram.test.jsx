import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useMermaidRender', () => ({
  useMermaidRender: () => ({ containerRef: { current: null }, error: null }),
}));

import A2AArchitectureDiagram, { A2A_ARCHITECTURE_DIAGRAM } from './A2AArchitectureDiagram';

describe('A2AArchitectureDiagram', () => {
  it('renders the implementation topology and explains the trust boundaries', () => {
    render(<A2AArchitectureDiagram onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: /a2a implementation architecture/i })).toBeInTheDocument();
    expect(screen.getByText(/Agent Card discovery/i)).toBeInTheDocument();
    expect(screen.getByText(/never a token/i)).toBeInTheDocument();
    expect(A2A_ARCHITECTURE_DIAGRAM).toContain('RFC 8693 Exchange #1');
    expect(A2A_ARCHITECTURE_DIAGRAM).toContain('message/send');
    expect(A2A_ARCHITECTURE_DIAGRAM).toContain('MCP Gateway');
    expect(A2A_ARCHITECTURE_DIAGRAM).toContain('No token crosses the A2A response');
  });
});
