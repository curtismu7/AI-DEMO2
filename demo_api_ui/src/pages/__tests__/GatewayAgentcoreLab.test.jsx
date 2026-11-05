import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GatewayClaimsPage from '../GatewayClaimsPage';
import { parseSequence } from '../../utils/parseSequence';
import {
  AGENTCORE_DETAILS, AGENTCORE_FACTS, AGENTCORE_SCENARIOS, agentcoreDiagram, classifyGatewayCaller, evaluateRuntimeBypass, globMatch,
} from '../../config/gatewayAgentcore';

const OPEN = [{ effect: 'Allow', action: 'bedrock-agentcore:*', principal: '*' }];

describe('globMatch', () => {
  it('matches star runs, ignores case, and never builds a regex from the pattern', () => {
    expect(globMatch('bedrock-agentcore:*', 'bedrock-agentcore:InvokeAgentRuntime')).toBe(true);
    expect(globMatch('bedrock-agentcore:Invoke*Runtime', 'bedrock-agentcore:InvokeAgentRuntime')).toBe(true);
    expect(globMatch('s3:*', 'bedrock-agentcore:InvokeAgentRuntime')).toBe(false);
    expect(globMatch('BEDROCK-AGENTCORE:INVOKEAGENTRUNTIME', 'bedrock-agentcore:invokeagentruntime')).toBe(true);
    expect(globMatch('(a+)+$', 'aaaaaaaaaaaaaaaaaaaaaaaa!')).toBe(false);
  });
});

describe('evaluateRuntimeBypass', () => {
  it('a wildcard Allow opens the runtime to any principal', () => {
    const r = evaluateRuntimeBypass({ statements: OPEN, gatewayOnly: false });
    expect(r.bypassPossible).toBe(true);
    expect(r.reason).toMatch(/any principal with bedrock-agentcore:InvokeAgentRuntime/);
  });
  it('the gateway role alone is not a bypass; an explicit Deny wins; gateway-only refuses direct callers', () => {
    expect(evaluateRuntimeBypass({ statements: [{ effect: 'Allow', action: 'bedrock-agentcore:InvokeAgentRuntime', principal: 'role/gateway-service' }], gatewayOnly: false }).bypassPossible).toBe(false);
    expect(evaluateRuntimeBypass({ statements: [...OPEN, { effect: 'Deny', action: 'bedrock-agentcore:InvokeAgentRuntime', principal: '*' }], gatewayOnly: false }).bypassPossible).toBe(false);
    expect(evaluateRuntimeBypass({ statements: OPEN, gatewayOnly: true }).bypassPossible).toBe(false);
    expect(evaluateRuntimeBypass({ statements: [], gatewayOnly: false }).bypassPossible).toBe(false);
    expect(evaluateRuntimeBypass({ statements: [{ effect: 'Allow', action: 'bedrock-agentcore:InvokeAgentRuntime', principal: 'role/other' }], gatewayOnly: false }).directInvokers).toEqual(['role/other']);
  });
});

describe('classifyGatewayCaller', () => {
  const t = (n, w) => Array.from({ length: n }, (_, i) => ({ name: `t${i}`, allowedWorkloads: i < w ? ['a'] : [] }));
  it('names the caller class and counts targets without an allow-list', () => {
    expect(classifyGatewayCaller({ authorizerType: 'NONE', targets: t(1, 0) }).callerClass).toMatch(/no authentication/);
    expect(classifyGatewayCaller({ authorizerType: 'CUSTOM_JWT', targets: t(2, 0) }).callerClass).toBe('any token from the IdP accepted');
    const mixed = classifyGatewayCaller({ authorizerType: 'CUSTOM_JWT', targets: t(2, 1) });
    expect(mixed.summary).toBe('1 of 2 target(s) without a caller allow-list');
    expect(mixed.risky).toBe(true);
    expect(classifyGatewayCaller({ authorizerType: 'CUSTOM_JWT', targets: t(2, 2) }).risky).toBe(false);
  });
});

describe('data hygiene', () => {
  it('every scenario is labelled inferred, has a parseable diagram, and nothing real leaks in', () => {
    expect(AGENTCORE_SCENARIOS.length).toBe(8);
    for (const s of AGENTCORE_SCENARIOS) {
      expect(s.evidence).toBe('inferred');
      const d = agentcoreDiagram(s);
      const model = parseSequence(d.source);
      expect(model.items.filter((i) => i.from && i.to)).toHaveLength(d.payloads.length);
      for (const p of model.participants) expect(AGENTCORE_DETAILS[p.id]).toBeTruthy();
    }
    expect(AGENTCORE_FACTS.filter((f) => f.evidence === 'unverified').length).toBe(1);
    expect(JSON.stringify([AGENTCORE_FACTS, AGENTCORE_SCENARIOS])).not.toMatch(/\.ping-devops\.com|\.pingone\.com|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe('GatewayClaimsPage part 5', () => {
  const open = () => render(<MemoryRouter><GatewayClaimsPage /></MemoryRouter>);
  it('shows the open runtime as a bypass, then none once gateway-only is on', () => {
    open();
    const sec = screen.getByTestId('gwc-agentcore');
    expect(within(sec).getByTestId('gwc-ag-verdict')).toHaveTextContent('BYPASS POSSIBLE');
    fireEvent.click(within(sec).getByTestId('gwc-ag-bypass-gateway-only'));
    expect(within(sec).getByTestId('gwc-ag-verdict')).toHaveTextContent('NO BYPASS');
  });
  it('switches to the caller check and shows the N of M summary', () => {
    open();
    const sec = screen.getByTestId('gwc-agentcore');
    fireEvent.click(within(sec).getByTestId('gwc-ag-group-caller'));
    expect(within(sec).getByTestId('gwc-ag-verdict')).toHaveTextContent('no authentication');
    fireEvent.click(within(sec).getByTestId('gwc-ag-caller-jwt-mixed'));
    expect(within(sec).getByTestId('gwc-ag-verdict')).toHaveTextContent('1 of 2 target(s) without a caller allow-list');
    expect(within(sec).getByTestId('gwc-ag-verdict').getAttribute('data-bad')).toBe('true');
  });
  it('labels the section inferred and keeps the UNVERIFIED note visible', () => {
    open();
    const sec = screen.getByTestId('gwc-agentcore');
    expect(sec).toHaveTextContent('UNVERIFIED');
    expect(sec).toHaveTextContent('byte-identical to the 2026-10-26 baseline');
  });
});
