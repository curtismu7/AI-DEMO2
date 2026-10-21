import { describe, it, expect } from 'vitest';
import { buildSequenceFlow } from '../SequenceFlowDiagram';

const SRC = `sequenceDiagram
    autonumber
    participant A as Alpha
    participant B as Beta
    A->>B: first
    B-->>A: second
    A->>B: third`;

describe('buildSequenceFlow payloads', () => {
  it('puts a payload box under its message and pushes later rows down', () => {
    const plain = buildSequenceFlow(SRC);
    const withPayload = buildSequenceFlow(SRC, [null, 'a: 1\nb: 2\nc: 3', null]);
    const box = withPayload.nodes.filter((n) => n.type === 'payload');
    expect(box).toHaveLength(1);
    expect(box[0].id).toBe('pl1');
    expect(box[0].data.text).toContain('b: 2');
    expect(box[0].position.y).toBeGreaterThan(withPayload.rows[1]);
    expect(withPayload.rows[2]).toBeGreaterThan(plain.rows[2]);
    expect(withPayload.rows[0]).toBe(plain.rows[0]);
  });

  it('reports the y of every message so a step can be scrolled into view', () => {
    const { rows } = buildSequenceFlow(SRC);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBeLessThan(rows[1]);
    expect(rows[1]).toBeLessThan(rows[2]);
  });
});
