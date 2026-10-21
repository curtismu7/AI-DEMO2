import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ok, err, warn } from '../inspectorCalls';
import ResultPreview from '../ResultPreview';

const call = (body, kind = 'mcp', extra = {}) => ({ id: 'c1', kind, title: 'get_weather', status: ok('200 OK'), response: { label: 'JSON-RPC response', body }, ...extra });
const rpc = (result) => ({ jsonrpc: '2.0', id: 2, result });
const text = (t) => ({ type: 'text', text: t });

describe('ResultPreview', () => {
  it('shows the tool\'s prose as the answer, not the envelope', () => {
    render(<ResultPreview call={call(rpc({ content: [text('Sunny, 21 C.')] }))} />);
    expect(screen.getByRole('region', { name: 'What the tool returned' })).toBeInTheDocument();
    expect(screen.getByText('Sunny, 21 C.')).toBeInTheDocument();
    expect(screen.getByText('Returned')).toBeInTheDocument();
    expect(screen.queryByText(/jsonrpc/)).toBeNull();
  });

  it('renders JSON text as readable key values', () => {
    render(<ResultPreview call={call(rpc({ content: [text(JSON.stringify({ name: 'Checking', balance: 120 }))] }))} />);
    // JsonFormView lists important keys in Key Values and again in All Fields.
    expect(screen.getAllByText('Checking').length).toBeGreaterThan(0);
    expect(screen.getByText('Key Values')).toBeInTheDocument();
  });

  it('says so, in red prose, when the tool reports an error', () => {
    render(<ResultPreview call={call(rpc({ isError: true, content: [text('Error: Provide a city_name.')] }))} />);
    expect(screen.getByText('Tool reported an error')).toBeInTheDocument();
    expect(screen.getByText('Error: Provide a city_name.')).toHaveClass('insp-prose--err');
  });

  it('explains an empty result and where the raw response is', () => {
    render(<ResultPreview call={call(rpc({ content: [] }))} />);
    expect(screen.getByText('Nothing returned')).toBeInTheDocument();
    expect(screen.getByText(/Request & response/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('copies the readable text', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ResultPreview call={call(rpc({ content: [text('Sunny, 21 C.')] }))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Sunny, 21 C.');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('renders nothing for non-tool calls (API traffic, decision logs)', () => {
    const { container } = render(<ResultPreview call={call({ ok: true }, 'api')} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('also reads gateway tools/call results', () => {
    render(<ResultPreview call={call({ status: 200, result: { content: [text('Rain tomorrow')] } }, 'tools/call')} />);
    expect(screen.getByText('Rain tomorrow')).toBeInTheDocument();
  });

  it('says the tool did not run when the call was refused, instead of presenting the refusal as an answer', () => {
    render(<ResultPreview call={call({ denied: true, status: 403, message: 'Denied by PingOne Authorize' }, 'tools/call', { status: err('403') })} />);
    expect(screen.getByRole('region', { name: 'Why the tool did not run' })).toBeInTheDocument();
    expect(screen.getByText('Tool did not run')).toBeInTheDocument();
    expect(screen.queryByText('Returned')).toBeNull();
    expect(screen.getByText('Denied by PingOne Authorize')).toBeInTheDocument();
  });

  it('a held or rate-limited call is "did not run" in a warning tone, with the banner text when the body is empty', () => {
    render(<ResultPreview call={call(null, 'tools/call', { ms: 5, status: warn('429 Rate limited'), banner: { tone: 'warn', title: 'Rate limited', text: 'Slow down for 2 s.' } })} />);
    expect(screen.getByText('Tool did not run')).toHaveClass('warn');
    expect(screen.getByText('Slow down for 2 s.')).toBeInTheDocument();
  });

  it('a tool\'s own isError is still "What the tool returned", not "did not run"', () => {
    render(<ResultPreview call={call(rpc({ isError: true, content: [text('Error: Provide a city_name.')] }), 'mcp', { status: err('Tool error') })} />);
    expect(screen.getByRole('region', { name: 'What the tool returned' })).toBeInTheDocument();
    expect(screen.getByText('Tool reported an error')).toBeInTheDocument();
  });

  it('shows nothing for a call still in flight (no body, not finished), e.g. waiting on an elicitation', () => {
    const { container } = render(<ResultPreview call={call(null, 'mcp', { ms: null, status: warn('Waiting for you'), banner: { tone: 'warn', text: 'Confirm the withdrawal of $500?' } })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing for a log record: its body is an audit decision, not a tool result', () => {
    const { container } = render(<ResultPreview call={call({ decision: 'PERMIT' }, 'tools/call', { input: { tool: 'get_weather', args: {}, partial: true } })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('makes its scroll regions keyboard-reachable and labelled', () => {
    render(<ResultPreview call={call(rpc({ content: [text('Sunny, 21 C.'), text(JSON.stringify({ name: 'Paris' }))] }))} />);
    for (const name of ['Tool output text', 'Tool output data']) {
      const region = screen.getByRole('region', { name });
      expect(region).toHaveAttribute('tabindex', '0');
    }
  });

  it('announces a copy to screen readers and forgets it when another call is selected', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } });
    const { rerender } = render(<ResultPreview call={call(rpc({ content: [text('One')] }))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Copied to the clipboard')).toBeInTheDocument();
    rerender(<ResultPreview call={{ ...call(rpc({ content: [text('Two')] })), id: 'c2' }} />);
    expect(await screen.findByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByText('Copied to the clipboard')).toBeNull();
  });
});
