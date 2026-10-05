import { describe, it, expect } from 'vitest';
import { buildPrivilegeA2aChainSteps } from '../privilegeA2aChainSteps';
import { chainHopToTokenEvent } from '../../../utils/privilegeA2aChainRun';
import { chainNodeNames } from '../../../components/SystemFlowMap';

const VERTICALS = [
  ['banking', 'Investment Advisor', 'Super Banking agent'],
  ['healthcare', 'Records Specialist', 'CareConnect agent'],
  ['retail', 'Purchase History Specialist', 'Great Buy agent'],
  ['sporting-goods', 'Membership Specialist', 'Super Sports agent'],
  ['workforce', 'Payroll Specialist', 'WX Workforce agent'],
  ['government', 'Tax Records Specialist', 'CivicPermit agent'],
  ['university', 'Financial Aid Specialist', 'Super University agent'],
  ['manufacturing', 'Supplier Contract Specialist', 'Precision Works agent'],
  ['investment', 'Holdings Specialist', 'Meridian Wealth agent'],
  ['airlines', 'Passenger Records Specialist', 'United Airlines agent'],
  ['admin', 'Identity Verification Specialist', 'PingOne Admin agent'],
];
const profileOf = ([vertical, specialistName, agentName]) => ({ vertical, agentName, specialistName, questions: ['q1', 'q2', 'q3'] });

// UC46: main -> analyst -> mcp and back. UC47: main -> langchain -> specialist.
const UC46 = [
  { kind: 'delegate', from: 'main', to: 'analyst' },
  { kind: 'mcp-call', from: 'analyst', to: 'mcp', detail: 'lookup' },
  { kind: 'mcp-result', from: 'mcp', to: 'analyst', detail: 'rows' },
  { kind: 'result', from: 'analyst', to: 'main', detail: 'done' },
];
const UC47 = (specialist) => [
  { kind: 'delegate', from: 'main', to: 'langchainagent', detail: 'ask' },
  { kind: 'delegate', from: 'langchainagent', to: specialist, detail: 'ask' },
  { kind: 'result', from: specialist, to: 'langchainagent', detail: 'ok' },
];
const events = (hops, profile) => hops.map((hop, i) => chainHopToTokenEvent(hop, i, undefined, profile));
const lanes = (steps) => steps.map((s) => s.lane);
const text = (steps) => JSON.stringify(steps.map((s) => [s.title, s.detail.narrative, s.detail.kv]));

describe('buildPrivilegeA2aChainSteps with a vertical profile', () => {
  it.each(VERTICALS)('%s: lane keys unchanged, labels and titles carry the vertical names', (...row) => {
    const profile = profileOf(row);
    const { specialistName, agentName } = profile;
    const plain = buildPrivilegeA2aChainSteps(events(UC46, null));
    const named = buildPrivilegeA2aChainSteps(events(UC46, profile));

    expect(lanes(named)).toEqual(lanes(plain));
    expect(new Set(lanes(named))).toEqual(new Set(['MAIN-AGENT', 'ANALYST-AGENT', 'MCP-TOOLS', 'GATEWAY']));
    const labelOf = (lane) => named.find((s) => s.lane === lane).laneLabel;
    expect(labelOf('MAIN-AGENT')).toBe(agentName);
    expect(labelOf('ANALYST-AGENT')).toBe(specialistName);
    expect(labelOf('MCP-TOOLS')).toBe(`${specialistName} data tools`);
    expect(labelOf('GATEWAY')).toBe('AI Gateway');
    expect(text(named)).toContain(specialistName);
    expect(text(named)).toContain(agentName);
    expect(text(named)).not.toContain('Analyst agent');

    const chain = buildPrivilegeA2aChainSteps(events(UC47('refunds'), profile));
    expect(new Set(lanes(chain))).toEqual(new Set(['MAIN-AGENT', 'GATEWAY', 'LANGCHAIN-AGENT', 'REFUNDS-SPECIALIST']));
    expect(chain.find((s) => s.lane === 'REFUNDS-SPECIALIST').laneLabel).toBe(specialistName);
    expect(chain.find((s) => s.lane === 'LANGCHAIN-AGENT').laneLabel).toBeUndefined();

    const denied = buildPrivilegeA2aChainSteps(events(UC47('restricted'), profile));
    expect(denied.find((s) => s.lane === 'RESTRICTED-SPECIALIST').laneLabel).toBe(`Ungranted ${specialistName}`);
  });

  it('prefers labels the agent sent over the profile', () => {
    const [event] = events([{ kind: 'delegate', from: 'main', to: 'analyst', fromLabel: 'Agent X', toLabel: 'Spec Y' }], profileOf(VERTICALS[0]));
    expect(event).toMatchObject({ from: 'main', to: 'analyst', fromLabel: 'Agent X', toLabel: 'Spec Y' });
  });

  it('with no labels and no profile keeps today names and no laneLabel on actor lanes', () => {
    const steps = buildPrivilegeA2aChainSteps(events(UC46, null));
    expect(text(steps)).toContain('Analyst agent');
    expect(steps.filter((s) => s.lane !== 'GATEWAY').every((s) => s.laneLabel === undefined)).toBe(true);
  });

  it('feeds the system flow map box names without changing the lane to node mapping', () => {
    const profile = profileOf(VERTICALS[1]);
    expect(chainNodeNames(buildPrivilegeA2aChainSteps(events(UC46, profile)))).toEqual({
      'pa-main': 'CareConnect agent',
      'pa-specialist': 'Records Specialist',
    });
    expect(chainNodeNames(buildPrivilegeA2aChainSteps(events(UC46, null)))).toEqual({});
  });
});
