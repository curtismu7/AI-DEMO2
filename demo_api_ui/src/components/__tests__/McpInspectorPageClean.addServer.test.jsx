import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InspectorFieldProvider } from '../../context/InspectorFieldContext';

/**
 * The Custom Server tab's "Add server" form — the one gap left after PR #2897
 * wired the tab up to real saved profiles (mcpProfileStore.js). It posts
 * straight to the already-working POST /api/mcp/inspector/profiles (not
 * through useInspectorSource, which only reads profiles) and then asks the
 * hook to reload and select the new one.
 */

const post = vi.fn();
vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: (...a) => post(...a) },
}));

const loadProfiles = vi.fn();
vi.mock('../../hooks/useInspectorSource', () => ({
  useInspectorSource: () => ({
    mode: 'profiles',
    tools: [],
    selectedTool: null,
    paramValues: {},
    outputTab: 'response',
    busy: false,
    loadingTools: false,
    lastTiming: null,
    mcpHistory: [],
    schemaProps: {},
    requiredParams: new Set(),
    outputContent: null,
    outputValue: null,
    banner: null,
    servers: [],
    profiles: [{ id: 'built-in-privilege-mcp', label: 'Privilege: Banking (banking-rest2)', isBuiltIn: true }],
    selectedProfileId: 'built-in-privilege-mcp',
    defaultProfileId: 'default-banking',
    config: { toolKey: 'name', paramsKey: 'tool' },
    setSelectedTool: vi.fn(),
    setParamValues: vi.fn(),
    setOutputTab: vi.fn(),
    setSelectedProfileId: vi.fn(),
    handleExecute: vi.fn(),
    loadTools: vi.fn(),
    loadProfiles,
  }),
}));

import McpInspectorPageClean from '../McpInspectorPageClean';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/pingone-mcp-inspector?source=custom']}>
    <InspectorFieldProvider>
      <McpInspectorPageClean />
    </InspectorFieldProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  post.mockReset();
  loadProfiles.mockReset();
});

describe('Custom Server tab — Add server form', () => {
  it('is hidden until "+ Add server" is clicked', () => {
    renderPage();
    expect(screen.queryByPlaceholderText('e.g. Staging MCP server')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('+ Add server'));
    expect(screen.getByPlaceholderText('e.g. Staging MCP server')).toBeInTheDocument();
  });

  it('posts an http profile and reloads/selects the new one on success', async () => {
    post.mockResolvedValue({ data: { profile: { id: 'new-http-id' } } });
    renderPage();

    fireEvent.click(screen.getByText('+ Add server'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Staging MCP server'), { target: { value: 'Staging' } });
    fireEvent.change(screen.getByPlaceholderText('https://example.test/mcp'), { target: { value: 'https://staging.test/mcp' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/mcp/inspector/profiles', {
      label: 'Staging',
      transport: 'http',
      url: 'https://staging.test/mcp',
    }));
    await waitFor(() => expect(loadProfiles).toHaveBeenCalledWith('new-http-id'));
    // The form closes and clears on success.
    expect(screen.queryByPlaceholderText('e.g. Staging MCP server')).not.toBeInTheDocument();
  });

  it('shows a validation error instead of posting when the URL is blank', async () => {
    renderPage();
    fireEvent.click(screen.getByText('+ Add server'));
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('Server URL is required.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('switches to command/args fields for stdio and posts those instead of a url', async () => {
    post.mockResolvedValue({ data: { profile: { id: 'new-stdio-id' } } });
    renderPage();

    fireEvent.click(screen.getByText('+ Add server'));
    fireEvent.change(screen.getByDisplayValue('http'), { target: { value: 'stdio' } });
    fireEvent.change(screen.getByPlaceholderText('node'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByPlaceholderText('server.js --stdio'), { target: { value: '-y some-mcp-server' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/mcp/inspector/profiles', {
      label: '',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'some-mcp-server'],
    }));
  });

  it('surfaces the server error and keeps the form open on failure', async () => {
    post.mockRejectedValue({ message: 'admin session required' });
    renderPage();

    fireEvent.click(screen.getByText('+ Add server'));
    fireEvent.change(screen.getByPlaceholderText('https://example.test/mcp'), { target: { value: 'https://x.test/mcp' } });
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('admin session required')).toBeInTheDocument();
    expect(loadProfiles).not.toHaveBeenCalled();
  });
});
