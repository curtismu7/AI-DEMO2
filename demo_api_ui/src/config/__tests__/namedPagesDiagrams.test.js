import { describe, it, expect } from 'vitest';
import { analyzeRouting } from '../../test-utils/diagramRouting';
import * as dot from '../dotWorkbenchDiagram';
import * as studio from '../personalAgentStudioDiagram';
import * as cimd from '../../components/cimdPrivilege/cimdPrivilegeData';
import * as review from '../../components/personalAgent/personalAgentData';
import { P266_EDGES, P266_GROUPS, P266_NODES } from '../phase266Diagram';
import { DAVINCI_LIFECYCLE_EDGES, DAVINCI_LIFECYCLE_GROUPS, DAVINCI_LIFECYCLE_NODES } from '../davinciSdkLifecycleDiagram';

// The Ping palette shared by the pingStyle diagrams: red = Ping products, dark = what the team builds, grey = outside.
const PING = new Set(['#151a24', '#5a5f69', '#b5231a']);

// maxCrossings is the number of arrow crossings the router leaves in the shipped layout (a ratchet: lower it, never raise it).
const CASES = [
  ['Dot workbench', dot.DOT_WORKBENCH_GROUPS, dot.DOT_WORKBENCH_NODES, dot.DOT_WORKBENCH_EDGES, 0],
  ['Personal Agent Studio', studio.PERSONAL_AGENT_GROUPS, studio.PERSONAL_AGENT_NODES, studio.PERSONAL_AGENT_EDGES, 0],
  ['CIMD flow', cimd.FLOW_GROUPS, cimd.FLOW_NODES, cimd.FLOW_EDGES, 0],
  ['CIMD capabilities', cimd.CAP_GROUPS, cimd.CAP_NODES, cimd.CAP_EDGES, 0],
  ['Personal Agent review', review.REVIEW_GROUPS, review.ORIGINAL_NODES, review.ORIGINAL_EDGES, 0],
  ['Phase 266', P266_GROUPS, P266_NODES, P266_EDGES, 3],
  ['DaVinci SDK lifecycle', DAVINCI_LIFECYCLE_GROUPS, DAVINCI_LIFECYCLE_NODES, DAVINCI_LIFECYCLE_EDGES, 0],
];

describe.each(CASES)('%s pingStyle diagram', (_name, GROUPS, NODES, EDGES, maxCrossings) => {
  it('edges join known boxes and boxes use known groups', () => {
    const ids = new Set(NODES.map((n) => n.id));
    expect(ids.size).toBe(NODES.length);
    EDGES.forEach(([a, b]) => { expect(ids.has(a)).toBe(true); expect(ids.has(b)).toBe(true); });
    NODES.forEach((n) => expect(GROUPS[n.group], n.id).toBeTruthy());
  });

  it('uses the Ping palette', () => {
    Object.values(GROUPS).forEach((g) => expect(PING.has(g.bg), g.label).toBe(true));
  });

  it('no coloured arrows (the stroke comes from the stylesheet: solid = request, dashed = token or decision)', () => {
    EDGES.forEach(([, , , opts]) => expect(opts?.color).toBeUndefined());
  });

  it('routes every arrow around the boxes with no more crossings than recorded', () => {
    const r = analyzeRouting(NODES, EDGES);
    expect(r.fallbacks).toBe(0);
    expect(r.throughBox).toBe(0);
    expect(r.crossings).toBeLessThanOrEqual(maxCrossings);
  });
});

describe('Phase 266 path filter', () => {
  it('every path arrow or box carries path A, B or C so the filter can dim the rest', () => {
    const paths = new Set([...P266_NODES.map((n) => n.path), ...P266_EDGES.map((e) => e[3]?.path)].filter(Boolean));
    expect([...paths].sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('DaVinci SDK lifecycle', () => {
  it('draws the messages of the Mermaid lifecycle in order, loop and tokens included', () => {
    const labels = DAVINCI_LIFECYCLE_EDGES.map((e) => e[2]).join('\n');
    expect(DAVINCI_LIFECYCLE_EDGES[0].slice(0, 2)).toEqual(['page', 'bff']);
    expect(labels).toContain('POST /start');
    expect(labels).toContain('GET /as/authorize (response_mode=pi.flow)');
    expect(labels).toContain('authorization.code');
    expect(labels).toContain('POST /as/token');
    expect(DAVINCI_LIFECYCLE_EDGES.at(-1).slice(0, 2)).toEqual(['bff', 'page']);
    // the SDK-to-PingOne hops carry the dashed token/decision style only when a node or code comes back
    const dashed = DAVINCI_LIFECYCLE_EDGES.filter((e) => e[3]?.dashed).map((e) => e[2]);
    expect(dashed).toContain('node + collectors');
    expect(dashed).not.toContain('POST flow continue');
  });
});
