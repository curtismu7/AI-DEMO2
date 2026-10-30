import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PocFlowPage from '../PocFlowPage';
import { parseSequence } from '../../utils/parseSequence';
import { POC_FLOW_DETAILS, POC_FLOW_PAYLOADS, POC_FLOW_SOURCE } from '../../config/pocFlow';

describe('POC flow sequence', () => {
  const model = parseSequence(POC_FLOW_SOURCE);
  const messages = model.items.filter((i) => i.from && i.to);

  it('has the 8 participants and the 24 messages of the POC diagram, in order', () => {
    expect(model.participants.map((p) => p.id)).toEqual(['B', 'App', 'IAM', 'AG', 'GW', 'AZ', 'MS', 'RS']);
    expect(messages).toHaveLength(24);
    expect(messages[0].text.replace(/\s+/g, ' ')).toMatch(/User initiates login/);
    expect(messages[10].text.replace(/\s+/g, ' ')).toMatch(/403 with identifier/);
    expect(messages[11].text.replace(/\s+/g, ' ')).toMatch(/JSON-RPC 2\.0 error/);
    expect(messages[14].text.replace(/\s+/g, ' ')).toMatch(/Replay the tool call/);
    expect(messages[23].from).toBe('AG');
    expect(messages[23].to).toBe('App');
  });

  it('has one payload slot per message, with the tokens of the exchange', () => {
    expect(POC_FLOW_PAYLOADS).toHaveLength(messages.length);
    const all = POC_FLOW_PAYLOADS.filter(Boolean).join('\n');
    expect(all).toMatch(/"act":/);
    expect(all).toMatch(/api:read, api:write, api:delete/);
    expect(all).toMatch(/JSON-RPC|jsonrpc/);
  });

  it('has reel details for every participant', () => {
    for (const p of model.participants) expect(POC_FLOW_DETAILS[p.id]).toBeTruthy();
  });

  it('renders on its own page with a link back to Diagrams', () => {
    render(<MemoryRouter><PocFlowPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'POC flow' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /All diagrams/ }).getAttribute('href')).toBe('/diagrams');
  });
});
