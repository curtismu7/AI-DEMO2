'use strict';

const { holdRulesFrom, holdToolsByDoor } = require('../../services/privilegeHoldRules');

describe('hold rules (HITL badges)', () => {
  const cedar = (door, tool, extra = 'unless { context has approval_count && context.approval_count >= 1 }') =>
    `forbid (principal, action == Action::"mcp:InvokeUnattended", resource == Tool::"${tool}") when { context.app == "${door}" } ${extra};`;
  const ai = (name, state, c) => ({ name, state, spec: { Cedar: c } });

  test('an Active forbid that lifts on approval names its door and tool', () => {
    expect(holdRulesFrom([ai('hitl-opensearch', 'Active', cedar('opensearch-hitl', 'SearchIndexTool'))]))
      .toEqual([{ door: 'opensearch-hitl', tool: 'SearchIndexTool', policy: 'hitl-opensearch' }]);
  });

  test('a candidate, a plain refusal, and a rule with no named tool are not holds', () => {
    expect(holdRulesFrom([
      ai('cand', 'Candidate', cedar('d', 't')),
      ai('refuse', 'Active', cedar('d', 't', '')),
      ai('anytool', 'Active', 'forbid (principal, action, resource) when { context.app == "d" } unless { context has approval_count };'),
    ])).toEqual([]);
  });

  test('rules group by door, and a record without them reads null', () => {
    expect(holdToolsByDoor({ holdRules: [{ door: 'a', tool: 'x', policy: 'p1' }, { door: 'a', tool: 'y', policy: 'p2' }, { door: 'b', tool: 'z', policy: 'p3' }] }))
      .toEqual({ a: { x: 'p1', y: 'p2' }, b: { z: 'p3' } });
    expect(holdToolsByDoor({ applications: [] })).toBeNull();
    expect(holdToolsByDoor(null)).toBeNull();
  });
});
