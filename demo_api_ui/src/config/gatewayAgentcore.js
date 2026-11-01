// /gateway-claims, part 5: what Privilege gateway (mcpgw) v1.261028 added for AWS AgentCore governance.
// SOURCE: a symbol and string diff of the gateway image v1.261027 against v1.261028 (2026-10-28), plus a byte-for-byte check that
// the console swagger did not change from its 2026-10-26 baseline. NOTHING here was run against a real AgentCore account:
// every capability is INFERRED from function and string names and the two checks below are our own mock readings.
// All ARNs, roles and hosts are placeholders.
import { wrapMessages } from './sequenceWrap';

export const GATEWAY_VERSION_AGENTCORE = 'v1.261028';
const INVOKE = 'bedrock-agentcore:InvokeAgentRuntime';
const GATEWAY_ROLE = 'role/gateway-service';

export const AGENTCORE_FACTS = [
  { evidence: 'verified', text: 'Both SE gateways and the AI-DEMO2 namespace gateway run the image tag v1.261028 (read from the pod specs on 2026-10-28). Superseded for our SE gateway: it now runs v1.261030 (part 6). We did not re-read the other gateways.' },
  { evidence: 'verified', text: 'Against v1.261027 the two gateway binaries gained 84 and 83 symbols and lost 2 and 1, almost all AgentCore code. The console API spec (swagger) is byte-identical to the 2026-10-26 baseline, so none of it is in the console API.' },
  { evidence: 'inferred', text: 'Function names suggest the gateway can CHANGE AgentCore gateways (enforcement mode, rate limits, WAF mode, content check, authorizer, policy engines, Cedar policies, target allowed workloads and headers, runtime gateway-only) and GRADE them (caller access, runtime bypass posture and diff, enforcement health, compliance grade, IAM statement evaluation).' },
  { evidence: 'inferred', text: 'Strings in the binary name three findings: "any principal with bedrock-agentcore:InvokeAgentRuntime in the account can call this runtime directly", "any token from the IdP accepted", and "N of M target(s) without a caller allow-list". The policy audit hook was renamed from auditAIPolicy to auditPolicyEvent.' },
  { evidence: 'unverified', text: 'How the real gateway decides each finding (the exact rules, scores and grades) was not observed. The two checks below are this page\'s own mock readings of the finding wording.' },
];

export const MANAGE_ACTIONS = [
  ['Enforcement mode', 'Switch a gateway between enforcing and log-only'],
  ['Rate limits', 'Set request limits on a gateway'],
  ['WAF mode', 'Choose fail-open or fail-closed when the firewall fails'],
  ['Content check', 'Turn content inspection on for a gateway'],
  ['Authorizer', 'Change how callers authenticate to a gateway'],
  ['Policy engine', 'Create, update, delete and attach a policy engine'],
  ['Cedar policies', 'Create, update and delete Cedar policies inside an engine'],
  ['Target allowed workloads and headers', 'Limit which workloads may call a target and set its headers'],
  ['Runtime gateway-only', 'Make an agent runtime reachable only through its gateway'],
];

export const ANALYZE_VIEWS = [
  ['Caller access', 'Who may call a gateway, a target or a runtime'],
  ['Runtime bypass posture and diff', 'Which runtimes can be called around the gateway, and what changed'],
  ['Enforcement health', 'Whether each gateway is really enforcing'],
  ['Compliance grade', 'A graded summary per gateway'],
  ['Engine and gateway attachments', 'Which engines serve which gateways'],
  ['IAM statement evaluation', 'Reading IAM policy statements, with glob matching on actions'],
];

/** '*' matches any run of characters; case-insensitive like IAM action names. No regex is built from the input. */
export function globMatch(pattern, value) {
  const parts = String(pattern).toLowerCase().split('*');
  let rest = String(value).toLowerCase();
  if (!rest.startsWith(parts[0])) return false;
  rest = rest.slice(parts[0].length);
  for (let i = 1; i < parts.length; i += 1) {
    if (i === parts.length - 1) return parts[i] === '' || rest.endsWith(parts[i]);
    const at = rest.indexOf(parts[i]);
    if (at < 0) return false;
    rest = rest.slice(at + parts[i].length);
  }
  return true;
}

