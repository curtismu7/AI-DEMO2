// "ID4AI slides 301": every architecture diagram from the ID4AI Maturity Model deck (Architecture 501), redrawn as
// ReactFlow in the Ping slide look (PingSlideFlow). `page` is the slide's page in public/id4ai/*.pdf.
// Node `steps` ([n]) light a node on that walkthrough step; edge `step` animates an arrow. Reuses the OBO and
// Coding Agents slides already built for /demo-arch-slides.
import { OBO_SLIDE, OBO_STEPS, CODING_SLIDE, CODING_STEPS } from './pingSlideDiagrams';
import { IDENTITY_FOR_AI_DIAGRAM } from './identityForAiDiagram';

export const ID4AI_PDF = '/id4ai/ID4AI-Maturity-Model-Architecture-501.pdf';

const N = (id, kind, x, y, o = {}) => ({ id, kind, x, y, ...o });
const E = (from, to, fs, ts, step, o = {}) => ({ from, to, fs, ts, step, ...o });
const S = (title, desc) => [title, desc];

// ---- 2 · The journey to trust AI ----
const journeyCards = [
  ['DISCOVER', 'Where are my agents?', 'Discover agents across your environment'],
  ['REGISTER', 'Who are my agents?', 'Establish trusted agent identities'],
  ['AUTHENTICATE', 'Can I trust my agents?', 'Prove the agent identity, including on-behalf-of the user'],
  ['AUTHORIZE', 'What can my agents do?', 'Enforce controls, policies, & least privilege'],
  ['GOVERN', 'What have my agents done?', 'Assess risk & validate compliance. Evaluate trustworthiness.'],
];
const JOURNEY = {
  title: 'The journey to', subtitle: 'trust AI', aspect: '1560 / 400',
  nodes: journeyCards.flatMap(([stage, q, a], i) => [
    N(`c${i}`, 'numcard', i * 310, 0, { w: 290, h: 240, num: i + 1, label: q, sub: a, steps: [i + 1] }),
    N(`s${i}`, 'chevron', i * 310, 270, { w: 300, h: 64, label: stage, steps: [i + 1] }),
  ]),
  edges: [],
};
const JOURNEY_STEPS = journeyCards.map(([stage, q, a]) => S(`${stage}: ${q}`, a));

// ---- 3 · Four kinds of agents ----
const KINDS = [
  ['Employee Agents', 'Personal productivity: native, browser, and coding agents running on the user’s device.', 'ChatGPT · Claude · Claude Code'],
  ['Consumer & Partner Agents', 'The new front door: agents acting on behalf of customers and partners in digital channels.', 'ChatGPT · Claude'],
  ['Workload Agents', 'The digital workforce: assistants & autonomous agents running on self-hosted or third-party platforms.', 'Amazon Bedrock · Google Vertex.ai · LangChain'],
  ['SaaS-Embedded Agents', 'Vendor embedded: agents running inside SaaS applications.', 'Salesforce · Glean'],
];
const FOUR_KINDS = {
  title: 'Four kinds of agents.', subtitle: 'Same outcome, different paths.', aspect: '1560 / 440',
  nodes: [
    N('personal', 'card', 0, 0, { w: 740, h: 90, label: 'Personal Agents', sub: 'On the device at work or home' }),
    N('enterprise', 'card', 780, 0, { w: 740, h: 90, label: 'Enterprise Agents', sub: 'In the cloud' }),
    ...KINDS.map(([t, d, logos], i) => N(`k${i}`, 'card', i * 385, 130, { w: 365, h: 230, label: t, sub: `${d}\n\n${logos}`, steps: [i + 1], top: true })),
  ],
  edges: [],
};
const FOUR_KINDS_STEPS = KINDS.map(([t, d]) => S(t, d));

// ---- 6 / 15 · Reference architecture: endpoint agents (Agent Broker) and employee personal agents (AI Gateway) ----
const RESOURCES = [
  ['mcp', 'MCP servers', ''], ['repos', 'Code repositories', 'GitHub, GitLab'], ['k8s', 'Kubernetes clusters', ''],
  ['dbs', 'Databases', ''], ['cloud', 'Cloud infrastructure', 'AWS, Microsoft, Google'],
];
const endpointRef = (subtitle, broker, admin) => ({
  title: 'Reference Architecture:', subtitle, aspect: '1560 / 640',
  nodes: [
    N('ws', 'card', 0, 190, { w: 280, h: 230, label: 'Workstations', sub: 'Claude: Code · Desktop · Browser\n• Endpoint Controller\n• Browser Plugin' }),
    N('admin', 'card', 470, 10, { w: 200, h: 56, label: admin }),
    N('broker', 'redcard', 430, 140, { w: 280, h: 290, label: broker, sub: 'Policy & access enforcement', items: ['✓ Allow', '⊘ Deny', '◉ Log'] }),
    N('idp', 'card', 470, 520, { w: 200, h: 56, label: 'Identity Provider' }),
    N('panel', 'panel', 920, 0, { w: 480, h: 600, label: 'Managed resources' }),
    ...RESOURCES.map(([id, t, sub], i) => N(id, 'card', 950, 50 + i * 108, { w: 420, h: 84, label: t, sub })),
  ],
  edges: [
    E('ws', 'broker', 'r', 'l', 1, { label: 'AGENTIC TRAFFIC' }),
    E('admin', 'broker', 'b', 't', 2, { label: 'Policy', both: true }),
    E('broker', 'idp', 'b', 't', 3, { label: 'Authenticate user & agent', both: true, dx: 120 }),
    ...RESOURCES.map(([id]) => E('broker', id, 'r', 'l', 4)),
  ],
});
const ENDPOINT_STEPS = (broker, admin) => [
  S('Agentic traffic leaves the workstation', 'Agents on the workstation (Claude Code, Desktop, Browser) are visible through the Endpoint Controller and Browser Plugin.'),
  S(`${admin} sets the rules`, `The ${admin.toLowerCase()} defines which agents may reach which managed resources.`),
  S('Identity is checked', `The ${broker} confirms who the user and the agent are with the identity provider.`),
  S('Allow, deny or log', `The ${broker} enforces policy on every call and only then reaches MCP servers, repos, clusters, databases and cloud infrastructure.`),
];

