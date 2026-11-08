import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import bffAxios from '../../services/bffAxios';
import PingOneAuthorizeConsoleClean from '../PingOneAuthorizeConsoleClean';

window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

vi.mock('../../services/bffAxios', () => ({ __esModule: true, default: { get: vi.fn(), post: vi.fn() } }));

const DECISION = { data: { decision: 'PERMIT', decisionId: 'd1', pingoneResponse: { decision: 'PERMIT', statements: [] }, pingoneRequest: { body: {} } } };

function Harness({ url = '/', ...props }) {
  const [records, setRecords] = useState([]);
  return (
    <MemoryRouter initialEntries={[url]}>
      <PingOneAuthorizeConsoleClean
        endpointId="ep-1" endpoints={[{ id: 'ep-1', name: 'EP' }]} policiesState={{ policies: [], error: null }}
        records={records} setRecords={setRecords} {...props}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  bffAxios.get.mockResolvedValue({ data: {} });
  bffAxios.post.mockResolvedValue(DECISION);
});

describe('PingOneAuthorizeConsoleClean', () => {
  it.each([['loading', 'Loading'], ['error', 'Unavailable'], ['live', 'Real P1AZ']])('Real P1AZ mode chip for %s is %s', (loadState, label) => {
    render(<Harness loadState={loadState} defaultMode="live" />);
    expect(screen.getByText(label, { selector: '.insp-chip' })).toBeInTheDocument();
  });

  it('Resend re-runs under the call\'s own preset, not the selected one', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'MCP tool' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('heading', { name: 'transfer' });
    fireEvent.click(screen.getByRole('button', { name: 'Transaction' }));
    bffAxios.post.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(bffAxios.post).toHaveBeenCalled());
    expect(bffAxios.post.mock.calls[0][1].parameters.ToolName).toBe('transfer');
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'transfer' }).length).toBeGreaterThan(0));
    expect(screen.queryByText(/undefined \$NaN/)).toBeNull();
  });

  it('log rows have no input: Resend and Edit are disabled and nothing throws', () => {
    render(<Harness recent={[{ id: 'abcdef123456', decision: 'PERMIT', requestedAt: '2026-10-17T10:00:00Z' }]} />);
    fireEvent.click(screen.getByLabelText(/Include PingOne/));
    expect(screen.getByRole('button', { name: 'Resend' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled();
  });

  it('a staged replay runs exactly once, even when the preset changes afterwards', async () => {
    const pendingTest = { preset: 'custom', parameters: { A: 'b' }, autoRun: true };
    render(<Harness pendingTest={pendingTest} />);
    await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(1));
    await screen.findByRole('heading', { name: 'Custom decision' });
    fireEvent.click(screen.getByRole('button', { name: 'Transaction' }));
    fireEvent.click(screen.getByRole('button', { name: 'MCP tool' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(bffAxios.post).toHaveBeenCalledTimes(1);
  });
});

describe('PingOneAuthorizeConsoleClean Mock | Real P1AZ', () => {
  it('opens in Mock: the Mock chip, the Mock button pressed, and a Send that goes out as mode:mock', async () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Mock' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Mock', { selector: '.insp-chip' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(1));
    expect(bffAxios.post.mock.calls[0][1]).toMatchObject({ mode: 'mock' });
  });

  it('Mock works with no endpoint; Real P1AZ sends no mode and needs one', async () => {
    render(<Harness endpointId="" endpoints={[]} loadState="error" />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
    expect(screen.getByText('Unavailable', { selector: '.insp-chip' })).toBeInTheDocument();
    // aria-disabled, not disabled, so keyboard focus is never dropped; the click does nothing.
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(bffAxios.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mock' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('Real P1AZ with an endpoint sends no mode', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(1));
    expect(bffAxios.post.mock.calls[0][1]).not.toHaveProperty('mode');
  });

  it('a staged replay goes to PingOne, not the simulator, even though Mock is the default', async () => {
    render(<Harness pendingTest={{ preset: 'custom', parameters: { A: 'b' }, autoRun: true }} />);
    await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(1));
    expect(bffAxios.post.mock.calls[0][1]).not.toHaveProperty('mode');
    expect(screen.getByRole('button', { name: 'Real P1AZ' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('PingOneAuthorizeConsoleClean Vertical select', () => {
  const typeOptions = () => [...screen.getByLabelText('Type').options].map((o) => o.value);
  const toolName = () => screen.getByLabelText('Tool name').value;

  it('defaults to banking: all three presets, three transaction types, ToolName transfer', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Vertical').value).toBe('banking');
    expect(screen.getByRole('button', { name: 'Transaction' })).toBeInTheDocument();
    expect(typeOptions()).toEqual(['transfer', 'withdrawal', 'deposit']);
    fireEvent.click(screen.getByRole('button', { name: 'MCP tool' }));
    expect(toolName()).toBe('transfer');
  });

  it('?vertical= sets the preset defaults: its approval tool and its transaction type', async () => {
    render(<Harness url="/?vertical=healthcare" />);
    expect(screen.getByLabelText('Vertical').value).toBe('healthcare');
    expect(typeOptions()).toEqual(['transfer']);
    fireEvent.click(screen.getByRole('button', { name: 'MCP tool' }));
    expect(toolName()).toBe('pay_bill');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(bffAxios.post).toHaveBeenCalled());
    expect(bffAxios.post.mock.calls[0][1].parameters.ToolName).toBe('pay_bill');
  });

  it("the Transaction amount defaults to the vertical's approval amount; banking keeps 5000", async () => {
    render(<Harness />);
    expect(screen.getByLabelText('Amount').value).toBe('5000');
    fireEvent.change(screen.getByLabelText('Vertical'), { target: { value: 'retail' } });
    await waitFor(() => expect(screen.getByLabelText('Amount').value).toBe('1999'));
  });

  it('?vertical= sets the initial Transaction amount', () => {
    render(<Harness url="/?vertical=healthcare" />);
    expect(screen.getByLabelText('Amount').value).toBe('650');
  });

  it('an unknown ?vertical= falls back to banking', () => {
    render(<Harness url="/?vertical=nope" />);
    expect(screen.getByLabelText('Vertical').value).toBe('banking');
    expect(typeOptions()).toEqual(['transfer', 'withdrawal', 'deposit']);
  });

  it('changing the vertical swaps the preset defaults', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'MCP tool' }));
    fireEvent.change(screen.getByLabelText('Vertical'), { target: { value: 'airlines' } });
    await waitFor(() => expect(toolName()).toBe('pay_airline_fee'));
    fireEvent.click(screen.getByRole('button', { name: 'Transaction' }));
    expect(typeOptions()).toEqual(['transfer']);
  });

  it('Resend and Edit use the call\'s own input after a vertical change', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Transaction' }));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'withdrawal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Vertical'), { target: { value: 'retail' } });
    await waitFor(() => expect(typeOptions()).toEqual(['transfer']));
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(bffAxios.post).toHaveBeenCalledTimes(2));
    expect(bffAxios.post.mock.calls[1][1].parameters.TransactionType).toBe('withdrawal');
    fireEvent.click(screen.getAllByRole('button', { name: /Edit/ })[0]);
    expect(screen.getByLabelText('Type').value).toBe('withdrawal');
  });
});

describe('PingOneAuthorizeConsoleClean host hooks (Ping UI page)', () => {
  it('Send takes the host button class, defaulting to the inspector button', () => {
    const { unmount } = render(<Harness />);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('insp-btn');
    unmount();
    render(<Harness buttonClassName="pu-btn pu-btn--primary" />);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('pu-btn', 'pu-btn--primary');
  });

  it('reports the engine to the host: mock on open, live after the switch, mock again', () => {
    const onModeChange = vi.fn();
    render(<Harness onModeChange={onModeChange} />);
    expect(onModeChange).toHaveBeenLastCalledWith('mock');
    fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
    expect(onModeChange).toHaveBeenLastCalledWith('live');
    fireEvent.click(screen.getByRole('button', { name: 'Mock' }));
    expect(onModeChange).toHaveBeenLastCalledWith('mock');
  });

  it('keeps keyboard focus on Send while it sends, and ignores a second press', async () => {
    let release;
    bffAxios.post.mockReturnValue(new Promise((r) => { release = r; }));
    render(<Harness />);
    const send = screen.getByRole('button', { name: 'Send' });
    send.focus();
    fireEvent.click(send);
    const sending = await screen.findByRole('button', { name: 'Sending…' });
    expect(sending).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(sending);
    fireEvent.click(sending);
    expect(bffAxios.post).toHaveBeenCalledTimes(1);
    release(DECISION);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).not.toHaveAttribute('aria-disabled'));
  });
});

