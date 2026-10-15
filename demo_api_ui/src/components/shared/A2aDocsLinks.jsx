const BASE = 'https://github.com/cmuir_pingcorp/AI-DEMO2/blob/main/';

// Every A2A doc in the repo, grouped; paths are repo-relative.
export const A2A_DOCS = [
  ['Architecture and use cases', [
    ['A2A architecture (UC2 / UC2.5)', 'docs/A2A_ARCHITECTURE.md'],
    ['UC2: A2A delegation', 'docs/use-cases/a2a-delegation.md'],
    ['UC2.5: A2A orchestrator, interactive learning', 'docs/use-cases/a2a-orchestrator-learning.md'],
    ['UC2.6: A2A generalist mismatch', 'docs/use-cases/a2a-generalist-mismatch.md'],
    ['UC2.7: A2A end to end, protocol and identity', 'docs/use-cases/a2a-protocol-walkthrough.md'],
    ['UC37: Verified Trust, signed agent assertion', 'docs/use-cases/verified-trust-a2a-assertion.md'],
    ['UC46: Privilege A2A access review', 'docs/use-cases/privilege-a2a-access-review.md'],
    ['UC46A: Privilege A2A access review in the agent', 'docs/use-cases/privilege-a2a-access-review-agent.md'],
    ['UC47: Privilege A2A three-deep agent chain', 'docs/use-cases/privilege-a2a-agent-chain.md'],
  ]],
  ['Agent Privilege gateway', [
    ['Agent-to-Agent (A2A)', 'privilege/GATEWAY-AGENT-TO-AGENT-A2A.md'],
    ['A2A auth modes compared', 'privilege/GATEWAY-A2A-AUTH-MODES-COMPARED.md'],
    ['Guardrails for A2A', 'privilege/GATEWAY-GUARDRAILS-FOR-A2A.md'],
    ['A2A guardrails demo runbook', 'privilege/A2A-GUARDRAILS-DEMO.md'],
    ['How to demo and set up A2A', 'privilege/A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT.md'],
    ['Red team: a hostile A2A agent', 'privilege/RED-TEAM-HOSTILE-A2A.md'],
  ]],
  ['Agents', [
    ['Privilege A2A Anthropic demo (main, worker, MCP)', 'standalone/privilege-a2a-anthropic-demo/README.md'],
    ['Direct LangChain A2A access', 'langchain_agent/docs/DIRECT_A2A_OAUTH.md'],
  ]],
];

export default function A2aDocsLinks({ className = '' }) {
  return (
    <div className={className} data-testid="a2a-docs-links">
      <h3>A2A docs</h3>
      {A2A_DOCS.map(([group, docs]) => (
        <div key={group}>
          <h4>{group}</h4>
          <ul>
            {docs.map(([label, path]) => (
              <li key={path}><a href={BASE + path} target="_blank" rel="noreferrer">{label}</a></li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