// ---- 7 · Reference architecture: coding agents ----
const CODING_REF = {
  title: 'Reference Architecture:', subtitle: 'Coding Agents', aspect: '1560 / 640',
  nodes: [
    N('boundary', 'boundary', 0, 70, { w: 30, h: 480 }),
    N('idp', 'ping', 400, 20, { w: 62, h: 62, label: 'IdP / OAuth AS' }),
    N('dev', 'user', 120, 330, { w: 84, h: 84 }),
    N('devl', 'text', 100, 428, { label: 'Developer' }),
    N('agent', 'robot', 380, 300, { w: 140, h: 140, label: 'Coding Agent', sub: 'PingOne Privilege Endpoint Controller' }),
    N('broker', 'redcard', 700, 170, { w: 250, h: 360, label: 'Agent Broker', sub: 'Policy & access enforcement' }),
    N('panel', 'panel', 1170, 130, { w: 380, h: 420, label: 'Managed resources' }),
    N('git', 'card', 1195, 175, { w: 330, h: 70, label: 'Git repo' }),
    N('db', 'card', 1195, 260, { w: 330, h: 70, label: 'Database', sub: 'MCP' }),
    N('fs', 'card', 1195, 345, { w: 330, h: 70, label: 'File system', sub: 'MCP' }),
    N('cfg', 'card', 1195, 430, { w: 330, h: 70, label: 'Admin configs' }),
  ],
  edges: [
    E('dev', 'idp', 't', 'l', 1, { label: 'AUTHN / AUTHZ / HITL', both: true, dx: 20 }),
    E('dev', 'agent', 'r', 'l', 2, { label: 'DELEGATE' }),
    E('agent', 'broker', 'r', 'l', 3, { label: 'AGENT TRAFFIC' }),
    E('broker', 'idp', 't', 'r', 4, { both: true }),
    E('broker', 'git', 'r', 'l', 5, { label: 'JIT CREDENTIALS', at: 'end' }),
    E('broker', 'db', 'r', 'l', 5),
    E('broker', 'fs', 'r', 'l', 5),
    E('broker', 'cfg', 'r', 'l', 5),
  ],
};
const CODING_REF_STEPS = [
  S('Developer authenticates', 'The developer signs in at the IdP / OAuth AS, with step-up and human approval where policy requires it.'),
  S('Developer delegates to the agent', 'The coding agent runs under the developer, watched by the PingOne Privilege Endpoint Controller.'),
  S('Agent traffic goes to the broker', 'Every action the agent takes is routed through the Agent Broker.'),
  S('Broker checks identity', 'The broker validates user and agent identity with the IdP.'),
  S('JIT credentials', 'Policy governs every action. When it is met, credentials are injected just in time to complete the task.'),
];

// ---- 9 · Logical architecture (PingOne Privilege) ----
const PRIV_LOGICAL = {
  title: 'Logical', subtitle: 'Architecture', aspect: '1560 / 620',
  nodes: [
    N('uni', 'card', 560, 0, { w: 330, h: 90, label: 'PingOne Privilege', sub: 'Universal Service (cloud)' }),
    N('ec', 'card', 0, 330, { w: 300, h: 100, label: 'PingOne Privilege', sub: 'Endpoint Controller (laptop)' }),
    N('panel', 'panel', 520, 250, { w: 900, h: 300, label: 'On-Prem / VPC' }),
    N('gw', 'card', 560, 330, { w: 300, h: 100, label: 'PingOne Privilege', sub: 'Gateway' }),
    N('srv', 'card', 1080, 290, { w: 300, h: 60, label: 'Servers' }),
    N('dbs', 'card', 1080, 365, { w: 300, h: 60, label: 'Databases' }),
    N('k8s', 'card', 1080, 440, { w: 300, h: 60, label: 'Kubernetes' }),
    N('iaas', 'card', 1000, 70, { w: 420, h: 100, label: 'IaaS Consoles · IaaS CLI', sub: 'AWS · Azure · Google Cloud' }),
  ],
  edges: [
    E('ec', 'uni', 't', 'l', 1, { both: true, label: 'Policy & approvals' }),
    E('gw', 'uni', 't', 'b', 2, { both: true, label: 'Gateway registers' }),
    E('ec', 'gw', 'r', 'l', 3, { both: true, label: 'Brokered session' }),
    E('gw', 'srv', 'r', 'l', 4),
    E('gw', 'dbs', 'r', 'l', 4),
    E('gw', 'k8s', 'r', 'l', 4),
  ],
};
const PRIV_LOGICAL_STEPS = [
  S('Endpoint Controller ↔ Universal Service', 'The controller on the laptop works with the cloud-hosted Universal Service for policy and approvals.'),
  S('Gateway ↔ Universal Service', 'The on-prem or VPC gateway is managed by the same Universal Service.'),
  S('Endpoint Controller ↔ Gateway', 'The controller reaches protected infrastructure through the gateway.'),
  S('Gateway ↔ resources', 'The gateway brokers access to servers, databases and Kubernetes inside the on-prem / VPC boundary.'),
];

