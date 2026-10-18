import { describe, it, expect } from 'vitest';
import { WORKLOAD_META } from '../../components/DemoArchWorkloadScene';
import { ID4AI_SLIDES } from '../id4aiSlides';
import { CONTROL_PLANE_SLIDE, CONTROL_PLANE_STEPS, ID_JAG_SLIDE, OBO_SLIDE, OBO_STEPS, CODING_SLIDE, CODING_STEPS } from '../pingSlideDiagrams';

describe.each([['obo', OBO_SLIDE, OBO_STEPS], ['coding', CODING_SLIDE, CODING_STEPS], ['id-jag', ID_JAG_SLIDE, WORKLOAD_META.idjag.steps], ['control-plane', CONTROL_PLANE_SLIDE, CONTROL_PLANE_STEPS], ...ID4AI_SLIDES.map((d) => [d.id, d.config, d.steps])])('%s slide', (_n, slide, steps) => {
  it('has unique node ids and edges between real nodes', () => {
    const ids = slide.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    slide.edges.forEach((e) => { expect(ids).toContain(e.from); expect(ids).toContain(e.to); });
  });
  it('every step lights an edge or a node and every edge belongs to a step', () => {
    const used = new Set(slide.edges.map((e) => e.step));
    const nodeSteps = new Set(slide.nodes.flatMap((n) => n.steps || []));
    steps.forEach((_s, i) => expect(used.has(i + 1) || nodeSteps.has(i + 1)).toBe(true));
    used.forEach((u) => expect(u).toBeLessThanOrEqual(steps.length));
  });
});
