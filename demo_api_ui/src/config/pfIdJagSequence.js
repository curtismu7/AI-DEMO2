// Layout of the 19-call ID-JAG sequence figure (components/IdJagCallSequence.jsx), a ReactFlow figure in the Ping style:
// one box per actor along the top, a lifeline under each, one numbered horizontal arrow per call.
// The calls, forms, MOCK tokens and standards stay where they were (utils/idJagCallSequence.js, pfIdJagStandards.js);
// this file only turns them into nodes and edges, so the figure can never disagree with the reel or the detail panel.
import { ACTORS, CALLS } from '../utils/idJagCallSequence';

export const SEQ_COL = 150; // distance between two lifelines
export const SEQ_ROW = 56; // height of one call
export const SEQ_BOX_W = 128;
export const SEQ_BOX_H = 46;
export const SEQ_TOP = SEQ_BOX_H + 30; // first row starts below the actor boxes
export const SEQ_PAD = SEQ_BOX_W / 2 + 4;
export const SEQ_LOOP_W = 36; // a call to itself leaves the lifeline and comes back this far out
export const SEQ_LOOP_H = 16; // a self-call's two handles sit at row -/+ half of this;

// Same palette keys as the flow figures on the page (PF_ID_JAG_GROUPS): red = Ping product, dark = apps and people, grey = the MCP side.
export const SEQ_ACTOR_GROUP = {
  browser: 'user', bff: 'bff', agent: 'bff', pf: 'ping',
  oauthmcp: 'res', gateway: 'ping', mcp: 'res', bank: 'res',
};

export const seqWidth = () => SEQ_PAD * 2 + (ACTORS.length - 1) * SEQ_COL + 150; // room on the right for a label past the last lifeline
export const seqHeight = (n = CALLS.length) => SEQ_TOP + n * SEQ_ROW + 20;
export const lifeX = (id) => SEQ_PAD + ACTORS.findIndex((a) => a.id === id) * SEQ_COL;
export const rowY = (i) => SEQ_TOP + i * SEQ_ROW + SEQ_ROW / 2 + 6;

export const seqNodes = (calls = CALLS) => [
  ...ACTORS.map((a) => ({
    id: a.id, type: 'actor', position: { x: lifeX(a.id) - SEQ_BOX_W / 2, y: 0 }, width: SEQ_BOX_W, height: SEQ_BOX_H,
    data: { label: a.label, group: SEQ_ACTOR_GROUP[a.id] }, draggable: false, selectable: false,
  })),
  ...ACTORS.map((a) => ({
    id: `life-${a.id}`, type: 'life', position: { x: lifeX(a.id) - 1, y: SEQ_BOX_H }, width: 2, height: seqHeight(calls.length) - SEQ_BOX_H,
    data: { rows: calls.map((_, i) => rowY(i) - SEQ_BOX_H) }, draggable: false, selectable: false, focusable: false,
  })),
];

export const seqEdges = (calls = CALLS) => calls.map((c, i) => {
  const self = c.from === c.to;
  return {
    id: `call-${c.n}`, type: 'seq', source: `life-${c.from}`, target: `life-${c.to}`,
    sourceHandle: self ? `v${i}` : `s${i}`, targetHandle: self ? `u${i}` : `t${i}`,
    data: { i, n: c.n, label: c.label, self, untraced: c.traced === false, dir: lifeX(c.to) >= lifeX(c.from) ? 1 : -1 },
  };
});