// ---- 10 · Just-in-time privileged access ----
const TARGETS = [
  ['t1', 'Public clouds', 'AWS · GCP · Azure'], ['t2', 'Data clouds', 'Snowflake · Databricks · Elastic'],
  ['t3', 'Compute', 'EC2 · GCP Compute · Lambda'], ['t4', 'Datastores', 'RDS · S3 · PostgreSQL'], ['t5', 'On prem', 'Servers · DBs · Kubernetes'],
];
const JIT = {
  title: 'Just-In-Time', subtitle: 'Privileged Access', aspect: '1560 / 760',
  nodes: [
    N('devops', 'card', 0, 20, { w: 180, h: 70, label: 'DevOps' }),
    N('it', 'card', 0, 150, { w: 180, h: 70, label: 'IT' }),
    N('sec', 'card', 0, 280, { w: 180, h: 70, label: 'Security' }),
    N('jit', 'redcard', 400, 80, { w: 280, h: 240, label: 'PingOne Privilege', sub: 'Just-in-time access' }),
    N('tpm', 'card', 300, 440, { w: 160, h: 60, label: 'TPM' }),
    N('idp', 'card', 500, 440, { w: 160, h: 60, label: 'IDP' }),
    N('appr', 'card', 700, 440, { w: 160, h: 60, label: 'Approver' }),
    N('panel', 'panel', 960, 0, { w: 520, h: 620, label: 'Access targets' }),
    ...TARGETS.map(([id, t, sub], i) => N(id, 'card', 990, 40 + i * 114, { w: 460, h: 90, label: t, sub })),
    N('b1', 'card', 0, 650, { w: 360, h: 100, label: 'Ephemeral Credential Issuance', sub: 'No long standing privileges or secrets', steps: [3] }),
    N('b2', 'card', 380, 650, { w: 360, h: 100, label: 'High Assurance & Phishing Resistant', sub: 'Leverage TPM to bind verified identity to device', steps: [2] }),
    N('b3', 'card', 760, 650, { w: 360, h: 100, label: 'Flexible & Hybrid Deployment', sub: 'Agentless & agent-based for cloud and on-prem', steps: [3] }),
    N('b4', 'card', 1140, 650, { w: 360, h: 100, label: 'Session Recording & Kill Switch', sub: 'Record in real time for compliance / forensics', steps: [3] }),
  ],
  edges: [
    E('devops', 'jit', 'r', 'l', 1), E('it', 'jit', 'r', 'l', 1), E('sec', 'jit', 'r', 'l', 1),
    E('tpm', 'jit', 't', 'b', 2), E('idp', 'jit', 't', 'b', 2), E('appr', 'jit', 't', 'b', 2),
    ...TARGETS.map(([id]) => E('jit', id, 'r', 'l', 3)),
  ],
};
const JIT_STEPS = [
  S('People ask for access', 'DevOps, IT and Security request privileged access through PingOne Privilege.'),
  S('Identity is verified', 'The TPM binds a verified identity to the device, the IDP authenticates, and an approver signs off.'),
  S('Ephemeral credentials are issued', 'Short-lived credentials reach public clouds, data clouds, compute, datastores and on-prem systems. No long-standing privileges or secrets; sessions are recorded with a kill switch.'),
];

// ---- 11 · Privilege MCP gateway ----
const MCPGW = {
  title: 'Privilege', subtitle: 'MCP Gateway', aspect: '1560 / 700',
  nodes: [
    N('client', 'card', 0, 150, { w: 200, h: 90, label: 'MCP Client' }),
    N('gw', 'redcard', 300, 130, { w: 220, h: 130, label: 'MCP Gateway', sub: 'Protects developer & admin access' }),
    N('panel', 'panel', 640, 0, { w: 820, h: 400, label: 'MCP-exposed privileged resources' }),
    ...[1, 2, 3].flatMap((n, i) => [
      N(`ms${n}`, 'card', 680, 50 + i * 115, { w: 260, h: 90, label: `MCP Server ${n}` }),
      N(`ds${n}`, 'card', 1120, 50 + i * 115, { w: 280, h: 90, label: `Data Source ${n}` }),
    ]),
    N('f1', 'card', 0, 440, { w: 360, h: 100, label: 'Time-Bound Approvals', sub: 'Access to MCP servers is granted only for the duration of a session', steps: [2] }),
    N('f2', 'card', 380, 440, { w: 360, h: 100, label: 'Secretless Access', sub: 'Eliminate static API keys, credentials, passwords for MCP access', steps: [2] }),
    N('f3', 'card', 760, 440, { w: 360, h: 100, label: 'Privilege Scoping for Least Agency', sub: 'Fine-grained control over tools, prompts and resources agents can invoke', steps: [2] }),
    N('f4', 'card', 1140, 440, { w: 360, h: 100, label: 'Session Visibility', sub: 'Full session recording of all invocations for audit and compliance', steps: [3] }),
  ],
  edges: [
    E('client', 'gw', 'r', 'l', 1),
    E('gw', 'ms1', 'r', 'l', 2), E('gw', 'ms2', 'r', 'l', 2), E('gw', 'ms3', 'r', 'l', 2),
    E('ms1', 'ds1', 'r', 'l', 3), E('ms2', 'ds2', 'r', 'l', 3), E('ms3', 'ds3', 'r', 'l', 3),
  ],
};
const MCPGW_STEPS = [
  S('MCP client calls the gateway', 'The developer or admin’s MCP client connects through the Privilege MCP Gateway.'),
  S('Gateway scopes and approves', 'Time-bound approvals, secretless access and privilege scoping decide which MCP servers, tools and prompts the agent can use.'),
  S('Every invocation is recorded', 'MCP servers reach their data sources, and the full session is recorded for audit and compliance.'),
];

// ---- 12 · Securing agentic building: commit tracking ----
const COMMITS = {
  title: 'Securing Agentic Building:', subtitle: 'Agent Commit Tracking', aspect: '1560 / 680',
  nodes: [
    N('dev1', 'card', 0, 40, { w: 200, h: 90, label: 'Dev 1' }),
    N('agent', 'robot', 0, 190, { w: 130, h: 130, label: 'Agent A1' }),
    N('ws', 'card', 420, 160, { w: 260, h: 110, label: 'Developer Workstation' }),
    N('git', 'card', 900, 160, { w: 260, h: 110, label: 'GitLab / GitHub' }),
    N('audit', 'card', 880, -10, { w: 420, h: 100, label: 'Audit Log', sub: '10:00 AM · commit 876e3fqc · Dev 1 · 4 files\n10:05 AM · commit 9f8a2blc · Agent A1 · 2 files', steps: [3] }),
    N('b1', 'redcard', 0, 400, { w: 480, h: 220, label: 'Human vs Agent Attribution', sub: 'Distinguishes between humans and agents on the same workstation. Applies precise attribution and tracking to commits.', steps: [1] }),
    N('b2', 'redcard', 510, 400, { w: 480, h: 220, label: 'Secretless Access', sub: 'Removes the need for developers to manage, rotate, or store git credentials. Agents cannot accidentally leak or misuse credentials.', steps: [2] }),
    N('b3', 'redcard', 1020, 400, { w: 480, h: 220, label: 'Policy Based Enforcement', sub: 'Ephemeral access granted on demand based on policies. Every git operation is intercepted, checked, and audited.', steps: [2, 3] }),
  ],
  edges: [
    E('dev1', 'ws', 'r', 'l', 1, { dashed: true, label: 'Human commits' }),
    E('agent', 'ws', 'r', 'l', 1, { label: 'Agent commits' }),
    E('ws', 'git', 'r', 'l', 2, { label: 'commit 9f8a2blc' }),
    E('git', 'audit', 't', 'b', 3, { label: 'Every operation audited', dx: 150 }),
  ],
};
const COMMITS_STEPS = [
  S('Humans and agents commit from one workstation', 'Dev 1 and Agent A1 share a workstation; the commit is attributed to whichever one made it.'),
  S('Secretless, policy-checked git access', 'The commit reaches GitLab / GitHub without developers managing git credentials; access is ephemeral and granted by policy.'),
  S('Audit log shows who did what', 'Every git operation is intercepted, checked and audited, so a human commit and an agent commit are distinguishable.'),
];

