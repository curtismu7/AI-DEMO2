import { A2A_RECORDED_RUN } from '../../data/a2aRecordedRun';
import { buildLearnDiagram, LEARN_EVENT_IDS } from '../a2aLearnDiagram';

const allEvents = [...LEARN_EVENT_IDS.map((id) => ({ id })), { id: 'some-new-event' }];

describe('a2aLearnDiagram', () => {
  for (const [name, events] of [['recorded run', A2A_RECORDED_RUN.tokenEvents], ['every known id plus an unknown one', allEvents]]) {
    describe(name, () => {
      const { NODES, EDGES, STEPS } = buildLearnDiagram(events, { generalist: 'Custom G' });
      const ids = new Set(NODES.map((n) => n.id));

      it('has one edge and one step per event, with valid node ids', () => {
        expect(EDGES).toHaveLength(events.length);
        expect(STEPS).toHaveLength(events.length);
        EDGES.forEach(([s, t]) => { expect(ids.has(s)).toBe(true); expect(ids.has(t)).toBe(true); });
        STEPS.forEach((s, i) => expect(s.edges).toEqual([i]));
      });
      it('gives every step a form, a tokens list and standards with kind, id and title', () => {
        STEPS.forEach((s) => {
          expect(typeof s.detail.form).toBe('string');
          expect(Array.isArray(s.detail.tokens)).toBe(true);
          s.detail.tokens.forEach((t) => expect(t.note).toMatch(/\S/));
          expect(s.detail.refs.length).toBeGreaterThan(0);
          s.detail.refs.forEach((r) => { expect(r.kind).toMatch(/^(rfc|spec|emerging)$/); expect(r.id).toBeTruthy(); expect(r.title).toBeTruthy(); });
        });
      });
      it('has no JWT literals in any form', () => {
        STEPS.forEach((s) => expect(s.detail.form).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}/));
      });
      it('applies label overrides', () => {
        if (ids.has('generalist')) expect(NODES.find((n) => n.id === 'generalist').label).toBe('Custom G');
      });
    });
  }
});
