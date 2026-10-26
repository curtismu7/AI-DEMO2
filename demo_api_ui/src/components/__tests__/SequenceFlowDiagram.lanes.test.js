import { describe, it, expect } from 'vitest';
import { buildSequenceFlow } from '../SequenceFlowDiagram';
import { UNITED_FLOW_SOURCE, UNITED_FLOW_ISSUES, UNITED_FLOW_LANES } from '../../config/unitedPersonalAgentFlow';

const SRC = `sequenceDiagram
    autonumber
    participant A as Alpha
    participant B as Beta
    A->>B: first
    B-->>A: second`;

describe('buildSequenceFlow lanes and issues', () => {
  it('leaves the default look alone without lanes', () => {
    const { nodes, edges } = buildSequenceFlow(SRC);
    expect(nodes.find((n) => n.id === 'p-A').data.lane).toBeUndefined();
    expect(edges[0].style?.stroke).toBeUndefined();
  });

  it('colours participants and arrows by lane', () => {
    const { nodes, edges } = buildSequenceFlow(SRC, [], { lanes: { A: 'agent', B: 'pingone' } });
    expect(nodes.find((n) => n.id === 'p-B').data.lane).toBe('pingone');
    expect(edges[0].style.stroke).toBe('var(--sfx-color-agent)');
    expect(edges[1].style.stroke).toBe('var(--sfx-color-pingone)');
  });

  it('adds an issue box under its message and pushes later rows down', () => {
    const issues = [{ title: 'Hop', problem: 'p', answer: 'a' }, null];
    const plain = buildSequenceFlow(SRC);
    const withIssue = buildSequenceFlow(SRC, [], { issues });
    expect(withIssue.nodes.filter((n) => n.type === 'issue')).toHaveLength(1);
    expect(withIssue.rows[1]).toBeGreaterThan(plain.rows[1]);
    expect(withIssue.rows[0]).toBe(plain.rows[0]);
  });

  it('United issues all attach to a real message and every participant has a lane', () => {
    const { rows, nodes } = buildSequenceFlow(UNITED_FLOW_SOURCE, [], { lanes: UNITED_FLOW_LANES, issues: UNITED_FLOW_ISSUES });
    expect(UNITED_FLOW_ISSUES).toHaveLength(rows.length);
    expect(nodes.filter((n) => n.type === 'issue')).toHaveLength(UNITED_FLOW_ISSUES.filter(Boolean).length);
    nodes.filter((n) => n.type === 'part').forEach((n) => expect(n.data.lane).toBeTruthy());
  });
});
