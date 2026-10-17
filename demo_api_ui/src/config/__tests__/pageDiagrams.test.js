import { describe, expect, it } from 'vitest';
import * as jev from '../jevGalleryDiagram';
import * as obs from '../mcpObservabilityDiagram';
import * as hosted from '../hostedAccessDiagram';

const cfgs = {
  jev: [jev.JEV_GALLERY_GROUPS, jev.JEV_GALLERY_NODES, jev.JEV_GALLERY_EDGES, jev.JEV_GALLERY_STEPS],
  obs: [obs.MCP_OBS_GROUPS, obs.MCP_OBS_NODES, obs.MCP_OBS_EDGES, obs.MCP_OBS_STEPS],
  hosted: [hosted.HOSTED_ACCESS_GROUPS, hosted.HOSTED_ACCESS_NODES, hosted.HOSTED_ACCESS_EDGES, hosted.HOSTED_ACCESS_STEPS],
};

describe.each(Object.entries(cfgs))('%s diagram config', (_n, [groups, nodes, edges, steps]) => {
  it('edges reference nodes, nodes reference groups, steps cover every edge', () => {
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.size).toBe(nodes.length);
    nodes.forEach((n) => expect(groups[n.group]).toBeTruthy());
    edges.forEach(([s, t]) => { expect(ids.has(s)).toBe(true); expect(ids.has(t)).toBe(true); });
    const covered = new Set(steps.flatMap((s) => s.edges));
    edges.forEach((_e, i) => expect(covered.has(i)).toBe(true));
    steps.forEach((s) => s.edges.forEach((i) => expect(edges[i]).toBeTruthy()));
  });
});
