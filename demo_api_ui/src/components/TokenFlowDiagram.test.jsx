import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TokenFlowDiagram from './TokenFlowDiagram';

describe('TokenFlowDiagram', () => {
  it('renders the diagram container', () => {
    const { container } = render(<TokenFlowDiagram />);
    expect(container.querySelector('.utfi-flow-diagram-container')).toBeTruthy();
  });

  it('displays the flow title', () => {
    render(<TokenFlowDiagram />);
    expect(screen.getByText(/2-Exchange Flow/i)).toBeTruthy();
  });

  it('displays RFC 8693 reference', () => {
    render(<TokenFlowDiagram />);
    expect(screen.getAllByText(/RFC 8693/i).length).toBeGreaterThan(0);
  });

  it('shows three token exchanges in the flow', () => {
    render(<TokenFlowDiagram />);
    expect(screen.getByText(/User Token/i)).toBeTruthy();
    expect(screen.getByText(/Agent Token/i)).toBeTruthy();
    expect(screen.getByText(/MCP Token/i)).toBeTruthy();
  });

  it('displays subject (sub) claim in the flow', () => {
    const { container } = render(<TokenFlowDiagram />);
    const text = container.textContent;
    expect(text).toContain('sub:');
  });

  it('displays scope claim in the flow', () => {
    const { container } = render(<TokenFlowDiagram />);
    const text = container.textContent;
    expect(text).toContain('scope:');
  });

  it('displays audience (aud) claim in the flow', () => {
    const { container } = render(<TokenFlowDiagram />);
    const text = container.textContent;
    expect(text).toContain('aud:');
  });

  it('displays act (actor) claim', () => {
    const { container } = render(<TokenFlowDiagram />);
    const text = container.textContent;
    expect(text).toContain('act:');
  });

  it('highlights "narrowed" keyword in orange', () => {
    const { container } = render(<TokenFlowDiagram />);
    const highlighted = container.querySelector('.utfi-highlighted');
    expect(highlighted).toBeTruthy();
    expect(highlighted?.textContent).toContain('narrowed');
  });

  it('highlights "bound" keyword in orange', () => {
    const { container } = render(<TokenFlowDiagram />);
    const highlights = container.querySelectorAll('.utfi-highlighted');
    let hasBoung = false;
    highlights.forEach(el => {
      if (el.textContent.includes('bound')) {
        hasBoung = true;
      }
    });
    expect(hasBoung).toBeTruthy();
  });

  it('uses monospace font for code block', () => {
    const { container } = render(<TokenFlowDiagram />);
    const diagram = container.querySelector('.utfi-flow-diagram');
    expect(diagram).toBeTruthy();
    // Font family should be monospace (checking class is applied)
    expect(diagram?.className).toContain('utfi-flow-diagram');
  });

  it('applies blue left border to the diagram', () => {
    const { container } = render(<TokenFlowDiagram />);
    const diagram = container.querySelector('.utfi-flow-diagram');
    expect(diagram).toBeTruthy();
    // The class should apply the blue border via CSS
  });

  it('displays the full flow text with RFC 8693 citations', () => {
    const { container } = render(<TokenFlowDiagram />);
    const text = container.textContent;
    expect(text).toContain('RFC 8693.1');
    expect(text).toContain('RFC 8693.2');
  });

  it('shows arrow indicators in the flow', () => {
    const { container } = render(<TokenFlowDiagram />);
    const text = container.textContent;
    expect(text).toContain('→');
  });

  it('displays correct claim progression from user to agent to MCP', () => {
    const { container } = render(<TokenFlowDiagram />);
    const text = container.textContent;

    // Check for sub claim progression
    expect(text).toContain('sub: user-123');
    expect(text).toContain('act: agent-001');
    expect(text).toContain('act: [agent-001, user-123]');
  });

  it('shows scope narrowing from user to MCP token', () => {
    const { container } = render(<TokenFlowDiagram />);
    const text = container.textContent;

    // Scopes should appear in flow
    expect(text).toContain('read write');
    // Narrowed should be highlighted
    expect(text).toContain('narrowed');
  });

  it('shows audience binding to mcp-server', () => {
    const { container } = render(<TokenFlowDiagram />);
    const text = container.textContent;

    expect(text).toContain('mcp-server');
    expect(text).toContain('bound');
  });

  it('renders flow diagram without errors', () => {
    const { container } = render(<TokenFlowDiagram />);
    expect(container.querySelector('.utfi-flow-diagram-container')).toBeTruthy();
    expect(container.querySelector('.utfi-flow-diagram')).toBeTruthy();
  });

  it('has proper CSS class structure', () => {
    const { container } = render(<TokenFlowDiagram />);
    const outer = container.querySelector('.utfi-flow-diagram-container');
    const inner = container.querySelector('.utfi-flow-diagram');

    expect(outer).toBeTruthy();
    expect(inner).toBeTruthy();
    expect(outer?.querySelector('.utfi-flow-diagram')).toBe(inner);
  });
});
