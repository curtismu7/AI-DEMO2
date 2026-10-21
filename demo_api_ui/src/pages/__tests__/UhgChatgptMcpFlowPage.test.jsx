import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UhgChatgptMcpFlowPage from '../UhgChatgptMcpFlowPage';
import { parseSequence } from '../../utils/parseSequence';
import { UHG_MCP_FLOW_DETAILS, UHG_MCP_FLOW_SOURCE } from '../../config/uhgChatgptMcpFlow';

describe('UHG ChatGPT MCP authorization sequence', () => {
  const model = parseSequence(UHG_MCP_FLOW_SOURCE);
  const messages = model.items.filter((i) => i.from && i.to);

  it('has the six participants and the 16 numbered messages of the proposal slide, in order', () => {
    expect(model.participants.map((p) => p.id)).toEqual(['M', 'C', 'PF', 'H', 'G', 'S']);
    expect(messages).toHaveLength(16);
    expect(messages[0].text).toMatch(/Asks a benefits or drug-price question/);
    expect(messages[9].text).toMatch(/POST \/as\/token\.oauth2/);
    expect(messages[12].text).toMatch(/RFC 8693 exchange/);
    expect(messages[15].text).toMatch(/Trusted answer/);
  });

  it('has reel details for every participant', () => {
    for (const p of model.participants) expect(UHG_MCP_FLOW_DETAILS[p.id]).toBeTruthy();
  });

  it('renders on its own page with a link back to Diagrams', () => {
    render(<MemoryRouter><UhgChatgptMcpFlowPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'ChatGPT to the UHG Digital Front Door' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /All diagrams/ }).getAttribute('href')).toBe('/diagrams');
  });
});
