// demo_api_ui/src/pages/__tests__/a2aTeachingPanes.test.js
'use strict';

/**
 * Two jobs:
 *  1. Pin the honesty contract — every pane declares what its data actually is.
 *     A pane that silently loses its provenance would let the page imply it is
 *     showing a captured HTTP transcript when it is showing a reconstructed
 *     parameter summary or decoded claims.
 *  2. Anti-rot for the replay fixture. It is a REAL captured run; if the server
 *     renames an a2a-* event id or reshapes an `extra`, these go red instead of
 *     the page quietly degrading to blank panes — the exact failure mode that
 *     cost a day chasing stale artifacts elsewhere in this repo.
 */

import { buildA2aChainDetail } from '../../utils/a2aChainDetail';
import { A2A_RECORDED_RUN } from '../../data/a2aRecordedRun';
import {
  buildA2aTeachingPanes,
  summarizeAgentCard,
  summarizeActChain,
  PROVENANCE,
  LAYER,
} from '../a2aTeachingPanes';

const detail = buildA2aChainDetail(A2A_RECORDED_RUN.tokenEvents);

describe('replay fixture is still a complete A2A run', () => {
  it('carries every event id both layers need', () => {
    const ids = A2A_RECORDED_RUN.tokenEvents.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([
      'user-token',
      'a2a-agent1-actor',
      'a2a-exchange1',
      'a2a-agent2-actor',
      'a2a-exchange2',
      'a2a-protocol-bearer',
      'a2a-agent-card',
      'a2a-protocol-message',
    ]));
  });

  it('builds a complete chain detail', () => {
    expect(detail.present).toBe(true);
    expect(detail.hops).toHaveLength(4);
    expect(detail.agentCard).not.toBeNull();
    expect(detail.protocol).not.toBeNull();
    expect(detail.protocol.bearer).not.toBeNull();
    expect(detail.protocol.mode).toBeTruthy();
  });

  it('never contains a raw JWT — tokens must not reach the browser', () => {
    const blob = JSON.stringify(A2A_RECORDED_RUN.tokenEvents);
    expect(blob).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./);
  });
});

describe('the honesty contract', () => {
  const panes = buildA2aTeachingPanes(detail);

  it('gives EVERY pane a provenance and a caption', () => {
    expect(panes.length).toBeGreaterThan(0);
    for (const p of panes) {
      expect(p.provenance, `pane ${p.key} has no provenance`).toBeTruthy();
      expect(p.caption, `pane ${p.key} has no caption`).toBeTruthy();
    }
  });

  it('never labels a reconstructed exchange request as live HTTP', () => {
    const req = panes.find((p) => p.key === 'a2a-exchange2:req');
    expect(req.provenance).toBe(PROVENANCE.RECONSTRUCTED);
    expect(req.provenance).not.toBe(PROVENANCE.LIVE);
    // the omission is the point — token values are deliberately absent
    expect(req.body.has_actor_token).toBe(true);
    expect(req.body.subject_token).toBeUndefined();
  });

  it('labels exchange responses as decoded claims, not bodies', () => {
    expect(panes.find((p) => p.key === 'a2a-exchange2:res').provenance)
      .toBe(PROVENANCE.DECODED);
  });

  it('marks the in-process wire hop as not having crossed the wire', () => {
    const req = panes.find((p) => p.key === 'wire:req');
    expect(req.mode).toBe('in-process');
    expect(req.provenance).toBe(PROVENANCE.IN_PROCESS);
    expect(req.caption).toMatch(/no HTTP request crossed the wire/i);
  });

  it('splits the two layers', () => {
    expect(panes.some((p) => p.layer === LAYER.IDENTITY)).toBe(true);
    expect(panes.some((p) => p.layer === LAYER.WIRE)).toBe(true);
  });

  it('says the wire bearer is a separate token from the nested-act one', () => {
    const bearer = panes.find((p) => p.key === 'wire:bearer');
    expect(bearer).toBeTruthy();
    expect(bearer.note).toMatch(/SEPARATE token/);
  });

  it('returns nothing rather than throwing when there is no A2A run', () => {
    expect(buildA2aTeachingPanes(buildA2aChainDetail([]))).toEqual([]);
    expect(buildA2aTeachingPanes(null)).toEqual([]);
  });
});

describe('summaries', () => {
  it('summarizeActChain reports the depth-2 nesting Authorize sees', () => {
    const act = summarizeActChain(detail);
    expect(act.depth).toBe(2);
    expect(act.specialist).toBeTruthy();
    expect(act.generalist).toBeTruthy();
    expect(act.specialist).not.toBe(act.generalist);
    // scope narrows at the specialist hop — that is the least-privilege claim
    expect(act.scope).toBeTruthy();
  });

  it('summarizeAgentCard pulls the security scheme and binding', () => {
    const s = summarizeAgentCard(A2A_RECORDED_RUN.agentCard);
    expect(s.name).toBeTruthy();
    expect(s.securitySchemes).toContain('pingoneBearer');
    expect(s.skills.length).toBeGreaterThan(0);
  });

  it('summarizers degrade quietly on junk', () => {
    expect(summarizeAgentCard(null)).toBeNull();
    expect(summarizeActChain(null)).toBeNull();
  });
});
