import { describe, it, expect } from 'vitest';
import { ACTORS, CALLS } from '../utils/idJagCallSequence';
import { CALL_DETAIL } from './pfIdJagStandards';
import { SEQ_ACTOR_GROUP, lifeX, rowY, seqEdges, seqNodes } from './pfIdJagSequence';
import { PF_ID_JAG_GROUPS } from './pfIdJagDiagrams';

describe('ID-JAG sequence figure layout', () => {
  const nodes = seqNodes();
  const edges = seqEdges();
  const ids = new Set(nodes.map((n) => n.id));

  it('has an actor box and a lifeline per actor, with a known colour group', () => {
    expect(nodes.filter((n) => n.type === 'actor')).toHaveLength(ACTORS.length);
    expect(nodes.filter((n) => n.type === 'life')).toHaveLength(ACTORS.length);
    ACTORS.forEach((a) => expect(PF_ID_JAG_GROUPS[SEQ_ACTOR_GROUP[a.id]]).toBeTruthy());
  });

  it('has one arrow per call, between lifelines that exist, numbered like the calls', () => {
    expect(edges).toHaveLength(CALLS.length);
    edges.forEach((e, i) => {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
      expect(e.data.n).toBe(CALLS[i].n);
    });
  });

  it('gives every call its own handle row on the lifelines, in order and never overlapping', () => {
    const rows = CALLS.map((_c, i) => rowY(i));
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
    expect(new Set(rows).size).toBe(rows.length);
    const life = nodes.find((n) => n.type === 'life');
    expect(life.data.rows).toHaveLength(CALLS.length);
  });

  it('points arrows the way the call goes', () => {
    edges.forEach((e, i) => {
      const c = CALLS[i];
      if (c.from === c.to) expect(e.data.self).toBe(true);
      else expect(e.data.dir).toBe(Math.sign(lifeX(c.to) - lifeX(c.from)));
    });
  });

  it('keeps the detail of every call (form, tokens or reason, standards) for the panel beside it', () => {
    expect(CALL_DETAIL).toHaveLength(CALLS.length);
    CALL_DETAIL.forEach((d) => expect(d.refs.length).toBeGreaterThan(0));
  });
});
