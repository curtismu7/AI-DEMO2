import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UhgChatgptMcpFlowPage from '../UhgChatgptMcpFlowPage';
import { parseSequence } from '../../utils/parseSequence';
import { UHG_MCP_FLOW_DETAILS, UHG_MCP_FLOW_PAYLOADS, UHG_MCP_FLOW_SOURCE } from '../../config/uhgChatgptMcpFlow';

describe('UHG ChatGPT MCP authorization sequence', () => {
  const model = parseSequence(UHG_MCP_FLOW_SOURCE);
  const messages = model.items.filter((i) => i.from && i.to);

  it('opens with the catalog pattern, then has the 16 numbered messages of the proposal slide, in order', () => {
    expect(model.participants.map((p) => p.id)).toEqual(['M', 'K', 'C', 'PF', 'H', 'G', 'S']);
    expect(messages).toHaveLength(20);
    expect(messages.slice(0, 4).map((m) => `${m.from}>${m.to}`)).toEqual(['G>K', 'K>G', 'M>K', 'K>C']);
    expect(messages[0].text.replace(/\s+/g, " ")).toMatch(/publishes its MCP gateway to the catalog/);
    expect(messages[4].text.replace(/\s+/g, " ")).toMatch(/Asks a benefits or drug-price question/);
    expect(messages[13].text.replace(/\s+/g, " ")).toMatch(/POST \/as\/token\.oauth2/);
    expect(messages[16].text.replace(/\s+/g, " ")).toMatch(/RFC 8693 exchange/);
    expect(messages[19].text.replace(/\s+/g, " ")).toMatch(/Trusted answer/);
  });

  it('has one payload slot per message, with the tokens the proposal names', () => {
    expect(UHG_MCP_FLOW_PAYLOADS).toHaveLength(messages.length);
    const all = UHG_MCP_FLOW_PAYLOADS.filter(Boolean).join('\n');
    expect(all).toMatch(/ID token from HSID/);
    expect(all).toMatch(/"aud": "https:\/\/mcp\.uhg\.com"/);
    expect(all).toMatch(/"act":/);
    expect(all).toMatch(/code_verifier/);
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
