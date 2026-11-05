// Pages of the Privilege Map (embedded copy of the standalone privilege-map app's standard UI).
// The feature text lives in data/privilegeFeatures.json, one entry per feature, each on exactly one page.
export const PRIVILEGE_MAP_PAGES = [
  { id: 'identity', title: 'Identity', purpose: 'Who the agents, devices and client apps are, and who is accountable for them.' },
  { id: 'llm', title: 'LLM', purpose: 'How model calls reach providers through the gateway, and what the gateway allows.' },
  { id: 'mcp', title: 'MCP and A2A', purpose: 'How tools and remote agents are reached, and which tools and calls a caller is granted.' },
  { id: 'oversight', title: 'Oversight', purpose: 'Inspection, human decisions, policy-as-code, proof and audit.' },
  { id: 'platform', title: 'Platform', purpose: 'Connections to external secret stores, SaaS platforms and cloud accounts, and enforcement on host workloads and developer machines.' },
];
