import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminToolsDropdown from '../AdminToolsDropdown';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn() },
}));

const TOOLS = [
  { id: 'lookup_customer', title: 'Look Up Customer', trigger: { type: 'chip', text: 'look up a customer' } },
  { id: 'p1_list_apps', title: 'List all apps', trigger: { type: 'chip', text: 'List all applications in our PingOne environment' }, adminAgent: true },
];

describe('AdminToolsDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: { tools: TOOLS } });
  });

  it('renders the Admin trigger', () => {
    render(<AdminToolsDropdown open={false} onOpenChange={() => {}} onSelect={() => {}} />);
    expect(screen.getByTestId('admin-tools-trigger')).toHaveTextContent(/Admin/);
  });

  it('loads and lists tools when open', async () => {
    render(<AdminToolsDropdown open onOpenChange={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/admin-tools', expect.any(Object)));
    expect(await screen.findByText('Look Up Customer')).toBeInTheDocument();
    expect(screen.getByText('List all apps')).toBeInTheDocument();
  });

  it('calls onSelect with the clicked tool', async () => {
    const onSelect = vi.fn();
    render(<AdminToolsDropdown open onOpenChange={() => {}} onSelect={onSelect} />);
    const button = await screen.findByText('Look Up Customer');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(TOOLS[0]);
  });
});
