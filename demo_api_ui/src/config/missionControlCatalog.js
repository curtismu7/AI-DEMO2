import { DEMO_MISSION_GROUPS } from './demoUseCaseSteps';

const link = (label, href) => ({ label, href });

const byId = Object.fromEntries(DEMO_MISSION_GROUPS.map((group) => [group.id, group]));

const definitions = [
  {
    id: 'personal-agent',
    product: 'Identity for AI & NHI',
    learning: [
      { label: 'Agent landscape and identity' },
      { label: 'Computer Use Agent (CUA)' },
    ],
    inspectors: [
      link('Agent Registry & NHI', '/agent-registry'),
      link('Agent & Token Flow History', '/agent-flow-inspector'),
      link('CIMD Simulation', '/client-registration'),
    ],
    diagrams: [
      link('Agent Onboarding Flow', '/agent-onboarding-flow'),
      link('Token Chain Architecture', '/architecture/token-chain'),
      link('Agent Gateway Authorization', '/agent-gateway-authorization'),
    ],
    routes: [link('Open Personal Agents', '/personal-agent')],
  },
  {
    id: 'digital-assistant',
    product: 'Identity for AI & NHI',
    learning: [
      { label: 'Actor Token (Agent)' },
      { label: 'Step-up MFA' },
      { label: 'CIBA (OOB)' },
    ],
    inspectors: [
      link('Agent & Token Flow History', '/agent-flow-inspector'),
      link('P1AZ Inspector', '/pingone-authorize'),
      link('Intent Inspector', '/intent-inspector'),
    ],
    diagrams: [
      link('Token Flow', '/architecture/token-flow'),
      link('Token Chain Architecture', '/architecture/token-chain'),
      link('Agent Gateway Authorization', '/agent-gateway-authorization'),
    ],
  },
  {
    id: 'consumer-partner',
    product: 'Identity for AI & NHI',
    learning: [
      { label: 'OAuth: CIMD' },
      { label: 'Agent IAM Core' },
    ],
    inspectors: [
      link('Consumer & Partner Agent Builder', '/agent-builder'),
      link('Agent Registry & NHI', '/agent-registry'),
      link('CIMD Simulation', '/client-registration'),
    ],
    diagrams: [
      link('Agent Onboarding Flow', '/agent-onboarding-flow'),
      link('Overview Diagram', '/architecture/overview'),
    ],
  },
  {
    id: 'employee-agent',
    product: 'PingOne Privilege & Privilege for AI',
    status: 'planned',
    plannedReason: 'Employee agent registration and endpoint evidence are planned for a future live lane.',
    inspectors: [
      link('Privilege Demo — Request Access', '/privilege-demo?tab=script'),
      link('Privilege MCP Client', '/privilege-mcp-client'),
    ],
    diagrams: [
      link('Privilege-First Gateway', '/privilege-first-gateway'),
      link('AI Agent Gateway', '/privilege-mcp-diagrams'),
    ],
  },
  {
    id: 'workload-agent',
    product: 'PingOne AI Agent Gateway',
    learning: [
      { label: 'MCP: MFA Gate on Tools' },
      { label: 'Enterprise-Managed Auth (EMA)' },
    ],
    routes: [link('Open Workload Agents', '/workload-agents')],
    inspectors: [
      link('Agent Gateway Authorization', '/agent-gateway-authorization'),
      link('Token Exchange', '/monitoring/token-exchange'),
      link('Agent & Token Flow History', '/agent-flow-inspector'),
    ],
    diagrams: [
      link('Token Chain Architecture', '/architecture/token-chain'),
      link('Gateway vs P1AZ Enforcement', '/gateway-enforcement-map'),
      link('Resource Server Placement', '/resource-server-placement'),
    ],
  },
  {
    id: 'agent-network',
    product: 'PingOne AI Agent Gateway',
    learning: [
      { label: 'Agent-to-Agent (A2A)' },
    ],
    inspectors: [
      link('Agent Gateway Inspector', '/agent-gateway-inspector'),
      link('Agent & Token Flow History', '/agent-flow-inspector'),
    ],
    diagrams: [
      link('A2A Protocol & Identity', '/a2a-protocol-learning'),
      link('Token Chain Architecture', '/architecture/token-chain'),
      link('Delegation Chain Value', '/delegation-chain-value'),
    ],
  },
  {
    id: 'discover',
    product: 'MCP Runtime & Discovery',
    learning: [
      { label: 'MCP Protocol' },
      { label: 'MCP Server Discovery' },
    ],
    inspectors: [
      link('MCP Discovery', '/mcp-discovery'),
      link('MCP Runtime Inventory', '/mcp-discovery'),
      link('Agent Registry & NHI', '/agent-registry'),
    ],
    diagrams: [link('System Diagram', '/architecture/system'), link('Overview Diagram', '/architecture/overview')],
  },
  {
    id: 'register',
    product: 'Identity for AI & NHI',
    learning: [
      { label: 'Agent landscape and identity' },
      { label: 'Enterprise-Managed Auth (EMA)' },
    ],
    inspectors: [
      link('Agent Onboarding Flow', '/agent-onboarding-flow'),
      link('CIMD Simulation', '/client-registration'),
      link('Agent Registry & NHI', '/agent-registry'),
    ],
    diagrams: [link('Agent Onboarding Flow', '/agent-onboarding-flow-subway')],
  },
  {
    id: 'authenticate',
    product: 'Identity for AI & NHI',
    learning: [
      { label: 'Auth Code + PKCE' },
      { label: 'Token Exchange (RFC 8693)' },
      { label: 'may_act / act claims' },
    ],
    inspectors: [
      link('Login Flow Diagram', '/login-flow'),
      link('Token Exchange', '/monitoring/token-exchange'),
      link('P1AZ Inspector', '/pingone-authorize'),
    ],
    diagrams: [
      link('Token Flow', '/architecture/token-flow'),
      link('Sequence Diagram', '/sequence-diagram'),
    ],
  },
  {
    id: 'authorize',
    product: 'PingOne Authorize',
    learning: [
      { label: 'PingOne Authorize' },
      { label: 'PAR (RFC 9126)' },
      { label: 'RAR (RFC 9396)' },
      { label: 'Gateway vs P1AZ Decision Split' },
    ],
    inspectors: [
      link('P1AZ Inspector', '/pingone-authorize'),
      link('Policy Decision Trace', '/policy-decision-trace'),
      link('Scope Audit', '/scope-audit'),
      link('Agent Gateway Authorization', '/agent-gateway-authorization'),
    ],
    diagrams: [
      link('Gateway vs P1AZ Enforcement', '/gateway-enforcement-map'),
      link('Resource Server Placement', '/resource-server-placement'),
    ],
  },
  {
    id: 'privilege',
    product: 'PingOne Privilege & Privilege for AI',
    learning: [
      { label: 'Privilege for AI — MCP' },
      { label: 'Privilege for AI — A2A' },
      { label: 'Privilege for AI — LLM' },
    ],
    inspectors: [
      link('Privilege Demo — Request Access', '/privilege-demo?tab=script'),
      link('Privilege MCP Client', '/privilege-mcp-client'),
      link('Privilege A2A access review', '/privilege-mcp-client?view=demo&tab=a2a'),
      link('Agent Privilege', '/llm-gateway'),
    ],
    diagrams: [
      link('Privilege MCP Architecture', '/privilege-mcp-diagrams'),
      link('Privilege-First Gateway', '/privilege-first-gateway'),
      link('Privilege Gateway Topologies (incl. Agent-to-agent)', '/privilege-gateway-topologies'),
      link('Privilege for AI', '/privilege-for-ai'),
    ],
  },
  {
    id: 'govern',
    product: 'Evidence & Governance',
    learning: [
      { label: 'Agent Kill Switch' },
      { label: 'Jev: Decision Model' },
    ],
    inspectors: [
      link('Governance Timeline', '/governance-timeline'),
      link('Audit Trail', '/audit-trail'),
      link('Run Reports', '/reports'),
      link('PingOne Events', '/monitoring/pingone-events'),
    ],
    diagrams: [
      link('System Flow', '/monitoring/system-flow'),
      link('Token Chain Architecture', '/architecture/token-chain'),
    ],
  },
].map((definition) => ({
  ...byId[definition.id],
  status: definition.status || 'live',
  ...definition,
}));

export const MISSION_CONTROL_CATALOG = definitions;

export function getMissionControlGroup(id) {
  return MISSION_CONTROL_CATALOG.find((group) => group.id === id) || null;
}