/** Can something call the agent runtime directly, around the gateway? The gateway's own role is the intended path, not a bypass. */
export function evaluateRuntimeBypass({ statements, gatewayOnly }) {
  const matches = statements.filter((s) => globMatch(s.action, INVOKE));
  const denied = new Set(matches.filter((s) => s.effect === 'Deny').map((s) => s.principal));
  const granted = [...new Set(matches.filter((s) => s.effect === 'Allow').map((s) => s.principal))];
  const allowed = granted.filter((p) => !denied.has(p) && !denied.has('*') && p !== GATEWAY_ROLE);
  if (gatewayOnly) return { bypassPossible: false, directInvokers: [], reason: 'gateway-only: direct callers are refused' };
  if (!allowed.length) return { bypassPossible: false, directInvokers: [], reason: granted.length ? 'only the gateway role, or principals an explicit Deny covers, can invoke the runtime' : 'no statement lets a principal invoke the runtime directly' };
  const any = allowed.includes('*');
  return { bypassPossible: true, directInvokers: allowed, reason: any ? 'any principal with bedrock-agentcore:InvokeAgentRuntime in the account can call this runtime directly' : `${allowed.join(', ')} can call this runtime directly` };
}

/** Who may call a gateway, from its authorizer and an optional workload allow-list per target. */
export function classifyGatewayCaller({ authorizerType, targets }) {
  const without = targets.filter((t) => !t.allowedWorkloads || t.allowedWorkloads.length === 0).length;
  const callerClass = authorizerType === 'NONE' ? 'no authentication: anyone can call'
    : authorizerType === 'AWS_IAM' ? 'any IAM principal allowed by the gateway role policy'
      : without === targets.length ? 'any token from the IdP accepted' : 'only allow-listed workloads';
  return { callerClass, targetsWithoutAllowList: without, targetCount: targets.length, summary: `${without} of ${targets.length} target(s) without a caller allow-list`, risky: without > 0 };
}

const OPEN = [{ effect: 'Allow', action: 'bedrock-agentcore:*', principal: '*' }];
const ONLY_GATEWAY = [{ effect: 'Allow', action: INVOKE, principal: GATEWAY_ROLE }];

export const AGENTCORE_GROUPS = [
  { id: 'bypass', label: 'Runtime bypass', blurb: 'An agent runtime has its own IAM policy. If it lets callers invoke the runtime directly, the gateway can be bypassed.' },
  { id: 'caller', label: 'Who may call the gateway', blurb: 'The gateway authorizer decides who can call it, and each target can carry a workload allow-list.' },
];

