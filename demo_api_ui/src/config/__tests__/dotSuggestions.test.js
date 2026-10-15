import { describe, expect, it } from 'vitest';
import { dotSuggestions } from '../dotSuggestions';

const chip = (id, extra = {}) => ({ id, label: `Label ${id}`, message: `Prompt ${id}`, ...extra });
const manifest = (chips10) => ({ dashboard: { chips10 } });
const RECALL = { label: 'What do you remember about me?', message: 'What do you remember about me?' };

describe('dotSuggestions', () => {
  it("takes the vertical's first three chips (label shown, prompt sent), then the generic recall question", () => {
    const out = dotSuggestions(manifest([chip('a'), chip('b'), chip('c'), chip('d')]));
    expect(out).toEqual([
      { label: 'Label a', message: 'Prompt a' },
      { label: 'Label b', message: 'Prompt b' },
      { label: 'Label c', message: 'Prompt c' },
      RECALL,
    ]);
  });

  it("keeps mode 'both' chips (every real chip in sporting-goods has a mode) and skips only mode 'direct'", () => {
    const out = dotSuggestions(manifest([chip('a', { mode: 'both', tool: 'list_gear' }), chip('b', { mode: 'direct', tool: 'test_wrong_scope' }), chip('c', { mode: 'both' })]));
    expect(out).toEqual([
      { label: 'Label a', message: 'Prompt a' },
      { label: 'Label c', message: 'Prompt c' },
      RECALL,
    ]);
  });

  it('skips direct/attack-sim chips and chips with no prompt', () => {
    const out = dotSuggestions(manifest([chip('x', { mode: 'direct', tool: 'attack' }), chip('y', { message: '' }), chip('z')]));
    expect(out).toEqual([{ label: 'Label z', message: 'Prompt z' }, RECALL]);
  });

  it("no vertical chips (signed-out guests get a stripped manifest; or still loading): vertical-neutral Dot prompts, never another vertical's", () => {
    const neutral = [
      { label: 'Always keep your answers short', message: 'Always keep your answers short' },
      { label: 'Call me Sam', message: 'Call me Sam' },
      RECALL,
    ];
    expect(dotSuggestions(null)).toEqual(neutral);
    expect(dotSuggestions(manifest([]))).toEqual(neutral);
    expect(dotSuggestions({ identity: {}, theme: {} })).toEqual(neutral);
  });
});
