/**
 * McpInspectorSetupWizard — 4-step wizard that generates env snippets,
 * start commands, and inspector links.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import McpInspectorSetupWizard from '../McpInspectorSetupWizard';

const STORAGE_KEY = 'mcpInspectorWizard.v1';

function renderWizard(props = {}) {
  return render(
    <MemoryRouter>
      <McpInspectorSetupWizard
        appBaseUrl="https://local.ping-devops.com:4000"
        mcpAgentUrl="http://localhost:8000"
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('McpInspectorSetupWizard — expand / collapse', () => {
  it('renders collapsed by default with "▶ Open wizard" toggle', () => {
    renderWizard();
    expect(screen.getByRole('button', { name: '▶ Open wizard' })).toBeInTheDocument();
    expect(screen.queryByText(/Step 1/)).toBeNull();
  });

  it('expands to step 1 when "Open wizard" is clicked', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: '▶ Open wizard' }));
    expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument();
    expect(screen.getByText(/Where are you running/)).toBeInTheDocument();
  });

  it('collapses again when the toggle is clicked a second time', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: '▶ Open wizard' }));
    fireEvent.click(screen.getByRole('button', { name: '▼ Hide wizard' }));
    expect(screen.queryByText(/Step 1/)).toBeNull();
  });
});

describe('McpInspectorSetupWizard — step navigation', () => {
  function openAndAdvance(steps = 1) {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: '▶ Open wizard' }));
    for (let i = 0; i < steps; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
  }

  it('step 1 → 2 shows the base URL input', () => {
    openAndAdvance(1);
    expect(screen.getByText(/Step 2 of 4/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://demo-api-server:3001')).toBeInTheDocument();
  });

  it('step 2 → 3 shows the MCP WebSocket URL input', () => {
    openAndAdvance(2);
    expect(screen.getByText(/Step 3 of 4/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('ws://localhost:8080')).toBeInTheDocument();
  });

  it('step 3 → 4 shows the inspector preference picker and generated output', () => {
    openAndAdvance(3);
    expect(screen.getByText(/Step 4 of 4/)).toBeInTheDocument();
    expect(screen.getByText('Generated output')).toBeInTheDocument();
  });

  it('Back on step 2 returns to step 1', () => {
    openAndAdvance(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument();
  });

  it('Back on step 4 returns to step 3', () => {
    openAndAdvance(3);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/Step 3 of 4/)).toBeInTheDocument();
  });
});

describe('McpInspectorSetupWizard — generated output', () => {
  function goToStep4() {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: '▶ Open wizard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // → 2
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // → 3
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // → 4
  }

  it('builtin choice (default) shows the /mcp-inspector link and env snippet', () => {
    goToStep4();
    expect(screen.getByRole('link', { name: /Open MCP Inspector/ })).toBeInTheDocument();
    expect(screen.getByText(/DEMO_API_BASE_URL/)).toBeInTheDocument();
  });

  it('builtin URL is derived from appBaseUrl prop', () => {
    goToStep4();
    expect(screen.getByText(/local\.ping-devops\.com:4000\/mcp-inspector/)).toBeInTheDocument();
  });

  it('switching to official shows npx @modelcontextprotocol/inspector command', () => {
    goToStep4();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'official' } });
    expect(screen.getByText(/npx @modelcontextprotocol\/inspector/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open MCP Inspector/ })).toBeNull();
  });

  it('switching to both shows both the built-in link and the npx command', () => {
    goToStep4();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'both' } });
    expect(screen.getByRole('link', { name: /Open MCP Inspector/ })).toBeInTheDocument();
    expect(screen.getByText(/npx @modelcontextprotocol\/inspector/)).toBeInTheDocument();
  });

  it('env snippet includes mcpAgentUrl when provided', () => {
    goToStep4();
    expect(screen.getByText(/MCP_AGENT_URL=http:\/\/localhost:8000/)).toBeInTheDocument();
  });

  it('start MCP server command always appears at step 4', () => {
    goToStep4();
    expect(screen.getByText(/npm run build/)).toBeInTheDocument();
  });
});

describe('McpInspectorSetupWizard — reset and localStorage', () => {
  it('Reset answers returns to step 1 with default selections', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: '▶ Open wizard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // → step 2
    fireEvent.click(screen.getByRole('button', { name: 'Reset answers' }));
    expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Local dev/ }).selected).toBe(true);
  });

  it('restores persisted answers from localStorage on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ deploy: 'vercel', baseUrl: 'https://my-app.vercel.app', mcpWsUrl: 'ws://example.com:9000', inspectorChoice: 'official' }),
    );
    renderWizard({ appBaseUrl: undefined });
    fireEvent.click(screen.getByRole('button', { name: '▶ Open wizard' }));
    // persisted deploy should be pre-selected on step 1
    expect(screen.getByRole('option', { name: /Hosted on Vercel/ }).selected).toBe(true);
  });
});
