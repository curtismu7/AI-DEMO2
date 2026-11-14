import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PoppyPage from '../PoppyPage';
import { parseSequence } from '../../utils/parseSequence';
import { POPPY_DOCS, POPPY_PAYLOADS, POPPY_SCOPES, POPPY_SOURCE, POPPY_WHY } from '../../config/poppyPage';

describe('Poppy page', () => {
  it('has one payload for every message in the diagram', () => {
    const messages = parseSequence(POPPY_SOURCE).items.filter((i) => i.type === 'message');
    expect(messages.length).toBe(POPPY_PAYLOADS.length);
  });

  it('renders the status, documents and every scope', () => {
    render(<MemoryRouter><PoppyPage /></MemoryRouter>);
    expect(screen.getByTestId('poppy-page')).toBeTruthy();
    expect(screen.getByText(/Spec 1\.0/)).toBeTruthy();
    expect(screen.getAllByText('Proven').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Deferred').length).toBeGreaterThan(0);
    expect(screen.getAllByText('By design').length).toBeGreaterThan(0);
    expect(screen.getByTestId('poppy-copy-curl')).toBeTruthy();
    expect(POPPY_DOCS[0].curl).toMatch(/curl -s/);
    expect(screen.getByText('/.well-known/poppy.json')).toBeTruthy();
    for (const s of POPPY_SCOPES) expect(screen.getByText(s.scope)).toBeTruthy();
  });

  it('renders the Why Poppy value section with every audience', () => {
    render(<MemoryRouter><PoppyPage /></MemoryRouter>);
    const why = screen.getByTestId('poppy-why');
    expect(why).toBeTruthy();
    for (const w of POPPY_WHY) {
      expect(screen.getByText(w.title)).toBeTruthy();
      expect(screen.getByText(w.text)).toBeTruthy();
    }
  });
});
