// "Identity for AI General Availability" (ID4AI deck page 45): the product map as a pingStyle diagram.
// Protect, Authorize, Privilege, Agent IAM Core, Agent Gateway and Agent Governance between Users, Agents and Resources.
// Each STEP covers the arrows of one product; its detail (request, MOCK token, standards) is in identityForAiStandards.js.
import { IDENTITY_FOR_AI_DETAIL as D } from './identityForAiStandards';

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });

export const IDENTITY_FOR_AI_GROUPS = {
  ping: { label: 'Ping product', bg: '#b5231a' },
  actor: { label: 'User, agent or resource', bg: '#151a24' },
  safety: { label: 'Safety signal', bg: '#5a5f69' },
};

export const IDENTITY_FOR_AI_NODES = [
  N('users', 'actor', 'Users', ['people who delegate', 'and approve'], 0, 0),
  N('agents', 'actor', 'Agents', ['personal, enterprise and', 'coding agents'], 0, 250),
  N('resources', 'actor', 'Resources', ['APIs, MCP servers, data'], 1140, 250),
  N('protect', 'safety', 'PingOne Protect', ['Agent Detection', 'Threat Analysis'], 0, 500),
  N('authorize', 'ping', 'PingOne Authorize', ['Fine-Grained AuthZ', 'Business Policies'], 380, 500),
  N('privilege', 'ping', 'PingOne Privilege', ['JIT Credentials', 'MCP Developer Gateway'], 760, 0),
  N('core', 'ping', 'Agent IAM Core', ['Agent & Resource Management', 'Agent Authentication & Delegation', 'Human-in-the-Loop', 'On AIC, PingOne, PingFederate, AIS'], 380, 0),
  N('gateway', 'ping', 'Agent Gateway', ['MCP Validation & Auditing', 'Agent Token Validation', 'OAuth-based Authorization'], 380, 250),
  N('governance', 'ping', 'Agent Governance', ['Agent & MCP Discovery', 'Access Insights', 'Certifications, Requests, Approvals'], 760, 500),
];

// Edge index + 1 = the badge number. Dashed = a decision or a token.
export const IDENTITY_FOR_AI_EDGES = [
  ['agents', 'protect', 'agent traffic scored', { vertical: true }], // 0
  ['protect', 'authorize', 'risk signal feeds policy', { dashed: true }], // 1
  ['gateway', 'authorize', 'may this agent act? permit or deny', { dashed: true, vertical: true }], // 2
  ['core', 'privilege', 'agent identity, then a JIT credential', { dashed: true }], // 3
  ['privilege', 'resources', 'JIT credential at the resource', { dashed: true }], // 4
  ['users', 'core', 'user signs in and delegates'], // 5
  ['agents', 'core', 'agent authenticates, gets a delegated token', { dashed: true }], // 6
  ['agents', 'gateway', 'MCP call with the delegated token'], // 7
  ['gateway', 'resources', 'validated and audited call'], // 8
  ['gateway', 'governance', 'audit trail shows agents and MCP servers', { dashed: true }], // 9
  ['governance', 'resources', 'access insights and certified access', { dashed: true }], // 10
];

export const IDENTITY_FOR_AI_STEPS = [
  { key: 'protect', edges: [0], title: 'PingOne Protect', what: 'Scores the traffic reaching your apps, so automated agent traffic is detected and threats are analysed before a decision is made.', why: 'A policy can only treat agents differently if something first tells agents and people apart.', detail: D.protect },
  { key: 'authorize', edges: [1, 2], title: 'PingOne Authorize', what: 'Takes the Protect risk signal and decides each action from the user, the agent and the business rules: fine-grained authorization with policies written in business terms.', why: 'The token says who may call; the decision says whether this call, with this amount, is allowed.', detail: D.authorize },
  { key: 'privilege', edges: [3, 4], title: 'PingOne Privilege', what: 'Issues just-in-time credentials and fronts MCP servers for developers, so a coding agent gets only what it needs, only when it needs it.', why: 'Nothing long-lived sits on the developer machine or in the agent.', detail: D.privilege },
  { key: 'core', edges: [5, 6], title: 'Agent IAM Core', what: 'Registers agents and resources, authenticates them, and delegates a user\'s authority to the agent, with a human approving when policy says so. Available on AIC, PingOne, PingFederate and AIS.', why: 'Every later control relies on one identity for the agent and a delegated token that names the user too.', detail: D.core },
  { key: 'gateway', edges: [7, 8], title: 'Agent Gateway', what: 'Validates the agent token on every MCP call, checks the OAuth authorization, audits the call, and only then forwards it to the resource.', why: 'The resource never has to understand agent tokens; the gateway is the one enforcement point.', detail: D.gateway },
  { key: 'governance', edges: [9, 10], title: 'Agent Governance', what: 'Discovers the agents and MCP servers in use, shows what they can reach, and keeps that access certified through requests and approvals.', why: 'Access that nobody reviews drifts; governance turns the audit trail into a review.', detail: D.governance },
];

export const IDENTITY_FOR_AI_DIAGRAM = {
  GROUPS: IDENTITY_FOR_AI_GROUPS,
  NODES: IDENTITY_FOR_AI_NODES,
  EDGES: IDENTITY_FOR_AI_EDGES,
  STEPS: IDENTITY_FOR_AI_STEPS,
};