// ---- 13 · SSO for AI agents: cross-app access ----
const CROSS_APP = {
  title: 'SSO for AI Agents:', subtitle: 'Cross-App Access', aspect: '1560 / 680',
  nodes: [
    N('idp', 'ping', 300, 20, { w: 62, h: 62, label: 'IdP / OAuth AS' }),
    N('agent', 'robot', 250, 360, { w: 160, h: 160, label: 'Agent' }),
    N('boundary', 'boundary', 940, 0, { w: 34, h: 640 }),
    N('as', 'win', 1050, 140, { w: 220, h: 80, label: 'OAuth AS', dashed: true }),
    N('mcp', 'servers', 1050, 440, { mcp: true, label: 'Service A' }),
  ],
  edges: [
    E('agent', 'idp', 't', 'b', 1, { n: '1', both: true, label: 'OAuth Assertion Grant Flow', sub: 'Agent credential exchanged for assertion grant', dx: 150 }),
    E('agent', 'as', 'r', 'l', 2, { n: '2', label: 'Assertion Grant for Service A', off: -14, dx: -50, dy: -40 }),
    E('as', 'agent', 'l', 'r', 3, { n: '3', label: 'Access Token', sub: '(AgentID/ClientID)', off: 14, dx: 50, dy: 10 }),
    E('agent', 'mcp', 'r', 'l', 4, { n: '4', label: 'Access Token', sub: '(AgentID/ClientID)', off: -10 }),
  ],
};
const CROSS_APP_STEPS = [
  S('OAuth assertion grant flow', 'The agent’s credential is exchanged at the IdP for an assertion grant, so the agent does not hold secrets for every backend service.'),
  S('Assertion grant for Service A', 'The agent presents the assertion grant to Service A’s OAuth authorization server.'),
  S('Access token issued', 'Service A’s authorization server returns an access token for the AgentID / ClientID, under enterprise-managed policy.'),
  S('Call the MCP service', 'The agent calls Service A’s MCP server with that access token.'),
];

// ---- 16 · Employee agents: productivity agents ----
const PROD_SERVICES = [['api', 'API'], ['db', 'Database'], ['fs', 'File system'], ['saas', 'SaaS']];
const PRODUCTIVITY = {
  title: 'Employee Agents:', subtitle: 'Productivity Agents', aspect: '1560 / 700',
  nodes: [
    N('boundary', 'boundary', 0, 20, { w: 34, h: 560 }),
    N('emp', 'user', 90, 400, { w: 84, h: 84 }),
    N('empl', 'text', 90, 496, { label: 'Employee' }),
    N('idp', 'ping', 480, 20, { w: 62, h: 62, label: 'IdP / OAuth AS' }),
    N('agent', 'robot', 420, 380, { w: 150, h: 150, label: 'Claude CoWork' }),
    N('broker', 'gateway', 900, 20, { w: 86, h: 540, label: 'Agent Broker' }),
    ...PROD_SERVICES.map(([id, t], i) => N(id, 'servers', 1230, 10 + i * 140, { mcp: true, label: t })),
  ],
  edges: [
    E('emp', 'idp', 't', 'l', 1, { label: 'User Authentication' }),
    E('idp', 'emp', 'l', 'r', 2, { label: 'HITL AuthN / AuthZ', dashed: true, off: 40, dy: 30 }),
    E('emp', 'agent', 'r', 'l', 3, { label: 'Access Token', sub: '(UserID)' }),
    E('agent', 'broker', 'r', 'l', 4),
    E('broker', 'idp', 'lt', 'r', 4, { both: true }),
    ...PROD_SERVICES.map(([id]) => E('broker', id, 'r', 'l', 5, { label: 'JIT Credential', at: 'end' })),
  ],
};
const PRODUCTIVITY_STEPS = [
  S('User authentication', 'The employee signs in at the IdP / OAuth AS from inside the trust boundary.'),
  S('Human in the loop', 'Where policy requires it, the IdP asks the employee for AuthN / AuthZ approval.'),
  S('Access token to the agent', 'The employee hands Claude CoWork an access token carrying only the UserID.'),
  S('Agent calls the broker', 'The agent’s traffic goes through the Agent Broker, which works with the IdP.'),
  S('JIT credentials per service', 'The broker injects just-in-time credentials for the API, database, file system and SaaS MCP servers.'),
];

