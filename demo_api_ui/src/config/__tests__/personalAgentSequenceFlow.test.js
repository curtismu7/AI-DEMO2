import { describe, it, expect } from 'vitest';
import { buildSequenceFlow } from '../../components/SequenceFlowDiagram';
import { PERSONAL_AGENT_SEQUENCE_PAYLOADS, PERSONAL_AGENT_SEQUENCE_SOURCE, personalAgentMessageForReelStep } from '../personalAgentSequenceFlow';

describe('personal agent 12-step sequence', () => {
  const built = buildSequenceFlow(PERSONAL_AGENT_SEQUENCE_SOURCE, PERSONAL_AGENT_SEQUENCE_PAYLOADS);
  it('opens with the catalog pattern, has eight participants and one payload slot per message', () => {
    expect(built.people.map((p) => p.id)).toEqual(['U', 'K', 'C', 'G', 'I', 'Z', 'B', 'O']);
    expect(built.messages.slice(0, 4).map((m) => `${m[0]}>${m[1]}`)).toEqual(['G>K', 'K>G', 'U>K', 'K>C']);
    expect(built.messages.length).toBe(PERSONAL_AGENT_SEQUENCE_PAYLOADS.length);
  });
  it('uses only .example hosts', () => {
    const text = PERSONAL_AGENT_SEQUENCE_PAYLOADS.filter(Boolean).join('\n');
    (text.match(/https?:\/\/[a-z0-9.-]+/g) || []).forEach((u) => expect(u).toMatch(/\.example$/));
  });
  it('every movie-reel card maps to a message of the diagram', () => {
    ['prompt', 'signin', 'agent', 'llm', 'agent-token', 'exchange', 'authorize', 'authorize:2', 'gateway', 'mcp', 'reply'].forEach((id) => {
      const i = personalAgentMessageForReelStep(id);
      expect(i, id).toBeGreaterThanOrEqual(0);
      expect(i, id).toBeLessThan(built.messages.length);
    });
    expect(personalAgentMessageForReelStep('something-else')).toBe(-1);
  });
});
