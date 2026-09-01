/**
 * PingOneMcpInspector — dark three-column inspector for the PingOne MCP server.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiClient from '../../services/apiClient';
import { ThemeProvider } from '../../context/ThemeContext';
import PingOneMcpInspector from '../PingOneMcpInspector';

// The component reads ThemeContext for its dark-mode toggle, and useTheme()
// throws outside a provider by design — so every render needs one, exactly as
// P1AzDashboard/TokenExchangeDashboard/NewRelicDashboard tests already do.
const renderInspector = () =>
  render(
    <ThemeProvider>
      <PingOneMcpInspector />
    </ThemeProvider>,
  );

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('../../utils/appToast', () => ({ notifyError: vi.fn() }));
vi.mock('../../utils/formatAxiosError', () => ({
  formatAxiosError: (_e, msg) => msg,
}));

const USER_TOOL = {
  name: 'GetUserById',
  description: 'Fetch one PingOne user.',
  inputSchema: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] },
};
const APP_TOOL = {
  name: 'ListApplications',
  description: 'List OIDC applications.',
  inputSchema: { type: 'object', properties: {}, required: [] },
};
const WRITE_TOOL = {
  name: 'CreateUser',
  description: 'Create a user.',
  inputSchema: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] },
};
const DAVINCI_TOOL = {
  name: 'TriggerDavinciFlow',
  description: 'Trigger a DaVinci flow.',
  inputSchema: { type: 'object', properties: { flow_id: { type: 'string' } }, required: ['flow_id'] },
};

function mockConnected(tools = [USER_TOOL, APP_TOOL]) {
  apiClient.get.mockResolvedValue({
    data: { enabled: true, tools, paramDefaults: {} },
  });
}

function mockDisconnected() {
  apiClient.get.mockResolvedValue({
    data: { enabled: false, tools: [] },
  });
}

beforeEach(() => vi.clearAllMocks());

describe('PingOneMcpInspector — status display', () => {
  it('shows "Disconnected" when enabled is false', async () => {
    mockDisconnected();
    renderInspector();
    await waitFor(() => expect(screen.getByText('Disconnected')).toBeInTheDocument());
  });

  it('shows "Connected — N tools" and Live:ON button when enabled', async () => {
    mockConnected([USER_TOOL, APP_TOOL]);
    renderInspector();
    await waitFor(() => expect(screen.getByText('Connected — 2 tools')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Live: ON' })).toBeInTheDocument();
  });

  it('Refresh button re-fetches tools', async () => {
    mockConnected();
    renderInspector();
    await waitFor(() => screen.getByText('Connected — 2 tools'));
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  });
});

describe('PingOneMcpInspector — tool tree grouping', () => {
  it('groups tools into correct buckets (Users, Applications)', async () => {
    mockConnected([USER_TOOL, APP_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('GetUserById'));
    expect(screen.getByText(/^Users \(\d+\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^Applications \(\d+\)$/)).toBeInTheDocument();
  });

  it('shows write badge "W" on create/update/delete tools', async () => {
    mockConnected([WRITE_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('CreateUser'));
    expect(screen.getByText('W')).toBeInTheDocument();
  });

  it('groups DaVinci tools into the DaVinci bucket', async () => {
    mockConnected([DAVINCI_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('TriggerDavinciFlow'));
    expect(screen.getByText(/^DaVinci \(\d+\)$/)).toBeInTheDocument();
  });

  it('search filter hides non-matching tools', async () => {
    mockConnected([USER_TOOL, APP_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('GetUserById'));
    fireEvent.change(screen.getByPlaceholderText('Filter tools…'), { target: { value: 'User' } });
    expect(screen.getByText('GetUserById')).toBeInTheDocument();
    expect(screen.queryByText('ListApplications')).toBeNull();
  });

  it('shows no-match message when search matches nothing', async () => {
    mockConnected([USER_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('GetUserById'));
    fireEvent.change(screen.getByPlaceholderText('Filter tools…'), { target: { value: 'xyzzy' } });
    expect(screen.getByText(/No tools match "xyzzy"/)).toBeInTheDocument();
  });
});

describe('PingOneMcpInspector — form and invoke', () => {
  it('selecting a tool shows its param input fields', async () => {
    mockConnected([USER_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('GetUserById'));
    fireEvent.click(screen.getByText('GetUserById'));
    // placeholder = schema.description || schema.type || 'value' → 'string' for {type:'string'}
    expect(screen.getByPlaceholderText('string')).toBeInTheDocument();
  });

  it('shows validation error when a required param is blank', async () => {
    mockConnected([USER_TOOL]);
    renderInspector();
    await waitFor(() => screen.getByText('GetUserById'));
    fireEvent.click(screen.getByText('GetUserById'));
    // Two Execute buttons (top + bottom of form)
    fireEvent.click(screen.getAllByRole('button', { name: /Execute/ })[0]);
    expect(screen.getByText(/Required: user_id/)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('posts to /api/mcp/inspector/pingone-invoke with typed params', async () => {
    mockConnected([USER_TOOL]);
    apiClient.post.mockResolvedValue({
      data: { response: { id: 'u1', username: 'alice' }, request: {}, timingsMs: { roundTrip: 8 } },
    });
    renderInspector();
    await waitFor(() => screen.getByText('GetUserById'));
    fireEvent.click(screen.getByText('GetUserById'));
    fireEvent.change(screen.getByPlaceholderText('string'), { target: { value: 'u1' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Execute/ })[0]);
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/mcp/inspector/pingone-invoke', {
        tool: 'GetUserById',
        params: { user_id: 'u1' },
      }),
    );
  });

  it('displays the response payload in the output pane', async () => {
    mockConnected([APP_TOOL]);
    apiClient.post.mockResolvedValue({
      data: { response: { count: 3 }, request: {}, timingsMs: { roundTrip: 5 } },
    });
    renderInspector();
    await waitFor(() => screen.getByText('ListApplications'));
    fireEvent.click(screen.getByText('ListApplications'));
    fireEvent.click(screen.getAllByRole('button', { name: /Execute/ })[0]);
    await waitFor(() => expect(screen.getByText(/count/)).toBeInTheDocument());
  });

  it('toggles Live: ON → OFF by PATCHing the feature flag', async () => {
    mockConnected();
    apiClient.patch.mockResolvedValue({ data: {} });
    renderInspector();
    await waitFor(() => screen.getByRole('button', { name: 'Live: ON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Live: ON' }));
    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/admin/feature-flags',
        expect.objectContaining({ updates: expect.objectContaining({ mcp_inspector_pingone_live: false }) }),
      ),
    );
  });
});