// ---- 19 · Consumer and partner agents ----
const CP_SERVICES = [['sa', 'Service A', 'mTLS', '6a', true], ['sb', 'Service B', 'ClientID / Client Secret', '6b', true], ['sc', 'Service C', 'Access Token (UserID)', '6c', false]];
const CONSUMER = {
  title: 'Consumer and Partner', subtitle: 'Agents', aspect: '1560 / 720',
  nodes: [
    N('user', 'user', 20, 30, { w: 90, h: 90 }),
    N('userl', 'text', 20, 130, { label: 'Consumer / Partner' }),
    N('agent', 'robot', 20, 420, { w: 120, h: 120, label: 'Agent', badge: '1' }),
    N('boundary', 'boundary', 330, 10, { w: 34, h: 640 }),
    N('az', 'ping', 600, 90, { w: 62, h: 62, label: 'Fine Grained AZ' }),
    N('idp', 'ping', 600, 420, { w: 62, h: 62, label: 'IdP / OAuth AS' }),
    N('gw', 'gateway', 1000, 10, { w: 90, h: 640, label: 'MCP GW  ·  API GW' }),
    ...CP_SERVICES.map(([id, t, , , mcp], i) => N(id, 'servers', 1300, 30 + i * 150, { mcp, label: t })),
    N('ax', 'robot', 1300, 480, { w: 90, h: 90, label: 'Agent X' }),
  ],
  edges: [
    E('agent', 'idp', 'r', 'l', 1, { n: '1', label: 'Agent Registration', sub: '(UserID, Agent ID)', dx: 130, dy: 44 }),
    E('user', 'az', 'r', 'l', 2, { n: '2', both: true, label: 'User Authentication', sub: 'CIBA flow for HITL AuthN / AuthZ', dx: 20 }),
    E('idp', 'user', 't', 'b', 3, { n: '3c', label: 'Delegation Token', sub: '(UserID, AgentID)', dashed: true, off: -30, dx: -100, dy: -20 }),
    E('idp', 'gw', 'r', 'l', 4, { n: '4', dashed: true, label: 'TX Token', sub: '(UserID, AgentID)' }),
    E('gw', 'az', 'lt', 'r', 5, { dashed: true, label: 'Decision request', dy: -20 }),
    E('az', 'idp', 'b', 't', 5, { dashed: true }),
    ...CP_SERVICES.map(([id, , l, n]) => E('gw', id, 'r', 'l', 6, { n, label: l, at: 'end' })),
    E('gw', 'ax', 'r', 'l', 6, { n: '6d', label: 'API Key', at: 'end' }),
  ],
};
const CONSUMER_STEPS = [
  S('Agent registration', 'The consumer’s or partner’s agent is registered with the user and agent IDs.'),
  S('User authentication', 'The user authenticates; a CIBA flow brings the human into the loop for AuthN / AuthZ.'),
  S('Delegation token', 'The user delegates to the agent, producing a delegation token carrying UserID and AgentID.'),
  S('TX token to the gateway', 'The IdP issues a transaction token (UserID, AgentID) that the agent presents to the MCP / API gateway.'),
  S('Fine-grained authorization', 'The gateway asks Fine Grained AZ for a decision before anything is reached.'),
  S('Backend access', 'The gateway reaches each backend its own way: mTLS, client credentials, the user access token, or an API key.'),
];

// ---- 20 / 21 · Personal agents: MCP and CUA ----
const personalFlow = (kind) => {
  const cua = kind === 'cua';
  return {
    title: 'Personal Agents:', subtitle: cua ? 'CUA' : 'MCP', aspect: '1560 / 640',
    nodes: [
      N('human', 'user', 20, 380, { w: 90, h: 90 }),
      N('humanl', 'text', 20, 482, { label: 'Human' }),
      N('agent', 'robot', 260, 360, { w: 130, h: 130, label: 'ClientID', badge: '2' }),
      N('boundary', 'boundary', 640, 10, { w: 34, h: 620 }),
      N('idp', 'ping', 1000, 60, { w: 62, h: 62, label: cua ? 'IdP' : 'IdP / OAuth AS' }),
      ...(cua ? [N('protect', 'ping', 1300, 60, { w: 62, h: 62, label: 'Protect\nCUA Agent Detection' })] : []),
      N('target', 'win', 900, 400, { w: 200, h: 80, label: cua ? 'Web' : 'MCP', dashed: true }),
      N('acct', 'servers', 1180, 400, { label: 'Protected User Account' }),
    ],
    edges: [
      E('agent', 'target', 'r', 'l', 1, { n: '1', label: 'Access Request', dy: -34 }),
      E('agent', 'idp', 't', 'l', 2, { n: '2', label: cua ? 'OIDC Redirect for User Authentication' : 'Client ID Metadata Document (CIMD)', dx: 30, dy: -34 }),
      ...(cua ? [E('idp', 'protect', 'r', 'l', 3, { label: 'CUA Agent Detection' })] : []),
      E('idp', 'human', 'b', 't', cua ? 4 : 3, { n: '3', label: cua ? 'OOB User Authentication and Delegated Access Approval' : 'OAuth Authorization Code Flow / PKCE', dx: -260, dy: -24, dashed: true }),
      ...(cua ? [] : [E('human', 'idp', 'b', 'b', 4, { n: '4', label: 'User Authentication and Delegated Access Approval', off: 0, dy: 70, dx: 250 })]),
      E('agent', 'target', 'b', 'b', 5, { n: '5', label: 'Access Token (UserID/ClientID)' + (cua ? ' + ID Token (UserID)' : ''), dy: 40 }),
    ],
  };
};
const PERSONAL_MCP_STEPS = [
  S('Access request', 'The agent asks the MCP server for access; the request carries no token yet.'),
  S('Client ID Metadata Document', 'The agent identifies itself with a CIMD (a URL as ClientID), so no per-agent registration is needed.'),
  S('OAuth authorization code flow with PKCE', 'The IdP sends the human through an authorization code flow with PKCE.'),
  S('User authentication and delegated approval', 'The human authenticates and approves delegating access to the agent.'),
  S('Access token', 'The agent calls the MCP server with an access token for UserID / ClientID.'),
];
const PERSONAL_CUA_STEPS = [
  S('Access request', 'A computer-using agent (CUA) opens a website to act for the human.'),
  S('OIDC redirect for user authentication', 'The site redirects the CUA to the IdP for user authentication.'),
  S('CUA agent detection', 'PingOne Protect detects that the visitor is a computer-using agent.'),
  S('Out-of-band authentication and approval', 'The real human authenticates out of band and approves delegated access.'),
  S('Tokens', 'The agent receives an access token (UserID / ClientID) and an ID token (UserID).'),
];