export const AGENTCORE_SCENARIOS = [
  { id: 'bypass-open', group: 'bypass', label: 'Open runtime policy', input: { statements: OPEN, gatewayOnly: false }, story: 'A wildcard Allow matches InvokeAgentRuntime for any principal, so anything in the account can skip the gateway. This is the wording the binary uses.' },
  { id: 'bypass-gateway-role', group: 'bypass', label: 'Only the gateway role', input: { statements: ONLY_GATEWAY, gatewayOnly: false }, story: 'Only the gateway\'s own role may invoke. That is the intended path, so there is no bypass.' },
  { id: 'bypass-denied', group: 'bypass', label: 'Open, but explicitly denied', input: { statements: [...OPEN, { effect: 'Deny', action: INVOKE, principal: '*' }], gatewayOnly: false }, story: 'An explicit Deny that covers every principal wins over the wildcard Allow.' },
  { id: 'bypass-gateway-only', group: 'bypass', label: 'Gateway-only switch on', input: { statements: OPEN, gatewayOnly: true }, story: 'The binary can set a runtime to gateway-only. We read it as refusing direct callers whatever the statements say.' },
  { id: 'caller-none', group: 'caller', label: 'No authorizer', input: { authorizerType: 'NONE', targets: [{ name: 'orders', allowedWorkloads: [] }] }, story: 'No authentication at all: anyone who can reach the gateway can call it.' },
  { id: 'caller-jwt-open', group: 'caller', label: 'JWT, no allow-list', input: { authorizerType: 'CUSTOM_JWT', targets: [{ name: 'orders', allowedWorkloads: [] }, { name: 'reports', allowedWorkloads: [] }] }, story: 'Callers must present a token from the IdP, but every valid token is accepted. This is the "any token from the IdP accepted" finding.' },
  { id: 'caller-jwt-mixed', group: 'caller', label: 'JWT, one target allow-listed', input: { authorizerType: 'CUSTOM_JWT', targets: [{ name: 'orders', allowedWorkloads: ['agent-orders-01'] }, { name: 'reports', allowedWorkloads: [] }] }, story: 'One target is limited to named workloads, the other is not. The summary counts targets without an allow-list.' },
  { id: 'caller-jwt-locked', group: 'caller', label: 'JWT, every target allow-listed', input: { authorizerType: 'CUSTOM_JWT', targets: [{ name: 'orders', allowedWorkloads: ['agent-orders-01'] }, { name: 'reports', allowedWorkloads: ['agent-reports-03'] }] }, story: 'Every target names the workloads allowed to call it.' },
].map((s) => ({ ...s, evidence: 'inferred', result: s.group === 'bypass' ? evaluateRuntimeBypass(s.input) : classifyGatewayCaller(s.input) }));

export const AGENTCORE_LANES = { A: 'agent', G: 'gateway', R: 'api', C: 'authz' };
export const AGENTCORE_DETAILS = {
  A: 'The caller: an agent or any principal in the AWS account.',
  G: 'Privilege gateway, mcpgw v1.261028. The path every call is meant to take.',
  R: 'The AgentCore agent runtime. It has its own IAM policy, which is where a bypass can come from.',
  C: 'The governance check: reads the runtime policy and the gateway authorizer and reports what is reachable around the gateway.',
};

/** A sequence diagram for one scenario (placeholder names; mock reading). */
export function agentcoreDiagram(s) {
  const bad = s.group === 'bypass' ? s.result.bypassPossible : s.result.risky;
  const rows = ['sequenceDiagram', '    autonumber', '    participant A as Caller\\nagent or principal', '    participant G as Privilege gateway\\nmcpgw v1.261028', '    participant R as AgentCore runtime\\nown IAM policy', '    participant C as Governance check\\nread from the binary'];
  const msgs = [];
  if (s.group === 'bypass') {
    msgs.push(['A->>G: Normal path: tools/call through the gateway', 'POST https://mcpgw.example.com/orders/mcp\nAuthorization: Bearer <token>']);
    msgs.push(['G->>R: Gateway invokes the runtime with its own role', `InvokeAgentRuntime as ${GATEWAY_ROLE}`]);
    msgs.push(['C->>R: Read the runtime policy statements', JSON.stringify(s.input.statements, null, 2) + `\ngatewayOnly: ${s.input.gatewayOnly}`]);
    msgs.push([bad ? 'A->>R: Direct call around the gateway is possible' : 'A-->>R: Direct call is refused', s.result.reason]);
  } else {
    msgs.push(['A->>G: Call a target with a token', `authorizerType: ${s.input.authorizerType}`]);
    msgs.push(['C->>G: Read the authorizer and each target allow-list', JSON.stringify(s.input.targets, null, 2)]);
    msgs.push([`C-->>G: Caller class: ${s.result.callerClass}`, s.result.summary]);
  }
  rows.push(`    rect rgb(${bad ? '255,235,222' : '218,240,240'})`, ...msgs.map(([m]) => `    ${m}`), '    end');
  return { source: wrapMessages(`${rows.join('\n')}\n`), payloads: msgs.map(([, p]) => p) };
}
