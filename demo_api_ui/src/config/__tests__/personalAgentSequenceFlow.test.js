import { describe, it, expect } from 'vitest';
import { buildSequenceFlow } from '../../components/SequenceFlowDiagram';
import { PERSONAL_AGENT_SEQUENCE_PAYLOADS, PERSONAL_AGENT_SEQUENCE_SOURCE } from '../personalAgentSequenceFlow';

describe('personal agent 12-step sequence', () => {
  const built = buildSequenceFlow(PERSONAL_AGENT_SEQUENCE_SOURCE, PERSONAL_AGENT_SEQUENCE_PAYLOADS);
  it('has seven participants and one payload slot per message', () => {
    expect(built.people.map((p) => p.id)).toEqual(['U', 'C', 'G', 'I', 'Z', 'B', 'O']);
    expect(built.messages.length).toBe(PERSONAL_AGENT_SEQUENCE_PAYLOADS.length);
  });
  it('uses only .example hosts', () => {
    const text = PERSONAL_AGENT_SEQUENCE_PAYLOADS.filter(Boolean).join('\n');
    (text.match(/https?:\/\/[a-z0-9.-]+/g) || []).forEach((u) => expect(u).toMatch(/\.example$/));
  });
});