// ---- 23 · Reference architecture: workload agents ----
const WL_RES = [['mcp', 'MCP servers'], ['svc', 'Internal services & APIs'], ['data', 'Data & systems of record']];
const WORKLOAD_REF = {
  title: 'Reference Architecture:', subtitle: 'Workload Agents', aspect: '1560 / 700',
  nodes: [
    N('idp', 'card', 0, 150, { w: 260, h: 110, label: 'User IdP', sub: 'Authenticates the user behind the agent' }),
    N('core', 'redcard', 400, 80, { w: 330, h: 250, label: 'Agent IAM Core', items: ['Runtime context', 'Generates delegated token'] }),
    N('gw', 'redcard', 860, 80, { w: 330, h: 250, label: 'Agent Gateway', sub: 'Translates identity & delegation into safe access' }),
    N('panel', 'panel', 1290, 60, { w: 330, h: 330, label: 'Managed resources' }),
    ...WL_RES.map(([id, t], i) => N(id, 'card', 1310, 110 + i * 90, { w: 290, h: 70, label: t })),
    N('authz', 'dashedcard', 400, 470, { w: 790, h: 100, label: 'Agent Authorize', sub: 'Fine-grained authorization on every agent action, logged, allow, deny, or escalate to a human.' }),
    N('gov', 'redcard', 1290, 470, { w: 330, h: 190, label: 'Agent Governance', items: ['Agent Discovery', 'Certifications, Requests, Approvals'] }),
  ],
  edges: [
    E('idp', 'core', 'r', 'l', 1, { label: 'AUTHENTICATE' }),
    E('core', 'gw', 'r', 'l', 2, { label: 'DELEGATED TOKEN' }),
    ...WL_RES.map(([id]) => E('gw', id, 'r', 'l', 3)),
    E('core', 'authz', 'b', 't', 4, { both: true }),
    E('gw', 'authz', 'b', 't', 4, { both: true }),
    E('authz', 'gov', 'r', 'l', 5),
    E('panel', 'gov', 'b', 't', 5, { both: true }),
  ],
};
const WORKLOAD_REF_STEPS = [
  S('Authenticate', 'The user IdP authenticates the person behind the agent.'),
  S('Delegated token', 'Agent IAM Core adds runtime context and generates a delegated token.'),
  S('Gateway turns delegation into safe access', 'The Agent Gateway translates identity and delegation into scoped access to MCP servers, internal services & APIs, and systems of record.'),
  S('Authorize every action', 'Agent Authorize makes a fine-grained decision on every agent action: allow, deny, or escalate to a human. Every decision is logged.'),
  S('Govern', 'Agent Governance discovers agents and runs certifications, requests and approvals over the managed resources.'),
];

// ---- 25 · Digital worker (autonomous) ----
const DIGITAL_WORKER = {
  title: 'Workload Agent:', subtitle: 'Digital Worker (Autonomous)', aspect: '1560 / 640',
  nodes: [
    N('boundary', 'boundary', 0, 20, { w: 34, h: 580 }),
    N('cust', 'user', 130, 270, { w: 84, h: 84 }),
    N('custl', 'text', 130, 366, { label: 'Custodian' }),
    N('life', 'ping', 480, 110, { w: 62, h: 62, label: 'Agent Lifecycle Mgmt\nonboarding, offboarding, governance' }),
    N('idp', 'ping', 420, 250, { w: 62, h: 62, label: 'IdP / OAuth AS' }),
    N('reg', 'ping', 760, 250, { w: 62, h: 62, label: 'Agent Registry\nidentifiers, keys, entitlements' }),
    N('agent', 'robot', 380, 480, { w: 130, h: 130, label: 'Agent Credential', sub: '(PK-JWT or SVID-JWT)\nsub: AgentID' }),
    N('mcp', 'servers', 1100, 520, { mcp: true, label: 'Service A' }),
  ],
  edges: [
    E('cust', 'life', 't', 'l', 1, { dashed: true, label: 'Onboard the agent', dx: -40 }),
    E('life', 'reg', 'r', 'r', 1, { dashed: true }),
    E('agent', 'idp', 't', 'b', 2, { n: '1', label: 'Agent Auth via Client Credential', dx: -50, dy: 30, off: -14 }),
    E('idp', 'reg', 'r', 'l', 3, { n: '2', label: 'Look up identity, keys, entitlements' }),
    E('idp', 'agent', 'b', 't', 4, { n: '3', label: 'Access Token', sub: 'sub: AgentID', off: 14, dx: 120 }),
    E('agent', 'mcp', 'r', 'l', 5, { n: '3a', label: 'Access Token', sub: 'sub: AgentID' }),
  ],
};
const DIGITAL_WORKER_STEPS = [
  S('A custodian onboards the agent', 'Agent Lifecycle Management registers the agent in the Agent Registry: identifiers, keys and entitlements.'),
  S('Agent authenticates', 'With no user involved, the agent authenticates to the IdP with its own client credential (PK-JWT or SVID-JWT, sub = AgentID).'),
  S('Registry lookup', 'The IdP checks the Agent Registry for the agent’s identity, keys and entitlements.'),
  S('Access token', 'The IdP issues an access token whose sub is the AgentID.'),
  S('Call the service', 'The agent calls Service A’s MCP server with that token.'),
];

// ---- 27 · AI agents need access to data and services ----
const NEEDS_ACCESS = {
  title: 'AI Agents Need', subtitle: 'Access to Data and Services', aspect: '1560 / 560',
  nodes: [
    N('user', 'card', 0, 120, { w: 290, h: 280, label: 'User', top: true }),
    N('agent', 'card', 400, 120, { w: 290, h: 280, label: 'Unique Agent Identity', top: true }),
    N('mcp', 'redcard', 950, 150, { w: 220, h: 200, label: 'MCP  ·  A2A' }),
    N('apis', 'card', 1220, 0, { w: 280, h: 80, label: 'APIs' }),
    N('dbs', 'card', 1220, 130, { w: 280, h: 80, label: 'DBs' }),
    N('agents', 'card', 1220, 260, { w: 280, h: 80, label: 'Agents' }),
    N('web', 'card', 1220, 390, { w: 280, h: 80, label: 'Websites' }),
  ],
  edges: [
    E('user', 'agent', 'r', 'l', 1, { label: 'Delegation' }),
    E('agent', 'mcp', 'r', 'l', 2, { label: 'Authentication, Authorization and Approvals', dy: -48 }),
    E('mcp', 'apis', 'r', 'l', 3), E('mcp', 'dbs', 'r', 'l', 3), E('mcp', 'agents', 'r', 'l', 3), E('mcp', 'web', 'r', 'l', 3),
  ],
};
const NEEDS_ACCESS_STEPS = [
  S('The user delegates', 'The user delegates to an agent that has its own unique identity.'),
  S('Authentication, authorization and approvals', 'To get "smart", the agent reaches data and services over MCP and A2A, and every call needs authentication, authorization and approvals.'),
  S('Reaching APIs, databases, agents and websites', 'This interactivity is why IAM is central to AI agent success.'),
];

