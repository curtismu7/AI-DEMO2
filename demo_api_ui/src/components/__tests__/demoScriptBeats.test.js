import { DEMO_SCRIPT, findBeat } from '../demoScript';

describe('findBeat', () => {
  it('finds a beat by use-case id', () => {
    const beat = findBeat('UC1');
    expect(beat).toBeTruthy();
    expect(beat.ucId).toBe('UC1');
    expect(typeof beat.say).toBe('string');
    expect(beat.say.length).toBeGreaterThan(0);
  });

  it('returns null for a use case outside the script', () => {
    expect(findBeat('UC999')).toBeNull();
    expect(findBeat(null)).toBeNull();
  });

  it('covers every beat declared in DEMO_SCRIPT', () => {
    const all = DEMO_SCRIPT.acts.flatMap((a) => a.beats).filter((b) => b.ucId);
    all.forEach((b) => { expect(findBeat(b.ucId)).toEqual(b); });
  });
});
