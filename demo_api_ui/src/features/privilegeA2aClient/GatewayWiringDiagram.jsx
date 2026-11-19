import './GatewayWiringDiagram.css';

// Four hops, each one through the gateway. The path on each gateway box is the route the hop takes on the gateway.
export const GATEWAY_HOPS = [
  {
    n: 1,
    label: 'Agent to agent',
    title: 'Delegation is authorized',
    body: 'The worker is not directly reachable. The gateway checks the caller\'s scope and inspects the task and the findings returned.',
  },
  {
    n: 2,
    label: 'Main to model',
    title: 'Prompts are governed',
    body: 'Key injection, rate and budget limits, token and cost accounting, and model policy, enforced before the request leaves.',
  },
  {
    n: 3,
    label: 'Worker to model',
    title: 'Metered per agent',
    body: 'Same controls, separate key. Spend, limits, and permitted models are attributed to the worker, not pooled with the main agent.',
  },
  {
    n: 4,
    label: 'Agent to tools',
    title: 'Tool access is scoped',
    body: 'Which tools this agent may call, and inspection of what the tools return, where hostile instructions hide inside data.',
  },
];

function Gateway({ n, path, className = '' }) {
  return (
    <div className={`a2a-wire__node a2a-wire__node--gateway ${className}`.trim()}>
      <span className="a2a-wire__badge" aria-hidden="true">{n}</span>
      <span className="a2a-wire__kicker">AI Gateway</span>
      <span className="a2a-wire__path">{path}</span>
    </div>
  );
}

function Node({ name, sub, mono, className = '', children }) {
  return (
    <div className={`a2a-wire__node ${className}`.trim()}>
      <span className="a2a-wire__name">{name}</span>
      <span className={`a2a-wire__sub${mono ? ' a2a-wire__sub--mono' : ''}`}>{sub}</span>
      {children}
    </div>
  );
}

// An arrow between two boxes. It carries no information the boxes do not, so assistive tech skips it.
function Link({ dir = 'h', tag, dashed = false, className = '' }) {
  return (
    <span className={`a2a-wire__link a2a-wire__link--${dir}${dashed ? ' is-dashed' : ''} ${className}`.trim()} aria-hidden="true">
      {tag && <span className="a2a-wire__tag">{tag}</span>}
    </span>
  );
}

/**
 * How the two agents are wired through the gateway, before a demo runs: the A2A hop, the two model hops and the MCP hop.
 * Pure display, no data: the boxes are the demo's fixed topology (README "How it works through the gateway").
 */
export default function GatewayWiringDiagram() {
  return (
    <figure className="a2a-wire" aria-label="Two agents, four hops, every one through the gateway">
      <figcaption className="a2a-wire__caption">
        The agents hold no provider keys and no policy logic. Each hop they make is intercepted, authenticated,
        inspected, and metered independently.
      </figcaption>

      <div className="a2a-wire__scroll">
        <div className="a2a-wire__grid">
          <Node name="Browser" sub="local only" mono className="a2a-wire__browser" />
          <Link tag="chat" dashed className="a2a-wire__l-chat" />
          <Node name="Main agent" sub="concierge · owns the chat" className="a2a-wire__main">
            <span className="a2a-wire__note">no tools of its own</span>
          </Node>
          <Link tag="A2A" className="a2a-wire__l-a2a-in" />
          <Gateway n={1} path="/analyst-agent/a2a" className="a2a-wire__gw1" />
          <Link className="a2a-wire__l-a2a-out" />
          <Node name="Worker agent" sub="analyst · owns the tools" className="a2a-wire__worker" />
          <Link tag="MCP" className="a2a-wire__l-mcp-in" />
          <Gateway n={4} path="/acme-tools/mcp" className="a2a-wire__gw4" />
          <Link className="a2a-wire__l-mcp-out" />
          <Node name="MCP server" sub="Streamable HTTP" mono className="a2a-wire__mcp" />

          <Link dir="v" tag="LLM" className="a2a-wire__l-main-llm" />
          <Gateway n={2} path="/llm/google" className="a2a-wire__gw2" />
          <Link dir="v" className="a2a-wire__l-main-model" />
          <Node name="Gemini" sub="3.6-flash" mono className="a2a-wire__model-main" />

          <Link dir="v" tag="LLM" className="a2a-wire__l-worker-llm" />
          <Gateway n={3} path="/llm/google" className="a2a-wire__gw3" />
          <Link dir="v" className="a2a-wire__l-worker-model" />
          <Node name="Gemini" sub="3.5-flash-lite" mono className="a2a-wire__model-worker" />

          <aside className="a2a-wire__keys">
            <span className="a2a-wire__kicker">The agents hold no provider keys</span>
            <span className="a2a-wire__sub">
              Each agent presents only its own scoped key. The gateway strips it and injects the real credential on
              egress; it never reaches agent memory.
            </span>
          </aside>
        </div>
      </div>

      <ol className="a2a-wire__hops" aria-label="What the gateway does on each hop">
        {GATEWAY_HOPS.map((hop) => (
          <li key={hop.n} className="a2a-wire__hop">
            <span className="a2a-wire__kicker">Hop {hop.n} · {hop.label}</span>
            <b className="a2a-wire__hop-title">{hop.title}</b>
            <span className="a2a-wire__sub">{hop.body}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