// ---- 32 · Layers of agent identity ----
const LAYERS_ROWS = [
  ['Users & Accounts', 'Application', 'User/Service Accounts, Passwords'],
  ['API Clients', 'APIs', 'API Keys, Client Secrets'],
  ['Workloads', 'Infrastructure', 'SPIFFE, WIMSE, mTLS'],
  ['Devices / Machines', 'Network', 'IP Address, mTLS'],
];
const LAYERS = {
  title: 'Layers of', subtitle: 'Agent Identity', aspect: '1560 / 560',
  nodes: [
    N('h1', 'text', 250, 0, { label: 'Identity Types' }), N('h2', 'text', 700, 0, { label: 'Resource Types' }), N('h3', 'text', 1150, 0, { label: 'Identifiers & Credential Types' }),
    N('ai', 'card', 0, 50, { w: 120, h: 440, label: 'AI Agents', top: true }),
    ...LAYERS_ROWS.flatMap(([a, b, c], i) => [
      N(`a${i}`, 'redcard', 190, 50 + i * 115, { w: 330, h: 90, label: a, steps: [i + 1] }),
      N(`b${i}`, 'card', 640, 50 + i * 115, { w: 330, h: 90, label: b, steps: [i + 1] }),
      N(`c${i}`, 'card', 1090, 50 + i * 115, { w: 400, h: 90, label: c, steps: [i + 1] }),
    ]),
  ],
  edges: LAYERS_ROWS.flatMap((_r, i) => [E(`a${i}`, `b${i}`, 'r', 'l', i + 1), E(`b${i}`, `c${i}`, 'r', 'l', i + 1)]),
};
const LAYERS_STEPS = LAYERS_ROWS.map(([a, b, c]) => S(a, `An agent acting as ${a.toLowerCase()} reaches ${b.toLowerCase()} resources using ${c}.`));

// ---- 43 · Enterprise managed authorization via ID-JAG ----
const EMA = {
  title: 'Enterprise Managed Authorization', subtitle: 'via ID-JAG', aspect: '1560 / 680',
  nodes: [
    N('idp', 'ping', 280, 60, { w: 62, h: 62, label: 'IdP / OAuth AS' }),
    N('agent', 'robot', 230, 380, { w: 160, h: 160, label: 'Agent' }),
    N('boundary', 'boundary', 950, 0, { w: 34, h: 660 }),
    N('as', 'win', 1050, 36, { w: 220, h: 110, label: 'OAuth AS', dashed: true }),
    N('mcp', 'servers', 1050, 470, { mcp: true, label: 'Service A' }),
  ],
  edges: [
    E('idp', 'as', 'r', 't', 1, { dashed: true, label: 'Trust Relationship' }),
    E('agent', 'idp', 't', 'b', 2, { n: '1', both: true, label: 'OAuth Assertion Grant Flow', sub: 'OBO credential exchanged for ID-JAG', dx: 150 }),
    E('agent', 'as', 'r', 'l', 3, { n: '2', label: 'ID-JAG exchanged for Access Token', off: -14, dx: -50, dy: -40 }),
    E('as', 'agent', 'l', 'r', 4, { n: '3', label: 'Access Token', off: 14, dx: 60, dy: 10 }),
    E('agent', 'mcp', 'r', 'l', 5, { label: 'Access Token', off: -10 }),
  ],
};
const EMA_STEPS = [
  S('Trust relationship', 'The enterprise IdP and the service’s OAuth AS are configured to trust each other, so there are no per-user consent screens.'),
  S('OBO credential exchanged for an ID-JAG', 'The agent exchanges its on-behalf-of credential at the enterprise IdP for an Identity Assertion JWT Authorization Grant.'),
  S('ID-JAG exchanged for an access token', 'The agent presents the ID-JAG to the service’s authorization server.'),
  S('Access token issued', 'The service’s authorization server enforces enterprise-managed runtime policy and issues an access token.'),
  S('Call Service A', 'The agent calls the MCP server with the access token. No consent sprawl.'),
];

// ---- 48 · Reference architecture: consumer agents ----
const CONSUMER_REF = {
  title: 'Reference Architecture:', subtitle: 'Consumer Agents', aspect: '1560 / 760',
  nodes: [
    N('t1', 'text', 300, 0, { label: 'MCP Interface' }),
    N('mcpagent', 'robot', 240, 60, { w: 120, h: 120, label: 'Ex: Claude Connector, ChatGPT App' }),
    N('gw', 'redcard', 640, 40, { w: 280, h: 140, label: 'Agent Gateway', sub: 'Policy & access enforcement' }),
    N('mcps', 'card', 1100, 40, { w: 280, h: 70, label: 'MCP Servers' }),
    N('iam1', 'redcard', 780, 240, { w: 360, h: 140, label: 'Agent IAM Core', sub: 'In-line identity experience\nConsumer <> agent consents, delegated access' }),
    N('t2', 'text', 300, 400, { label: 'CUA Interface' }),
    N('cua', 'robot', 240, 460, { w: 120, h: 120, label: 'Ex: Claude Desktop or Claude Chrome Browser Extension' }),
    N('web', 'card', 620, 500, { w: 240, h: 90, label: 'Webpage' }),
    N('protect', 'redcard', 980, 480, { w: 260, h: 130, label: 'PingOne Protect', sub: 'Inbound agent detection and classification' }),
    N('iam2', 'redcard', 1330, 480, { w: 270, h: 130, label: 'Agent IAM Core', sub: 'OOB identity experience\nConsumer <> agent consents, delegated access' }),
  ],
  edges: [
    E('mcpagent', 'gw', 'r', 'l', 1, { label: 'AGENTIC TRAFFIC' }),
    E('gw', 'iam1', 'b', 't', 2, { both: true, label: 'Consent & delegation', dx: 110 }),
    E('gw', 'mcps', 'r', 'l', 3),
    E('cua', 'web', 'r', 'l', 4),
    E('web', 'protect', 'r', 'l', 5),
    E('protect', 'iam2', 'r', 'l', 6),
  ],
};
const CONSUMER_REF_STEPS = [
  S('MCP interface: agentic traffic', 'A consumer’s agent (Claude connector, ChatGPT app) reaches an MCP server through the Agent Gateway.'),
  S('In-line identity experience', 'The gateway works with Agent IAM Core for the consumer-to-agent consent and delegated access.'),
  S('MCP servers', 'Once policy is satisfied, the call reaches the MCP servers.'),
  S('CUA interface: agent on a webpage', 'A computer-using agent (Claude Desktop, Chrome extension) browses the consumer’s website.'),
  S('PingOne Protect', 'Protect detects and classifies the inbound agent.'),
  S('Out-of-band identity experience', 'Agent IAM Core takes the consumer through out-of-band consent and delegated access.'),
];

