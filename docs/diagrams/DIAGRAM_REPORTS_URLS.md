# Diagram reports — URLs to test

Host: `https://local.ping-devops.com:4000` (sign-in only works on this host; every page below is public).
On each page press **Simulate**, then **Pause**, **Next**, **Prev**, **Stop**, **Reset**. The bar shows "Step n of N" and names the arrow in focus; the focused arrow runs as a thick dotted line on every page.
Below the diagram is a movie reel with one card per step. Click a card to jump to that step; its details open in a row under the reel, so the diagram never shrinks.

## Diagrams nav

| Report | URL | What to check |
|---|---|---|
| Demo Steps Lifeline Audit | https://local.ping-devops.com:4000/demo-steps-lifeline-audit | 24-step board; Simulate rings the step and shades its table row |
| Invest Dual-Auth | https://local.ping-devops.com:4000/invest-dual-auth | Sequence with lifelines, two flows side by side, 15 steps |
| Agent Privilege (3 tabs) | https://local.ping-devops.com:4000/privilege-mcp-diagrams | Architecture, Sign-in + Tool Call (28 steps), Auth Flow (27 steps) |
| Agent Privilege Enforcement | https://local.ping-devops.com:4000/privilege-first-gateway | Two figures, the first has 11 steps |
| Gateway vs P1AZ Enforcement | https://local.ping-devops.com:4000/gateway-enforcement-map | 12 steps |
| Resource Server Placement | https://local.ping-devops.com:4000/resource-server-placement | 9 steps |
| Token Chain Architecture | https://local.ping-devops.com:4000/architecture/token-chain | 36 steps |
| System Diagram | https://local.ping-devops.com:4000/architecture/system | Click a focus tab: Frontend & Auth, BFF & Gateways, MCP Servers & Agents, PingOne Cloud. BFF & Gateways is large and fits small, so zoom in |
| Personal Agent design (Agent Gateway only) | https://local.ping-devops.com:4000/personal-agent-design | 15 steps with a write-up per step |
| Personal Agent design (Privilege first) | https://local.ping-devops.com:4000/personal-agent-dual-gateway | 16 steps |
| Personal Agent design review | https://local.ping-devops.com:4000/personal-agent-review | Static on purpose, no Simulate |

## Pages converted off Mermaid

| Report | URL | What to check |
|---|---|---|
| Privilege Gateway Topologies | https://local.ping-devops.com:4000/privilege-gateway-topologies | Three tabs plus a request-flow sequence below |
| MCP Gateway OAuth Flow | https://local.ping-devops.com:4000/mcp-gateway-oauth-flow | Architecture flowchart, then the sequence |
| External Door | https://local.ping-devops.com:4000/external-door-diagrams | Topology (8 steps), then the dual-path sequence |
| DaVinci SDK explainer | https://local.ping-devops.com:4000/davinci-sdk | Client lifecycle sequence partway down |
| Phase 266 architecture | https://local.ping-devops.com:4000/architecture/phase-266 | 24 steps |
| Agent Onboarding (React Flow page) | https://local.ping-devops.com:4000/agent-onboarding-flow-mermaid | 15 steps |

## Pages added to the reel and React Flow

| Report | URL | What to check |
|---|---|---|
| Sequence Diagram | https://local.ping-devops.com:4000/sequence-diagram | Pick a scenario; Simulate, Prev and Next move the highlight; click a reel card to jump. Many participants, so it fits small |
| Agent Onboarding Flow | https://local.ping-devops.com:4000/agent-onboarding-flow | Pick a persona (and an Admin story); each step lights the cards and links it touches |
| Agent Onboarding Subway | https://local.ping-devops.com:4000/agent-onboarding-flow-subway | Same personas as a station line; one station per run of steps |
| Overview | https://local.ping-devops.com:4000/architecture/overview | Pick a scenario and Simulate; the reel appears under the diagram (not in Live mode) |
| Canvas | https://local.ping-devops.com:4000/architecture/canvas | Editable React Flow canvas: drag a box, double-click to rename, drag from a box's right dot to another's left dot to connect, click an arrow then Delete Edge. Pick a flow (AG-UI, NL, HITL) for the Play/Step bar and reel |
| Token Flow | https://local.ping-devops.com:4000/architecture/token-flow | Sequence replaces the old PNG; 15 steps in Full Flow, other scenarios in the dropdown. Click a reel card to open that step's token card |

## Need a signed-in session (only unit-tested so far)

| Report | URL | Where the diagram is |
|---|---|---|
| Protocol Playground | https://local.ping-devops.com:4000/protocol-playground | Pick a protocol; the sequence draws next to the steps, no Simulate bar there. Checked live: all 11 render with arrows; Next Step shows a response code per message |
| DaVinci widget lesson | https://local.ping-devops.com:4000/davinci-widget | "The Flow" section |
| OAuth Visualizer | open from the app (a panel, not a page) | Highlights the arrows for the selected step |
| Token Exchange diagram | the floating token panel in the app | Updates live as a run happens |

## Not converted

None. Every page in this list draws with React Flow.
