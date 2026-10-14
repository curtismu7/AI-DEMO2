import { agentModeKey, pageAgentModeField } from '../pageAgentMode';

beforeEach(() => localStorage.clear());

test('no saved choice sends no agentMode, so the global mode decides', () => {
  expect(pageAgentModeField('/dashboard')).toEqual({});
});

test('a saved choice for this path rides along; another path is unaffected', () => {
  localStorage.setItem(agentModeKey('/dashboard'), 'heuristics');
  expect(pageAgentModeField('/dashboard')).toEqual({ agentMode: 'heuristics' });
  expect(pageAgentModeField('/privilege-a2a')).toEqual({});
});

test('anything other than heuristics or llm is ignored', () => {
  localStorage.setItem(agentModeKey('/x'), 'bogus');
  expect(pageAgentModeField('/x')).toEqual({});
});
