import { describe, expect, it } from 'vitest';
import { BASELINE_RULES, POLICIES, applyEdit, buildCedar, predictImpact } from '../privilegeAiPoliciesDemo';

const outcomes = (i) => Object.fromEntries(Object.entries(i).map(([t, v]) => [t, v.outcome]));

describe('buildCedar reproduces the live policies exactly', () => {
  it('a refuse rule is the live hitl-block-generic-api policy, character for character', () => {
    expect(buildCedar({ outcome: 'refuse', tool: 'GenericOpenSearchApiTool', reason: 'this tool can call any OpenSearch API endpoint - blocked outright, no approval path' }))
      .toBe(POLICIES['hitl-block-generic-api'].cedar);
  });

  it('a hold rule is the live hitl-opensearch policy, character for character', () => {
    expect(buildCedar({ outcome: 'hold', tool: 'SearchIndexTool', liftsOnApproval: true, reason: 'This is HITL' })).toBe(POLICIES['hitl-opensearch'].cedar);
  });

  it('refuse acts on mcp:Invoke with no approval machinery; hold acts on mcp:InvokeUnattended with approvers and an unless', () => {
    const refuse = buildCedar({ outcome: 'refuse', tool: 'ListIndexTool' });
    expect(refuse).toContain('Action::"mcp:Invoke"');
    expect(refuse).not.toMatch(/@approvers|unless/);
    const hold = buildCedar({ outcome: 'hold', tool: 'ListIndexTool' });
    expect(hold).toContain('Action::"mcp:InvokeUnattended"');
    expect(hold).toMatch(/@approvers/);
    expect(hold).toContain('unless { context has approval_count && context.approval_count >= 1 };');
  });

  it('a hold without the lift clause has no unless, and still ends the rule', () => {
    const hold = buildCedar({ outcome: 'hold', tool: 'SearchIndexTool', liftsOnApproval: false });
    expect(hold).not.toContain('unless');
    expect(hold.trim().endsWith('};')).toBe(true);
  });
});

describe('predictImpact', () => {
  it('today: hold SearchIndexTool, refuse GenericOpenSearchApiTool, allow ListIndexTool, and a hold lifts after approval', () => {
    const i = predictImpact(BASELINE_RULES);
    expect(outcomes(i)).toEqual({ SearchIndexTool: 'hold', GenericOpenSearchApiTool: 'deny', ListIndexTool: 'allow' });
    expect(i.SearchIndexTool).toMatchObject({ afterApproval: 'allow', by: 'hitl-opensearch' });
  });

  it('a Candidate is never enforced: saving the hold rule as a Candidate makes SearchIndexTool fall back to allowed', () => {
    const { impact } = applyEdit('hitl-opensearch', { ...BASELINE_RULES[0], state: 'Candidate' });
    expect(outcomes(impact)).toEqual({ SearchIndexTool: 'allow', GenericOpenSearchApiTool: 'deny', ListIndexTool: 'allow' });
  });

  it('changing the hold rule to refuse makes SearchIndexTool denied, with no approval path', () => {
    const { impact } = applyEdit('hitl-opensearch', { ...BASELINE_RULES[0], outcome: 'refuse' });
    expect(impact.SearchIndexTool).toMatchObject({ outcome: 'deny', afterApproval: null });
  });

  it('a hold without the unless clause stays held after approval', () => {
    const { impact } = applyEdit('hitl-opensearch', { ...BASELINE_RULES[0], liftsOnApproval: false });
    expect(impact.SearchIndexTool).toMatchObject({ outcome: 'hold', afterApproval: 'hold' });
  });

  it('retargeting the refuse rule frees the old tool and blocks the new one', () => {
    const { impact } = applyEdit('hitl-block-generic-api', { ...BASELINE_RULES[1], tool: 'ListIndexTool' });
    expect(outcomes(impact)).toEqual({ SearchIndexTool: 'hold', GenericOpenSearchApiTool: 'allow', ListIndexTool: 'deny' });
  });

  it('a new rule is added to the live ones, and a refuse beats a hold on the same tool', () => {
    expect(outcomes(applyEdit('new', { outcome: 'hold', tool: 'ListIndexTool', state: 'Active', liftsOnApproval: true }).impact).ListIndexTool).toBe('hold');
    const both = applyEdit('new', { outcome: 'refuse', tool: 'SearchIndexTool', state: 'Active' });
    expect(both.impact.SearchIndexTool).toMatchObject({ outcome: 'deny', by: 'your-new-rule' });
  });

  it('an unchanged edit predicts exactly today', () => {
    expect(applyEdit('hitl-opensearch', { ...BASELINE_RULES[0] }).impact).toEqual(predictImpact(BASELINE_RULES));
  });
});
