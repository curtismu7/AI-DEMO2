import { describe, expect, it } from 'vitest';
import { dotSuggestions, airlineSuggestions, studioSuggestions, studioGreeting } from '../dotSuggestions';

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

  it('airline prompts only offer actions the airline can really do: no transfer-miles prompt, and the MFA demo is the consent-gated fee', () => {
    const msgs = airlineSuggestions('privilege').map((c) => c.message);
    expect(msgs).toEqual(['What is my loyalty status?', 'Show my airline bookings', 'pay a $300 change fee', 'access my sensitive airline bookings']);
    expect(msgs.join(' ')).not.toMatch(/transfer/i);
    expect(airlineSuggestions('dot').map((c) => c.message)).toContain('What do you remember about me?');
  });
});

describe('studioSuggestions / studioGreeting (the Studio follows the active vertical)', () => {
  it('airlines, or no vertical resolved yet, keep the tuned airline prompts', () => {
    expect(studioSuggestions('claude', 'airlines', null)).toEqual(airlineSuggestions('claude'));
    expect(studioSuggestions('claude', null, null)).toEqual(airlineSuggestions('claude'));
    expect(studioSuggestions('dot', undefined, null)).toEqual(airlineSuggestions('dot'));
  });

  it("any other vertical offers its own first three prompts (no recall question outside Dot)", () => {
    const out = studioSuggestions('claude', 'retail', manifest([chip('a'), chip('b', { mode: 'direct' }), chip('c'), chip('d'), chip('e')]));
    expect(out).toEqual([
      { label: 'Label a', message: 'Prompt a' },
      { label: 'Label c', message: 'Prompt c' },
      { label: 'Label d', message: 'Prompt d' },
    ]);
  });

  it('skips feature-demo chips (show_* tools): chat cannot run them', () => {
    const out = studioSuggestions('claude', 'investment', manifest([chip('a', { tool: 'show_investment' }), chip('b'), chip('c')]));
    expect(out).toEqual([
      { label: 'Label b', message: 'Prompt b' },
      { label: 'Label c', message: 'Prompt c' },
    ]);
  });

  it('Dot adds the recall question to another vertical\'s prompts', () => {
    const out = studioSuggestions('dot', 'retail', manifest([chip('a')]));
    expect(out).toEqual([{ label: 'Label a', message: 'Prompt a' }, RECALL]);
  });

  it("a guest's stripped manifest (or one still loading) gets vertical-neutral prompts, never airline ones", () => {
    const out = studioSuggestions('claude', 'retail', null);
    expect(out).toEqual([
      { label: 'Always keep your answers short', message: 'Always keep your answers short' },
      { label: 'Call me Sam', message: 'Call me Sam' },
    ]);
    expect(out.some((s) => /airline|loyalty|MileagePlus/i.test(s.message))).toBe(false);
  });

  it('the opening line names MileagePlus only for the airline vertical', () => {
    expect(studioGreeting('airlines')).toMatch(/MileagePlus/);
    expect(studioGreeting(null)).toMatch(/MileagePlus/);
    expect(studioGreeting('retail')).not.toMatch(/MileagePlus|flights/i);
    expect(studioGreeting('retail')).toMatch(/digital assistant/);
  });
});
