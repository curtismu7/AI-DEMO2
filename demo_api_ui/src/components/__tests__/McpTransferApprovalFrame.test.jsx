import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import McpTransferApprovalFrame from '../McpTransferApprovalFrame';

describe('McpTransferApprovalFrame', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a sandboxed App and sends the transfer snapshot after ready', () => {
    render(
      <McpTransferApprovalFrame
        snapshot={{ amount: 300, fromAccountId: 'checking', toAccountId: 'savings' }}
        accounts={[{ id: 'checking', name: 'Checking' }, { id: 'savings', name: 'Savings' }]}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const iframe = screen.getByTitle('MCP transfer approval');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    const postMessage = vi.spyOn(iframe.contentWindow, 'postMessage');
    act(() => {
      fireEvent.load(iframe);
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow,
        data: { type: 'mcp-app-ready' },
      }));
    });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'mcp-app-host-init',
      snapshot: expect.objectContaining({ amount: 300 }),
    }), '*');
  });

  it('maps App tool calls to approve and reject callbacks only from the iframe', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<McpTransferApprovalFrame snapshot={{ amount: 300 }} accounts={[]} onApprove={onApprove} onReject={onReject} />);
    const iframe = screen.getByTitle('MCP transfer approval');
    act(() => {
      fireEvent.load(iframe);
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow,
        data: { type: 'mcp-app-ready' },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        source: iframe.contentWindow,
        data: { method: 'tools/call', params: { name: 'approve_transfer' } },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        source: window,
        data: { method: 'tools/call', params: { name: 'reject_transfer' } },
      }));
    });
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });
});
