import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import GatewayWiringDiagram, { GATEWAY_HOPS } from '../GatewayWiringDiagram';

describe('GatewayWiringDiagram', () => {
  test('puts all four hops through a numbered gateway box', () => {
    const { container } = render(<GatewayWiringDiagram />);
    const gateways = [...container.querySelectorAll('.a2a-wire__node--gateway')];
    expect(gateways.map((node) => node.querySelector('.a2a-wire__badge').textContent)).toEqual(['1', '4', '2', '3']);
    expect(gateways.map((node) => node.querySelector('.a2a-wire__path').textContent)).toEqual([
      '/analyst-agent/a2a', '/acme-tools/mcp', '/llm/google', '/llm/google',
    ]);
  });

  test('names the two agents, the MCP server and the model', () => {
    render(<GatewayWiringDiagram />);
    expect(screen.getByText('Main agent')).toBeInTheDocument();
    expect(screen.getByText('Worker agent')).toBeInTheDocument();
    expect(screen.getByText('no tools of its own')).toBeInTheDocument();
    expect(screen.getByText('MCP server')).toBeInTheDocument();
    expect(screen.getAllByText('Gemini')).toHaveLength(2);
    expect(screen.getByText('The agents hold no provider keys')).toBeInTheDocument();
  });

  test('says what the gateway does on each hop, as a list', () => {
    render(<GatewayWiringDiagram />);
    const list = screen.getByRole('list', { name: 'What the gateway does on each hop' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(GATEWAY_HOPS.length);
    expect(items[0]).toHaveTextContent('Hop 1 · Agent to agent');
    expect(items[0]).toHaveTextContent('Delegation is authorized');
    expect(items[3]).toHaveTextContent('Tool access is scoped');
  });

  test('hides the arrows from assistive tech', () => {
    const { container } = render(<GatewayWiringDiagram />);
    const links = container.querySelectorAll('.a2a-wire__link');
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => expect(link).toHaveAttribute('aria-hidden', 'true'));
  });
});
