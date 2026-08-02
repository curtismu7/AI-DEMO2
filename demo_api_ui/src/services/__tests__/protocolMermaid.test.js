import { describe, it, expect } from 'vitest';
import { buildSequenceSource } from '../protocolMermaid';

const flow = {
  steps: [
    {
      id: 'step-1',
      fromActor: 'client-app',
      toActor: 'auth-server',
      label: 'POST /api/auth/ciba/initiate',
    },
    {
      id: 'step-2',
      fromActor: 'human-approver',
      toActor: 'auth-server',
      label: 'Approve out of band',
    },
  ],
};

describe('buildSequenceSource', () => {
  it('returns an empty string when the flow has no steps', () => {
    expect(buildSequenceSource({ steps: [] })).toBe('');
    expect(buildSequenceSource(null)).toBe('');
  });

  it('declares one participant per actor, in flow order', () => {
    const source = buildSequenceSource(flow);
    const participants = source
      .split('\n')
      .filter((line) => line.includes('participant'))
      .map((line) => line.trim());

    expect(participants).toEqual([
      'participant CA0 as Client App',
      'participant AS1 as PingOne',
      'participant HA2 as Person',
    ]);
  });

  it('draws every step as a message between its two actors', () => {
    const source = buildSequenceSource(flow);
    expect(source).toContain('CA0->>AS1: POST /api/auth/ciba/initiate');
    expect(source).toContain('HA2->>AS1: Approve out of band');
  });

  it('appends the response code once a step has run', () => {
    const source = buildSequenceSource(flow, [
      { response: { status: 200 } },
      { response: { status: 201 } },
    ]);
    expect(source).toContain('CA0->>AS1: POST /api/auth/ciba/initiate ✓ 200');
    expect(source).toContain('HA2->>AS1: Approve out of band ✓ 201');
  });

  it('draws a failed step as a crossed arrow', () => {
    const source = buildSequenceSource(flow, [{ response: { status: 401 } }]);
    expect(source).toContain('CA0-xAS1: POST /api/auth/ciba/initiate ✕ 401');
  });

  it('treats a recorded error as a failure even without a status', () => {
    const source = buildSequenceSource(flow, [{ error: 'Network error' }]);
    expect(source).toContain('CA0-xAS1: POST /api/auth/ciba/initiate ✕ failed');
  });

  it('marks the step currently running, but only while it has no result', () => {
    const running = buildSequenceSource(flow, [], 'step-1');
    expect(running).toContain('Note over CA0,AS1: running…');

    const finished = buildSequenceSource(flow, [{ response: { status: 200 } }], 'step-1');
    expect(finished).not.toContain('running…');
  });

  it('strips only the characters Mermaid would read as syntax', () => {
    const source = buildSequenceSource({
      steps: [
        {
          id: 'step-1',
          fromActor: 'client-app',
          toActor: 'gateway',
          label: 'GET /x; <tag> #hash',
        },
      ],
    });
    const message = source.split('\n').find((line) => line.includes('->>'));
    expect(message).not.toContain('<');
    expect(message).not.toContain('#h');
    expect(message).not.toContain(';');
  });

  it('keeps colons inside an endpoint — Mermaid splits on the first one only', () => {
    const source = buildSequenceSource({
      steps: [
        {
          id: 'step-1',
          fromActor: 'client-app',
          toActor: 'auth-server',
          label: 'GET /api/auth/ciba/poll/:authReqId',
        },
      ],
    });
    expect(source).toContain('CA0->>AS1: GET /api/auth/ciba/poll/:authReqId');
  });

  it('falls back to action or endpoint when a step has no label', () => {
    const source = buildSequenceSource({
      steps: [{ id: 's', fromActor: 'client-app', toActor: 'gateway', endpoint: '/api/thing' }],
    });
    expect(source).toContain('/api/thing');
  });
});