describe('PingOneAuthorizeConsoleClean honesty and announcements', () => {
  const MOCK_DECISION = { data: { decision: 'DENY', engine: 'simulated', decisionId: 'm1', pingoneResponse: { decision: 'DENY', statements: [] } } };

  it('after a Mock Send the Diagram BFF node no longer says it calls PingOne; a Real call keeps the original text', async () => {
    bffAxios.post.mockResolvedValue(MOCK_DECISION);
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Mock decision: DENY/);
    fireEvent.click(screen.getByRole('tab', { name: /Diagram/ }));
    expect(await screen.findByText('and answers itself')).toBeInTheDocument();
    expect(screen.getByText('PingOne is not called')).toBeInTheDocument();
    expect(screen.queryByText('and calls PingOne')).toBeNull();
    unmount();
    bffAxios.post.mockResolvedValue(DECISION);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/PingOne Authorize decision: PERMIT/);
    fireEvent.click(screen.getByRole('tab', { name: /Diagram/ }));
    expect(await screen.findByText('and calls PingOne')).toBeInTheDocument();
    expect(screen.queryByText('and answers itself')).toBeNull();
  });

  it('a polite live region announces in flight, then the result, and never calls a Mock verdict PingOne\'s', async () => {
    let resolve;
    bffAxios.post.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<Harness />);
    const live = screen.getByTestId('p1az-status');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(live).toHaveTextContent('Sending the decision request');
    resolve(MOCK_DECISION);
    await waitFor(() => expect(live).toHaveTextContent('Mock decision: DENY. Simulated by the built-in policy; PingOne was not called.'));
  });

  it('the Real P1AZ hero chip does not read as healthy when no endpoint is configured', () => {
    render(<Harness endpointId="" endpoints={[]} defaultMode="live" />);
    expect(screen.getByText('No endpoint', { selector: '.insp-chip' })).toBeInTheDocument();
    expect(screen.queryByText('Real P1AZ', { selector: '.insp-chip' })).toBeNull();
  });

  it('a failed call is announced with its error', async () => {
    bffAxios.post.mockRejectedValue(new Error('network down'));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('p1az-status')).toHaveTextContent('The decision request failed: network down'));
  });

  it('Real P1AZ with no endpoint: Send stays focusable, explains why, and announces the reason on press', () => {
    render(<Harness endpointId="" endpoints={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Real P1AZ' }));
    const send = screen.getByRole('button', { name: 'Send' });
    send.focus();
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).not.toBeDisabled();
    expect(screen.getByText(/no PingOne Authorize decision endpoint is configured/)).toHaveAttribute('id', send.getAttribute('aria-describedby'));
    fireEvent.click(send);
    expect(document.activeElement).toBe(send);
    expect(bffAxios.post).not.toHaveBeenCalled();
    expect(screen.getByTestId('p1az-status')).toHaveTextContent(/Send is unavailable in Real P1AZ/);
  });
});
