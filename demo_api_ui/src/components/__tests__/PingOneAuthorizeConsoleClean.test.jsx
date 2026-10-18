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
  it.each([['loading', 'Loading'], ['error', 'Unavailable'], ['live', 'Live']])('mode chip for %s is %s', (loadState, label) => {
    render(<Harness loadState={loadState} />);
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
    expect(screen.getByLabelText('Amount').value).toBe('500');
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