const ep = (subtitle, broker, admin) => ({ config: endpointRef(subtitle, broker, admin), steps: ENDPOINT_STEPS(broker, admin) });

// id, menu label, source pdf page, config, steps, caption, optional ping (a pingStyle {GROUPS,NODES,EDGES,STEPS} diagram that replaces the PingSlideFlow config)
export const ID4AI_SLIDES = [
  ['journey', 'The journey to trust AI', 2, JOURNEY, JOURNEY_STEPS, 'Five questions every customer works through: discover, register, authenticate, authorize and govern their agents.'],
  ['four-kinds', 'Four kinds of agents', 3, FOUR_KINDS, FOUR_KINDS_STEPS, 'Personal agents run on the device; enterprise agents run in the cloud. Same outcome, different paths.'],
  ['endpoint-agents', 'Ref arch: Endpoint Agents', 6, ...Object.values(ep('Endpoint Agents', 'Agent Broker', 'Admin Console')), 'Know what agents are running. Control what they can reach across your managed resources.'],
  ['personal-agents-ref', 'Ref arch: Employee Personal Agents', 15, ...Object.values(ep('Employee Personal Agents', 'AI Gateway', 'Policy Engine')), 'The same pattern with an AI Gateway and a policy engine.'],
  ['coding-ref', 'Ref arch: Coding Agents', 7, CODING_REF, CODING_REF_STEPS, 'Policy governs every action. When it is met, credentials are injected just in time to complete the task.'],
  ['coding-agents', 'Employee Agents: Coding Agents', 8, CODING_SLIDE, CODING_STEPS, 'Coding agents are distinguished from humans and get only just-in-time credentials from the Agent Broker.'],
  ['privilege-logical', 'PingOne Privilege logical architecture', 9, PRIV_LOGICAL, PRIV_LOGICAL_STEPS, 'Endpoint Controller, Universal Service and Gateway, with on-prem / VPC resources behind the gateway.'],
  ['jit-access', 'Just-in-time privileged access', 10, JIT, JIT_STEPS, 'Ephemeral credentials replace standing privileges and secrets.'],
  ['mcp-gateway', 'Privilege MCP gateway', 11, MCPGW, MCPGW_STEPS, 'Protect developer and admin access to MCP-exposed privileged resources.'],
  ['commit-tracking', 'Agent commit tracking', 12, COMMITS, COMMITS_STEPS, 'Humans and agents on the same workstation, told apart in the audit log.'],
  ['cross-app-access', 'SSO for AI agents: Cross-App Access', 13, CROSS_APP, CROSS_APP_STEPS, 'An OAuth assertion grant gives the agent SSO and enterprise-managed authorization, with no per-service secrets.'],
  ['productivity', 'Employee Agents: Productivity', 16, PRODUCTIVITY, PRODUCTIVITY_STEPS, 'An employee’s productivity agent gets JIT credentials per service through the Agent Broker.'],
  ['consumer-partner', 'Consumer and partner agents', 19, CONSUMER, CONSUMER_STEPS, 'Registration, user authentication with CIBA, delegation, TX token and gateway access.'],
  ['personal-mcp', 'Personal Agents: MCP', 20, personalFlow('mcp'), PERSONAL_MCP_STEPS, 'Dynamic registration with CIMD and delegated access through an authorization code flow.'],
  ['personal-cua', 'Personal Agents: CUA', 21, personalFlow('cua'), PERSONAL_CUA_STEPS, 'Computer-using agents are detected by PingOne Protect and approved out of band.'],
  ['workload-ref', 'Ref arch: Workload Agents', 23, WORKLOAD_REF, WORKLOAD_REF_STEPS, 'Every agent runs on a delegated identity, so its access is scoped, brokered and accountable end to end.'],
  ['obo', 'Workload Agent: Digital Assistant (OBO)', 24, OBO_SLIDE, OBO_STEPS, 'A digital assistant acts on behalf of a signed-in user through a transaction token.'],
  ['digital-worker', 'Workload Agent: Digital Worker', 25, DIGITAL_WORKER, DIGITAL_WORKER_STEPS, 'An autonomous agent authenticates as itself, using its registry entry and a client credential.'],
  ['needs-access', 'AI agents need access to data and services', 27, NEEDS_ACCESS, NEEDS_ACCESS_STEPS, 'IAM is central to AI agent success.'],
  ['identity-layers', 'Layers of agent identity', 32, LAYERS, LAYERS_STEPS, 'Identity types, the resources they reach, and the credentials used at each layer.'],
  ['id-jag-ema', 'Enterprise managed authorization via ID-JAG', 43, EMA, EMA_STEPS, 'No per-user consent screens; enterprise-managed runtime policy enforcement.'],
  ['identity-for-ai', 'Identity for AI General Availability', 45, null, IDENTITY_FOR_AI_DIAGRAM.STEPS.map((x) => [x.title, x.what]), 'Protect, Authorize and Privilege, Agent IAM Core, Agent Gateway and Agent Governance, between users, agents and resources.', IDENTITY_FOR_AI_DIAGRAM],
  ['consumer-ref', 'Ref arch: Consumer Agents', 48, CONSUMER_REF, CONSUMER_REF_STEPS, 'MCP interface and CUA interface paths for consumer agents.'],
].map(([id, label, page, config, steps, caption, ping]) => ({ id, label, page, config, steps, caption, ping }));
