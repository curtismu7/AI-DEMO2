import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UnitedPersonalAgentFlowPage from '../UnitedPersonalAgentFlowPage';
import { parseSequence } from '../../utils/parseSequence';
import { UNITED_FLOW_DETAILS, UNITED_FLOW_PAYLOADS, UNITED_FLOW_SOURCE } from '../../config/unitedPersonalAgentFlow';

describe('United personal-agent MCP door sequence', () => {
  const model = parseSequence(UNITED_FLOW_SOURCE);
  const messages = model.items.filter((i) => i.from && i.to);

  it('has the nine participants, opens with the catalog pattern, then walks the design doc hops in order', () => {
    expect(model.participants.map((p) => p.id)).toEqual(['M', 'K', 'A', 'G', 'P', 'Z', 'U', 'L', 'S']);
    expect(messages).toHaveLength(22);
    expect(messages.slice(0, 4).map((m) => `${m.from}>${m.to}`)).toEqual(['G>K', 'K>G', 'M>K', 'K>A']);
    expect(messages[0].text.replace(/\s+/g, " ")).toMatch(/publishes its MCP door to the catalog/);
    expect(messages[2].text.replace(/\s+/g, " ")).toMatch(/free, nothing to install/);
    const text = messages.map((m) => m.text).join('\n');
    const order = ['resource_metadata', 'CIMD', 'Passkey or MFA', 'RFC 8693 exchange', 'bearer token', 'verdict', 'Pending approval', 'approval receipt', 'Writes sub'];
    const at = order.map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('has one payload slot per message, including the per-call token with act.client_id', () => {
    expect(UNITED_FLOW_PAYLOADS).toHaveLength(messages.length);
    const all = UNITED_FLOW_PAYLOADS.filter(Boolean).join('\n');
    expect(all).toMatch(/"act": \{/);
    expect(all).toMatch(/client_id/);
    expect(all).toMatch(/approval receipt/);
  });

  it('has reel details for every participant', () => {
    for (const p of model.participants) expect(UNITED_FLOW_DETAILS[p.id]).toBeTruthy();
  });

  it('renders on its own page with a link back to Diagrams', () => {
    render(<MemoryRouter><UnitedPersonalAgentFlowPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: "A member's agent meets United's MCP door" })).toBeTruthy();
    expect(screen.getByRole('link', { name: /All diagrams/ }).getAttribute('href')).toBe('/diagrams');
  });
});
