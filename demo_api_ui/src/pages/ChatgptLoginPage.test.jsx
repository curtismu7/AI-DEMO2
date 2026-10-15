import { render, screen } from '@testing-library/react';
import ChatgptLoginPage from './ChatgptLoginPage';
import { NODES, EDGES, walk } from './chatgptLoginDiagram';

describe('ChatgptLoginPage', () => {
  it('walks the 12 steps of the flow, each along known nodes and edges', () => {
    expect(walk).toHaveLength(12);
    const ids = new Set(NODES.map((n) => n.id));
    for (const w of walk) {
      expect(w.nodes.every((n) => ids.has(n))).toBe(true);
      expect(w.edges.every((e) => e >= 0 && e < EDGES.length)).toBe(true);
    }
  });

  it('renders the shared diagram page with the three policy cards', () => {
    render(<ChatgptLoginPage />);
    expect(screen.getByText('How ChatGPT Requests User Login')).toBeTruthy();
    expect(screen.getByText('Three separate decisions')).toBeTruthy();
  });
});
