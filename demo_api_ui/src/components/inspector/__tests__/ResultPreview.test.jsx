import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ResultPreview from '../ResultPreview';

const call = (body, kind = 'mcp') => ({ id: 'c1', kind, title: 'get_weather', response: { label: 'JSON-RPC response', body } });
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
});
