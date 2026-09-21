import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import McpTrafficPage from '../McpTrafficPage';

vi.mock('../../services/webMcpClient', () => ({
  listMcpToolsWithStream: vi.fn().mockResolvedValue({
    tools: [{ name: 'get_my_accounts', description: 'List accounts.', inputSchema: { properties: {} } }],
  }),
  callMcpTool: vi.fn().mockResolvedValue({ result: { count: 2, status: 'success' } }),
  openMcpToolStream: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('../../services/mcpCallStore', () => ({
  getCalls: vi.fn(() => []),
  subscribe: vi.fn(() => () => {}),
  appendMcpCall: vi.fn(),
}));

it('shows the MCP server response in Form view with a JSON toggle', async () => {
  render(<McpTrafficPage />);
  fireEvent.click(await screen.findByText('get_my_accounts'));
  fireEvent.click(screen.getByRole('button', { name: 'Call Tool' }));

  await waitFor(() => expect(screen.getByText('Server Response')).toBeInTheDocument());
  expect(screen.getByRole('group', { name: 'Server response view' })).toBeInTheDocument();
    expect(screen.getByText('result.count')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  expect(screen.getByText(/"count"/)).toBeInTheDocument();
});
