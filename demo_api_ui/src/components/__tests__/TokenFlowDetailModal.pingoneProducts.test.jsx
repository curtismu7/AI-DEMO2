import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '../../context/ThemeContext';
import TokenFlowDetailModal, { resolvePingOneProductCalls } from '../TokenFlowDetailModal';

describe('PingOne product call summaries', () => {
  it('only returns PingOne products represented by the selected node', () => {
    const selected = {
      id: 'authorize',
      status: 'done',
      detail: { decision: { outcome: 'PERMIT', decisionContext: 'McpFirstTool' } },
    };

    expect(resolvePingOneProductCalls(selected)).toEqual([
      {
        product: 'PingOne Authorize',
        call: 'MCP tool-call check',
        status: 'PERMIT',
      },
    ]);
  });

  it('does not expose token claims or generic step detail for non-PingOne nodes', () => {
    expect(resolvePingOneProductCalls({
      id: 'exchange',
      status: 'done',
      detail: { claims: { scope: 'gateway:mcp:invoke' } },
    })).toEqual([]);
  });
});

describe('Flow Detail theme control', () => {
  it('uses the shared theme context when the Flow Detail toggle is clicked', () => {
    render(
      <ThemeProvider>
        <TokenFlowDetailModal isOpen onClose={() => {}} />
      </ThemeProvider>,
    );

    const toggle = screen.getByRole('button', { name: /switch to dark mode/i });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    fireEvent.click(toggle);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument();
  });
});
