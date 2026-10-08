// Inline page guides, merged into PAGE_GUIDES (see pageGuides.js).
// Drafted by reading each page's source; steps name the controls that page has.
const steps = (rows) => rows.map(([title, explain, demonstrate]) => ({ title, explain, demonstrate }));

export const MORE_PAGE_GUIDES = {
  "/group-policy": {
    title: "Group Policy Guide",
    talkingPoints: [
      "Scopes are not entitlements: access to a group-gated tool depends on live PingOne directory membership, not on what the token says.",
      "The board shows one real PingOne Authorize decision per vertical, so a single membership change is visible across every vertical at once.",
      "Removing the user from the group denies the very next call with the same token, and adding them back permits it again, with no logout or token expiry.",
    ],
    walkthrough: steps([
      ["Read the board", "Each row is a live decision from the endpoint the policy enforcement point calls, not a value derived from the manifest, so it proves what the policy actually does.", "Sign in first (the page requires it), then read the Decisions table columns Vertical, Group-gated tool, Required group, In group, Decision and Statement, and the permit/deny pills above it."],
      ["Flip the membership", "The Group membership panel writes to the real PingOne directory, and the authorization check re-reads that membership on every group-gated tool call.", "Click the Add to or Remove from button in the Group membership panel (its label names the group) and confirm the result in the dialog that follows."],
      ["Watch every row move", "The board reloads after the toggle, and the Statement column shows which rule answered, so a PERMIT or DENY can be traced to a specific policy statement.", "Compare the permit/deny pill counts and the Decision cells before and after the toggle and press Re-check to reload; a warning appears if membership came from the manifest because PingOne worker credentials are not configured."],
    ]),
  },
  "/agent-guardrails": {
    title: "Agent Guardrails Guide",
    talkingPoints: [
      "The page is a reference diagram of the guardrail chain: human sponsor, agent, Agent IAM Core, Agent Gateway, PingOne Authorize, PingOne Protect and human approval.",
      "Each scenario chip highlights only the cards relevant to one threat story and shows a talk track for it.",
      "It is an education page rather than a live run; a link at the top opens a static web copy of the same diagram.",
    ],
    walkthrough: steps([
      ["Start with the full flow", "The default view shows the whole chain from actors through identity and runtime enforcement to risk and oversight, which sets the picture before any single threat.", "Leave the Full guardrail flow chip selected and read the talk track and the card lanes in the Guardrail flow diagram."],
      ["Pick a threat scenario", "Selecting a scenario highlights the relevant cards and replaces the talk track, so you can answer one question at a time such as shadow agents or over-privilege.", "Click Find agents, OBO (on behalf of), Over-privilege, Risky behavior or Secret exposure and note which cards stay highlighted and what the talk track says."],
      ["Read the legend and share a copy", "The legend separates the normal request path, the allowed-after-policy path and the block, challenge or approval boundary, which shows where enforcement sits.", "Check the legend entries Normal request path, Allowed only after policy checks and Block / challenge / approval boundary, then use the Open the static web copy of this diagram link at the top for a shareable version."],
    ]),
  },
  "/ai-products/core": {
    title: "Agent IAM Core Guide",
    talkingPoints: [
      "Agent IAM Core is the identity layer: each agent is its own OAuth client with its own credentials rather than sharing a human's.",
      "Delegation uses token exchange so the human, the agent and the resulting token stay linked and accountable.",
      "Tokens are short-lived and audience-restricted to a specific resource or service.",
    ],
    walkthrough: steps([
      ["Frame the role", "The Overview section explains why agents need identity and tokens before they can reach any API or resource.", "Read The role it plays section and its hero takeaway, then use the product navigation bar (Agent IAM Core, Agent Gateway, PingOne Authorize and others) to see where this layer sits."],
      ["Walk the capabilities", "Four capability cards cover agent identity, authentication, delegation and scoped tokens, which are the building blocks of the later demos.", "Scroll to What it provides and read the Agent identity, Authentication, Delegation and Scoped tokens cards."],
      ["Run a live example", "The Agent runs section links to real demo pages that show registration and RFC 8693 delegation in action.", "Click the Agent lifecycle card (opens /agent-lifecycle) or Delegated commerce (opens /delegated-commerce); those pages may need sign-in. The How it fits section shows the flow from owner to delegated token."],
    ]),
  },
  "/ai-products/gateway": {
    title: "Agent Gateway Guide",
    talkingPoints: [
      "Agent Gateway is the runtime enforcement point between an agent and the APIs, tools and MCP servers it can reach.",
      "It validates the delegated token, audience, scopes and delegation chain before forwarding any request.",
      "Every decision and enforcement path is recorded so a team can explain what happened on each request.",
    ],
    walkthrough: steps([
      ["See what it enforces", "The capability cards show that the gateway checks identity, protects MCP discovery and tool calls, enforces consistently and creates evidence.", "Scroll to What it enforces and read the Validate identity, Protect MCP traffic, Enforce consistently and Create evidence cards."],
      ["Trace the request path", "The flow strip shows the order of the checks, which is where identity becomes an enforceable runtime decision.", "Read the Request path section's flow (Agent, Agent Gateway, Policy decision, Protected API or MCP server) and the Architecture note below it."],
      ["Run a permit and a deny", "Two agent runs show the same boundary allowing an in-scope call and stopping an out-of-scope one.", "Open Weather MCP - permit (/weather-mcp), Gateway inspector (/agent-gateway-inspector) or Gateway deny (/use-cases/live) from the Agent runs section; some of these need sign-in."],
    ]),
  },
  "/ai-products/authorize": {
    title: "PingOne Authorize Guide",
    talkingPoints: [
      "Authentication says who is calling; PingOne Authorize decides what that caller may do in context.",
      "The policy sees the agent, the user, the resource and the action, so delegation stays bounded by user intent.",
      "A decision can be permit, deny, or a step-up requirement when the action needs stronger assurance.",
    ],
    walkthrough: steps([
      ["Separate who from what", "The page positions Authorize as the policy decision point kept outside the agent, so business rules are not hard-coded in the application.", "Read the Overview lede and the Contextual decisions, Tool and resource controls, Bounded delegation and Step-up and obligations cards."],
      ["Follow the decision path", "The flow shows the agent request passing through the gateway to Authorize, which returns permit, deny or step-up.", "Read the Decision path flow (Agent request, Agent Gateway, PingOne Authorize, Permit, deny, or step-up)."],
      ["Evaluate a real decision", "The linked runs call live PingOne Authorize policy, which shows the decisions are not canned.", "Open Policy console (/pingone-authorize), Denied transfer (/use-cases/live) or Intent binding (/intent-binding-learning); some of these may need sign-in."],
    ]),
  },
  "/ai-products/protect": {
    title: "PingOne Protect Guide",
    talkingPoints: [
      "PingOne Protect scores risk; this page evaluates browser risk on its own and does not change sign-in or agent flows.",
      "The Signals SDK collects browser context, and the BFF calls Protect so the Worker token never reaches the browser.",
      "The response shows the risk level, the recommended action and bot-detection details when available.",
    ],
    walkthrough: steps([
      ["Understand what is collected", "The capability cards explain that Signals are gathered only when you run the demo and sent to the BFF, not directly to Protect.", "Read the Risk signals section cards: Collect browser Signals, Evaluate browser risk, Inspect the response and Keep credentials server-side."],
      ["Run an evaluation", "Running the form sends the Signals payload through the BFF to PingOne Protect and returns a live evaluation.", "In Run the demo (the Evaluate browser risk panel), type a value into Username or email to evaluate and click Run PingOne Protect evaluation; this needs PingOne Protect configured on the BFF."],
      ["Read the response", "The result shows how Protect rated this browser and what it recommends, which is the input a policy would act on.", "Read Protect evaluation response (Risk level, Recommended action, and Bot detection level, status or Detected rule if shown), then click Run another evaluation or Open demo pop-out."],
    ]),
  },
  "/ai-products/privilege-llm": {
    title: "Privilege LLM Protection Guide",
    talkingPoints: [
      "An LLM can be steered by untrusted instructions or sensitive context, so the model interaction is treated as a security boundary.",
      "Privilege for AI sits between the model interaction and the business system, and can allow, block or route a response for review.",
      "The model request stays linked to the user, agent and session, and the control leaves an audit trail.",
    ],
    walkthrough: steps([
      ["Name the LLM risks", "The capability cards describe what Privilege inspects and controls, which frames why the model output cannot be trusted as instructions.", "Read the LLM risks section cards: Inspect the conversation, Control the outcome, Keep identity in view and Support auditability."],
      ["Block a prompt injection", "A known override attack is stopped by Privilege before it reaches the model, which shows the control working.", "Click the Prompt injection blocked run (opens /llm-gateway?attack=prompt_injection); this needs the LLM Gateway and a Privilege virtual key configured."],
      ["Compare routed and direct requests", "Sending the same request with and without Privilege shows what the control adds to the verdict.", "Open LLM Gateway (/llm-gateway) to send a request through a Privilege virtual key and inspect the verdict, or LLM request tester (/llm-test) to compare direct and Privilege-routed requests."],
    ]),
  },
  "/ai-products/privilege-a2a": {
    title: "Privilege A2A Protection Guide",
    talkingPoints: [
      "When one agent asks another to act, the handoff needs a clear caller, an accountable target and bounded authority.",
      "Each agent calls through the Privilege AI Gateway with its own agent key, and the gateway checks the key, its a2a scope and the policy for that remote agent.",
      "The gateway guardrail blocks prompt injection between agents and redacts personal data or hidden instructions in tool results.",
    ],
    walkthrough: steps([
      ["See why A2A needs control", "The capability cards cover recognizing the agent, protecting the handoff, limiting authority, screening what crosses and recording the chain.", "Read the Why A2A needs control cards, including Protect the handoff, Limit authority and Screen what crosses."],
      ["Run the gateway-mediated chain", "The runs show a main agent, worker agent and MCP tools with every hop going through the Privilege AI Gateway, including a refused handoff.", "Click A2A access review through the gateway (/privilege-mcp-client?view=demo&tab=a2a) or Three-deep agent chain (/dashboard, Demo Step 26); these need the Privilege gateway deployed and may need sign-in."],
      ["Go deeper on architecture and protocol", "Separate pages show where the gateway sits and how the Agent2Agent protocol and nested delegation actually work.", "Open Agent-to-agent architecture (/privilege-gateway-topologies), A2A protocol walkthrough (/a2a-protocol-learning) or Delegation chain (/delegation-chain-value) from the Agent runs section."],
    ]),
  },
  "/ai-products/privilege-mcp": {
    title: "PingOne Privilege MCP Guide",
    talkingPoints: [
      "MCP lets agents discover tools and reach data, so the same discoverability widens the blast radius of a poisoned description or an over-privileged token.",
      "Protection belongs at the MCP boundary: control what the agent discovers (tools/list) and what it invokes (the tool, arguments, identity and policy).",
      "This page is an explainer with links to live runs; it does not execute anything itself.",
    ],
    walkthrough: steps([
      ["Read the role it plays", "The overview frames MCP as a real application boundary and states the takeaway the rest of the page supports.", "Read the Overview section and the Ping for AI panel under 'The role it plays'."],
      ["Walk the four capabilities", "Protect discovery, Protect invocation, Stop unsafe actions and Leave evidence are the four controls a gateway adds in front of an MCP server.", "Open the MCP risks section and read the four numbered cards (01 to 04)."],
      ["Open a live agent run", "The Agent runs section links to the real demos that show these controls working; some may need sign-in.", "Under Agent runs, click the Privilege MCP client, MCP protection guide or Gateway scope deny card, then use the Protection path section to explain the flow: Agent, MCP discovery, Privilege control, Allowed tool call."],
    ]),
  },
  "/agent-gateway-capabilities": {
    title: "Agent Gateway Capabilities Guide",
    talkingPoints: [
      "The page is a tool tester for the MCP gateway in two-step mode: every tool call is first authorized, then executed only if the decision is PERMIT.",
      "The same call can be pointed at the demo (Node) gateway or the PingOne gateway, and at simulated or real authorization, using top-bar toggles.",
      "Output tabs show the result, audit trail, authorize decision and McpAudit (5W1H) so you can explain why a call was allowed or blocked.",
    ],
    walkthrough: steps([
      ["Pick a tool and see the backend", "The left tree lists the gateway's tools and the top bar shows which gateway and authorization backend are active, which decides what the call really exercises.", "Select a tool in the tree, then use the Switch to PingOne GW / Demo GW and Authz: simulated / real buttons in the top bar (real authorization needs PingOne Authorize); Refresh reloads state."],
      ["Authorize then execute", "In two-step mode the page calls the authorization endpoint first and only calls the gateway if the decision is PERMIT, so an out-of-policy call never reaches the tool.", "Edit the JSON arguments (for example set an amount) and click 'Authorize then execute'; if denied, the response shows 'MCP execution blocked' and the Authorize Decision tab opens."],
      ["Inspect and stress the gateway", "The output tabs and presets show the audit evidence and the throttling behaviour of the gateway.", "Switch between the Result, Audit Trail, Authorize Decision and McpAudit (5W1H) tabs; try the Demo Presets (UC18 throttling), 'Burst test (5 calls)' after enabling UC18, or 'Run chain (accounts, balance, sensitive)'."],
    ]),
  },
  "/pingone-authorize-capabilities": {
    title: "PingOne Authorize Capabilities Guide",
    talkingPoints: [
      "PingOne Authorize makes a live PERMIT, DENY or INDETERMINATE decision per transaction or tool call rather than assuming access.",
      "Each card on the page names one real behaviour of the integration plus the file and function that implements it, so every claim is checkable.",
      "The page is a read-only capability audit; it does not call PingOne Authorize itself.",
    ],
    walkthrough: steps([
      ["Read the intro", "The intro explains that the cards are an audit of what the repo actually implements, not marketing, and how the three groups relate.", "Read the header paragraph under 'PingOne Authorize'; the dark/light toggle button in the header changes the page theme."],
      ["Walk the three groups", "Real-time contextual decisions is how a decision is made, fine-grained attribute-driven policy is what it is based on, and operations and audit is how it is inspected afterwards.", "Scroll through the headings 'Real-time, contextual decisions', 'Fine-grained, attribute-driven policy' and 'Operations & audit' and open the first card, 'Real-time decision evaluation'."],
      ["Prove a claim from source", "Each card shows the source file and line range behind it, which lets you back a statement with code instead of slides.", "Pick any card and read its one-liner and the code reference line beneath it, then jump to a live page such as the Agent Gateway capabilities page to show it running."],
    ]),
  },
  "/agentic-trust": {
    title: "Agentic Trust Guide",
    talkingPoints: [
      "Security has to be validated at every hop of the chain User, Chat/BFF, Agent, MCP Server, Banking Tool.",
      "Six pillars each map a named threat to how this demo addresses it, and the page marks five as strong and Last Mile Vault as concept only.",
      "A scope-narrowing visualization and a threat model table show least privilege and residual gaps honestly.",
    ],
    walkthrough: steps([
      ["Follow the trust chain", "The flow diagram labels the security mechanism on each connection: OAuth Login (PKCE), Agent Identity (Client Creds), Token Exchange (RFC 8693) and Vault Credentials (Last Mile).", "Point along the diagram under 'The Agentic Trust Chain'; the link 'Watch the Agentic Trust presentation' opens a video."],
      ["Open the pillars", "Each pillar card expands to show the threat, how the demo addresses it and any gap, so you can be explicit about what is real and what is planned.", "Click a card under 'The 6 Security Pillars' (for example Impersonation Prevention) to expand it, then use its link such as 'See Token Flow Diagram' or 'See Token Chain'; open Last Mile Vault to show the Gap note."],
      ["Show narrowing and the threat model", "Scopes shrink at each exchange hop, and the summary table lists every threat with its category, mitigation and status.", "Use the visualization under 'Scope Narrowing in Action', then read the 'Threat Model Summary' table, where Last Mile Exposure is marked Planned."],
    ]),
  },
  "/iga-for-ai": {
    title: "IGA for AI Guide",
    talkingPoints: [
      "One inventory lists every agent and MCP however it was onboarded, through Agent Studio or Discovery.",
      "Each agent has an owner, a source and a lifecycle status, and governed agents can be certified.",
      "This is a simulated preview backed by an in-browser mock store, not a live PingOne IGA call.",
    ],
    walkthrough: steps([
      ["Note it is a preview", "A banner states that no real backend calls are made, so set that expectation before demonstrating.", "Read the 'Simulated preview' banner at the top; the 'See Platform Gaps' link and the Dark mode / Light mode button are in the same row."],
      ["Read the inventory counts", "The four counters summarize governance coverage at a glance.", "Point at Total agents, Governed, Pending review and From discovery. If the list is empty, the page says to complete a flow in Agent Studio or approve a discovery first."],
      ["Certify a governed agent", "Certification is the periodic review step of identity governance, applied here to an AI agent.", "On a row whose badge reads governed, click Certify and watch the badge, the 'certified <date>' text and the Governed count update."],
    ]),
  },
  "/transaction-consent": {
    title: "Transaction Consent Guide",
    talkingPoints: [
      "High-value or agent-initiated transactions can require explicit human approval through a CIBA push notification.",
      "The real flow opens this page from a deep link with a ?challenge= id; without one the page runs in simulate mode.",
      "Sign-in is required: signed-out visitors see a sign-in prompt.",
    ],
    walkthrough: steps([
      ["Sign in and read the flow", "The simulate landing explains how production works: a step-up obligation from PingOne Authorize, a CIBA push, then approval on the user's device.", "Sign in, then read 'How it works in production' and the numbered 'CIBA Consent Flow' list."],
      ["Pick a scenario", "Preset transactions let you show the consent modal without waiting for a live push.", "Under 'Pick a scenario to simulate', click Standard Transfer ($500), High-Value Transfer ($15,000), ATM Withdrawal ($200) or AI Agent-Initiated ($2,500)."],
      ["Approve or decline in the modal", "The modal shows the transaction snapshot and asks for verification before the transaction proceeds or is blocked.", "Review the details in the consent modal and follow its prompts to approve or decline; closing it returns you to the scenario list."],
    ]),
  },
  "/actor-token-education": {
    title: "Actor Token Education Guide",
    talkingPoints: [
      "An actor (agent) token carries the user as sub and the agent as an act claim, with a narrowed scope.",
      "Delegation is limited to the permissions granted, and revocation takes effect at the authorization server.",
      "A live trace rail at the bottom shows the real token chain as the agent acts.",
    ],
    walkthrough: steps([
      ["Follow the four-step diagram", "The diagram shows login, agent request, token exchange and the resulting actor token with sub, act and scope.", "Read 'How Token Delegation Works', steps 1 to 4, and the three keys sub, act and scope listed below it."],
      ["Answer common questions", "The FAQ covers what an actor token is, how it differs from a normal token, access limits, auditing and revocation.", "Click a question under 'Frequently Asked Questions', such as 'Can the agent access more than I permit?', to expand its answer."],
      ["Watch it live", "The trace rail updates when an agent action runs, so the audience sees the act claim build up on real tokens.", "Go to the dashboard, ask the agent something like 'Check my balance' (needs sign-in), then return to the 'Live Actor Token Flow' panel to see the exchange."],
    ]),
  },
  "/jev-learning": {
    title: "Jev Learning Guide",
    talkingPoints: [
      "Jev is a 'System One' decision model: you send it text and a typed question, and it returns a choice, a score or a yes/no probability instead of prose.",
      "The page runs the same input through fixed keyword rules and through Jev, so the audience can see where rules miss rewording and where the model is unsure.",
      "A model score is one input to policy, not a verdict: the threshold sliders show the same score flipping between Allow, Step-up and Deny.",
    ],
    walkthrough: steps([
      ["Frame System One vs System Two", "The first card compares a fast typed decision model with a generative LLM. The speed and cost rows are TypeSafe's published claims, not measurements from this demo, so say that out loud.", "Point at the 'System One vs System Two' table (columns 'System One (Jev)' and 'System Two (generative LLM)') and read the footnote about published claims."],
      ["Run both deciders on the same text", "The 'Same input, two deciders' card runs the keyword rules and Jev side by side. Jev's column carries a badge: Live, Recorded, or 'Simulated - not configured'. If it shows Simulated, the server has no OPENROUTER_API_KEY or JEV_ENDPOINT and both columns are the same rules, so do not present it as Jev. The page works signed out but needs the BFF reachable. This is demo step UC-LEARN15 (Controls & Policy group) in the Demo Steps menu.", "Pick a tab (Prompt injection, Intent routing or Step-up risk), click an example chip or edit the 'Text to judge' box, press Decide, then compare the 'Keyword rules' and 'Jev' columns. Try a reworded attack and a harmless sentence that contains a trigger word."],
      ["Show that confidence is not permission, then the bake-offs", "Run the Step-up risk example first so the sliders load a real score. Dragging the lines flips the outcome for one fixed score. The two bake-offs score eight hand-labelled messages each; they are a teaching illustration, not a benchmark.", "In 'Confidence is not permission' drag 'Jev P(yes risky)', 'Step-up at' and 'Deny at' and watch the Allow / Step-up / Deny rows highlight. Then press 'Run bake-off' and 'Run intent bake-off' and read the 'What this shows' notes."],
      ["Close with the LangChain panel", "'The same lesson through LangChain' sends the identical question through LangChain's OpenAIDecisions client (beta) in the agent container, translated onto the same Von model, and shows the token counts the direct path cannot. Same question in, same probability out: the framework is plumbing, not a second opinion. The LangChain column reads 'Simulated - not configured' unless JEV_LC_ENDPOINT points at the local Von container.", "Pick a scenario chip, press Decide in the LangChain panel, and read the 'LangChain' column next to the same keyword baseline. Point at the 'prompt · completion' token line, then contrast the latency line with the direct panel above."],
    ]),
  },
  "/intent-binding-learning": {
    title: "Intent Binding Guide",
    talkingPoints: [
      "An agent's declared intent (here: pay acme-utilities up to $100) is pushed to PingOne once via PAR (RFC 9126) and later referenced by request_uri, so the amount cannot silently grow.",
      "The two columns run the same pipeline: $80 stays inside the cap and is permitted, $500 drifts past it and is denied at step 4.",
      "The Reel under each result replays the exact request, response and decision frames of that run, so the audience sees the real exchange, not a diagram.",
    ],
    walkthrough: steps([
      ["Walk the four-step pipeline and the grant", "The header band explains that every agent transfer runs this pipeline. The static strip and flow diagram name the four hops, and the grant card shows the payload that gets pushed.", "Point at the four 'Step 1' to 'Step 4' cards (Declare intent, Push to PAR endpoint, Receive request_uri, Token exchange with request_uri), the 'RAR authorization_details (RFC 9396), pushed via PAR (RFC 9126)' JSON, and the 'PAR + RAR flow through the system' diagram."],
      ["Run Permit and Drift side by side", "'Within the grant' defaults to $80 and 'Drifts past the grant' to $500, against the $100 cap, and each Amount field is editable. Signed out, pressing Run shows a sign-in strip instead of a result, so sign in first.", "Press Run in the 'Within the grant' column and read the PERMIT line, then Run in 'Drifts past the grant' and read DENY with its error code. Change an Amount and re-run to move the line."],
      ["Replay the reel and choose live or simulated", "After a run, a Reel plays frames: Request, Response, Decision. A simulated run shows only Request and Response because nothing goes to PingOne. 'Live mode' is on by default and routes the decision through real PingOne Authorize; turn it off to use the simulated engine. Live runs need the AI Agent Actor client id and secret plus the PingOne environment id configured on the BFF (they are set in this stack); without them the run returns a 'PAR Configuration Missing' error. The run endpoint is disabled in production builds.", "Use Prev / Pause / Play / Next or the chip strip under 'Reel' to step through frames. Tick or untick the Live mode checkbox, and open the 'PAR education panel' or 'RAR education panel' links for the standards background. Run it live once before presenting to confirm the PERMIT and DENY outcomes in your environment."],
    ]),
  },
  "/privilege-mcp-learning": {
    title: "AI Agent Gateway Guide",
    talkingPoints: [
      "This is a reference guide for the Privilege AI Agent Gateway: the agent gets exactly the tools the person is allowed, for as long as allowed, and never holds a backend credential.",
      "The 'How to Demo (Business Value)' section is the presenter script: a buyer-value table and a roughly 5-minute demo script run from the Privilege MCP Client page.",
      "The remaining sections (Architecture, Installation, Configuration, Console Setup, Policies, Troubleshooting, Reference) are setup and support material to use when asked, not to read through.",
    ],
    walkthrough: steps([
      ["Open with Overview and the A2A note", "Overview separates AI Agent Gateway (access governance, near the client) from PingOne Agent Gateway MCP Security Gateway (token mediation, near the backend), states what this demo runs today, and notes that the gateway fronts agents as well as MCP servers.", "Click 'Overview' in the left section nav. Point at the callout 'Privilege vs PingOne Agent Gateway - when to use which', the 'What this demo runs today' list, and the 'Agent-to-agent (A2A)' list with its links to the gateway client and Privilege Gateway Topologies."],
      ["Use 'How to Demo' as the script", "This is the section to present from. The table maps each business value to what to show and the proof on screen; the ordered demo script runs on the Privilege MCP Client page, not on this page. It needs the Privilege gateway reachable, a PingOne sign-in and a policy that has not expired.", "Click 'How to Demo' in the left nav. Show the 'What the buyer cares about' table, then the 'Demo script (about 5 minutes)' list, and use 'Back to Privilege MCP Client' to open the client."],
      ["Use the reference sections when asked", "The left nav scrolls to each section and its width can be dragged. Installation walks four steps (create the OIDC app, get a single-use enrollment token, install the Helm chart, check the log for LinkStatus:Active). Configuration lists the network ports, the chart values that matter and the Helm upgrade rules. Console Setup covers registering an MCP server (on /mcp, not /sse) and tool discovery. Policies lists what a policy can do and the behaviour the console does not tell you: a new app denies everything, policies add up, policies expire, and the client only ever sees 403. Troubleshooting is a symptom, cause and fix table, and Reference holds the key identifiers. They name the demo's own cluster, namespace and tenant, so check them against the live environment before quoting.", "Click Installation, Configuration, Console Setup, Policies, Troubleshooting and Reference in turn in the left nav. For a denial, go to Policies > 'Reading a denial' for the gateway log lines; for a failing client, find its row in Troubleshooting. Drag the 'Resize section navigation' handle to widen the nav, and use the copy button on any code block to copy a command."],
    ]),
  },
  "/oauth-academy": {
    title: "OAuth Academy Guide",
    talkingPoints: [
      "OAuth Academy is a chat with a teacher agent for OAuth 2.0 / 2.1 and OIDC. Every message is pinned to the oauth-teaching vertical, so it works on any session vertical.",
      "The starter chips are the guided curriculum: concept explanations first, then 'demonstrate a real token exchange' and 'demonstrate hitl approval' run real flows.",
      "The 'Live Token Flow' rail under the chat shows the token hops each time the agent runs a demonstration.",
    ],
    walkthrough: steps([
      ["Start from a starter chip", "The empty page shows a hero and a row of chips. Concept chips (for example 'what is oauth', 'explain scopes and least privilege') are meant to answer quickly, while free text that does not match goes to the LLM and can be slower.", "Click the chip 'what is the authorization code flow with pkce', then 'what is the difference between an id token and an access token'. Or type in the 'Ask about OAuth, OIDC, scopes, token exchange...' box and press Enter. Use Stop while it runs and Clear to reset."],
      ["Run a real token exchange and watch the rail", "The 'demonstrate' chips call real backends. Signed out, the agent replies 'Please sign in first' with a Sign in button, so sign in before presenting. The token events from the run populate the 'Live Token Flow' rail.", "Click 'demonstrate a real token exchange', then scroll to the 'Live Token Flow' section and expand the hops. Click 'how does token exchange work (rfc 8693)' and 'what is act and may_act delegation' to explain what the rail shows."],
      ["Show human-in-the-loop approval", "'demonstrate hitl approval' attempts an over-threshold transfer, which raises an approval challenge. Approving records a receipt and the page retries; dismissing cancels with no money moved. It needs sign-in and the HITL service running.", "Click the chip 'demonstrate hitl approval', approve in the consent modal that opens, and read the retry reply. Run it again and dismiss to show the 'Approval cancelled' message."],
    ]),
  },
  "/learning": {
    title: "Learning Hub Guide",
    talkingPoints: [
      "The Learning Hub is the index of every teaching topic in the demo, grouped into categories, each card tagged with a status such as LIVE, LIVE / CONFIG, SIMULATED or REFERENCE.",
      "The 'Recommended path' is a four-stop customer story across live surfaces: Agent Gateway Authorization, token flow inspection, Authorize decisions, then transaction trace.",
      "Use search and the two ask boxes to jump straight to the topic a customer asks about, rather than browsing.",
    ],
    walkthrough: steps([
      ["Start with the Academy entry and Recommended path", "Both blocks show only while search is empty. 'AI Security Academy' offers the guided journey and the standalone demos, and 'Recommended path' is the four-card story to run in order.", "Click 'Start guided journey' or 'Open standalone demos'. Then in 'Secure one agent action from identity to evidence' use the card links: 'Run Agent Gateway Authorization', 'Inspect token flow', 'Test Authorize decisions', 'Open transaction trace'."],
      ["Find a topic: search, ask and document search", "The search box filters cards by name, description, status and keywords and shows a 'Found x of y topics' count. 'Ask the Learning Hub' returns an agent summary with sources, and 'Search source documents' retrieves cited passages. Those two panels depend on backend search or RAG services; if they error, fall back to search and the cards.", "Type in 'Search topics, keywords, standards...' (try 'PKCE' or 'RFC 8693'). In 'Ask the Learning Hub' use 'Ask agent' or a prompt from the 'Prompt library'. In 'Search source documents' press 'Search documents' or 'Answer with sources'."],
      ["Open a topic card and show the live token chain", "Cards are grouped as Getting Started, OAuth & Identity, MCP & Agents, Ping AI Products, Standards & Architecture, Project Reference, AI Ecosystem and Special Topics. Each card opens an education panel or navigates to a page, and the 'Live Token Chain Demo' at the bottom updates as you use the agent elsewhere.", "Click 'Token Exchange (RFC 8693)' under OAuth & Identity to open its panel, and 'Jev: Decision Model' under MCP & Agents to navigate. Scroll to 'Live Token Chain Demo'."],
    ]),
  },
  "/academy/demos": {
    title: "Standalone Demo Launcher Guide",
    talkingPoints: [
      "Each card is a short customer story you can run on its own, without the full guided journey.",
      "The card tells you up front whether live prerequisites are available and which fallback you would be showing if not, so you do not present a simulation as live.",
      "'Check evidence' runs a read-only observation and 'Reset' clears only the launcher's captured state, not the tenant.",
    ],
    walkthrough: steps([
      ["Check readiness before picking a demo", "The tenant readiness strip at the top reports which dependencies (for example PingOne and MCP) are available and refreshes about every 30 seconds. A card whose dependencies are not all available shows UNAVAILABLE and names the declared fallback.", "Point at the 'Tenant readiness' strip, then the availability label on each card and its 'Prerequisites' list. Use 'Return to guided journey' or 'Learning hub' in the top links to leave."],
      ["Filter and choose a story", "The filter row starts at 'All demos' and adds one button per lesson category, and the count line shows how many demos are visible. The stories include Delegated access, Multi-party delegation, Healthcare caregiver delegation, Authorize denial, CIBA and approval, Agent revocation, MCP discovery, Replay defense, Prompt-injection defense, Privilege MCP, DaVinci orchestration and Observability.", "Click a category button in 'Demo categories' and read 'Showing x of y demos'. On a card, read 'Customer outcome', 'Reset behavior' and 'Fallback behavior'."],
      ["Launch, check evidence, reset", "'Launch demo' opens the live surface and 'Explain this' opens the lesson. 'Check evidence' is read-only and is disabled when the card is unavailable or has no evidence check connected. Each demo's own surface may need sign-in or its own backend.", "Click 'Launch demo' on 'Delegated access', then come back and press 'Check evidence' and read the status line. Press 'Reset' and read 'Reset ready. Tenant state unchanged.'"],
    ]),
  },
  "/davinci-widget": {
    title: "DaVinci Widget Guide",
    talkingPoints: [
      "The page runs a live PingOne DaVinci journey inside the app and records every call it makes, so the audience can watch the flow instead of being told about it.",
      "The page lists the flow's three paths (Sign in, Register, Recover) and tells you to choose one on the first DaVinci screen; those screens are served by the DaVinci flow itself, and the Call Inspector shows each hop as it happens.",
      "The lesson sections below the widget explain how it is wired (pi.flow, the API calls, the final node, tokens to session) and what the code does.",
    ],
    walkthrough: steps([
      ["Run the live flow in 'Try It Live'", "It needs PingOne selected as the login provider (a guard asks you to switch if PingFederate is selected) and a working DaVinci flow. The page is public, so no app sign-in is needed first.", "Read 'Paths in this DaVinci flow' (01 Sign in, 02 Register, 03 Recover), then in 'Live DaVinci flow' work through the embedded widget and choose a path on its first screen (its wording comes from the DaVinci flow, not this page). 'Open pop-out' runs the same flow in a separate window, which your browser may block. Complete a sign-in to see 'Signed in as ...' appear."],
      ["Read the Call Inspector alongside the widget", "Every call the journey makes is appended to the Call Inspector, with a running count that resets when you start a new run. This is the main teaching view: it shows the SDK token, the screen submits and the final session call.", "Point at 'Call Inspector' and the call counter while you step through screens. Open individual calls to show request and response shapes."],
      ["Close with 'What just happened' and the lesson sections", "After sign-in, 'What just happened?' opens a summary of the run with links into the lesson. The section nav on the left covers Overview, How It's Wired, pi.flow, How It Works, API Calls, The Flow, The Final Node, Tokens to Session, Security, Troubleshooting and In This Repo.", "Click 'What just happened?' after sign-in, then use its links to jump to a section. Open 'API Calls' to show the numbered calls, and 'Tokens to Session' for the session call."],
    ]),
  },
  "/a2a-protocol-learning": {
    title: "A2A Protocol Guide",
    extra: "a2a-reference",
    talkingPoints: [
      "Two things are called A2A here: the Linux Foundation wire protocol (Agent Card plus bearer-gated JSON-RPC) and the RFC 8693 nested-act identity chain, and they use different credentials.",
      "The Agent Card is public capability metadata that grants no authority, while the endpoint it advertises refuses a call with no bearer.",
      "The handoff carries the user-bound Exchange #1 token, and the specialist performs Exchange #2 for the downstream tool token itself, so the final act chain reads specialist, then generalist, with the user still as sub.",
    ],
    walkthrough: steps([
      ["Separate the two meanings of A2A", "Most confusion about agent-to-agent comes from using one name for both the identity chain and the wire protocol, so set that straight before showing any evidence.", "Read section 1, 'Two different things are called A2A', and contrast the 'Identity - RFC 8693 delegation' card with the 'Wire protocol - Linux Foundation A2A' card. Choose a vertical in the 'Specialist agent' dropdown at the top; it applies to the Agent Card and 401 sections that follow. No sign-in needed."],
      ["Prove discovery is public and the endpoint is gated", "The Agent Card tells any caller what the specialist can do, but the JSON-RPC endpoint still demands a PingOne bearer.", "In section 2, 'Layer 2 - discovery: the Agent Card', point to the 'live' badge and the Agent, Skills, Security and Binding facts. Then in section 3, 'Layer 2 - the bearer gate, proven', click 'Send without a bearer' and show the HTTP 401 pane. Both work signed out but need the BFF running."],
      ["Run the delegation and read both layers", "A live run mints the real PingOne tokens and shows how scope narrows and act nests, then shows the separate wire hop that carried the Exchange #1 bearer.", "Sign in as a customer, go to section 4, 'Layer 1 - run the delegation', and click 'Run the delegation' (signed out you get a sign-in prompt and a recorded run). Then read section 5, 'Layer 1 - the token chain, hop by hop', section 6, 'Layer 2 - the handoff on the wire', and close on section 7, 'What this page is not'. A live run needs the PingOne-backed BFF and the A2A specialist services."],
    ]),
  },
  "/pingfederate-ai-agent": {
    title: "PingFederate AI Agent Guide",
    talkingPoints: [
      "This page exercises three PingFederate paths: CIMD client metadata, third-party token exchange through an ID-JAG, and rich authorization requests (RAR) over PAR.",
      "Tokens stay in the BFF or PingFederate; the browser only receives status and safe details.",
      "A comparison table separates what PingOne Agent IAM Core does from what this PingFederate path does.",
    ],
    walkthrough: steps([
      ["Check session and readiness", "Each flow is enabled only when PingFederate is configured, and the exchange needs a signed-in session as its subject.", "Read the Current session panel and the Ready / Not configured badges for Client metadata, Third-party exchange and Rich authorization, and the provider comparison table for context."],
      ["Run the third-party token exchange", "PingFederate issues an audience-bound ID-JAG and a downstream authorization server redeems it for its own access token, two explicit hops.", "Click 'Run third-party token exchange' and read the Exchange completed result (Subject, PF issuer, ID-JAG audience, Downstream resource, Granted scope)."],
      ["Run allowed and denied RAR requests", "The banking_transaction authorization detail goes through PAR and PingFederate's custom policy permits or denies it.", "Confirm the PF user key field, optionally tick the DPoP checkbox if shown, click 'Run allowed RAR request' then 'Run out-of-policy RAR request' and compare the status banner (PF accepted / PF denied the RAR request); 'Start CIMD authorization' runs the client-metadata flow."],
    ]),
  },
  "/use-cases": {
    title: "Use Cases Guide",
    talkingPoints: [
      "The launcher groups the security use cases by demo track, so a presenter can pick a scenario by buyer story instead of hunting through the agent.",
      "Each card pairs a buyer story, the exact prompt to say and the Ping products involved, so every run is repeatable.",
      "Run fires the scenario in the agent, and cards that need a feature flag show a flag gate and auto-enable the flag on Run.",
    ],
    walkthrough: steps([
      ["Find a scenario", "The page lists every use case by track under the heading AI Agent Security Use Cases. It needs a signed-in user and the use-case launcher flag, otherwise it redirects home.", "Type a title, id or prompt fragment into the Search use cases box, then switch the Vertical pills to the vertical you are presenting (Super Sports by default)."],
      ["Read the card before you run it", "Each card shows its id, title, buyer story, Ping product chips and a What to say prompt, so the audience hears the business problem before the mechanics.", "Click Copy next to What to say, or click Explain on a card to open its explanation."],
      ["Run it and track progress", "Run launches the scenario in the agent (chip cards), runs an attack simulation, or opens a linked panel, and completed cards get a check mark for this session.", "Click Run on a card, then use Clear progress for a fresh pass or Stop Agent to revoke the agent's token at PingOne."],
    ]),
  },
  "/demo-track": {
    title: "Guided Demo Track Guide",
    talkingPoints: [
      "The Guided Demo Track is two acts of steps where every step ends with a permit and a deny, so each governance claim is shown both ways.",
      "Act 1 covers the customer agent and Act 2 shows the same rails governing the admin agents.",
      "Each step records a PROVED stamp with decision evidence, and the finished page can be printed as a leave-behind.",
    ],
    walkthrough: steps([
      ["Start a clean run", "Progress is stored per run, so starting fresh gives you empty stamps and a clean story.", "Click Start new run in the top bar, and use the Run dropdown to switch between the Live run and a past run (history is read-only)."],
      ["Open a step and run permit and deny", "Each step shows a buyer story with a GREEN (permit) and a RED (deny) row that dispatch a real agent prompt, with the needed feature flags armed best-effort on an admin-gated route.", "Click a step header, then use the run button on its GREEN row and on its RED row and read the agent reply and the reason shown under each."],
      ["Close with the gauntlet and takeaway", "A completed step shows WHAT THIS PROVED with a SAY THIS line, and the attack-gauntlet step runs all the attack simulations and counts how many were blocked.", "Open the attack-gauntlet step, click Run all 6 attacks, watch the tiles turn BLOCKED and the score update, then use the Dark mode toggle if the room needs it."],
    ]),
  },
  "/agent-builder": {
    title: "Agent Builder Guide",
    talkingPoints: [
      "An AI agent gets its own PingOne application and client ID, so its actions are never confused with the human's.",
      "Scopes are granted per resource server, which makes the agent's permissions explicit and reviewable.",
      "The page creates real PingOne objects through the BFF, so the worker token never reaches the browser.",
    ],
    walkthrough: steps([
      ["Build the agent identity", "The page needs a signed-in user and shows the chain You, Your AI Agent, Resources and scopes, with the agent created as a real PingOne application.", "In the Your AI Agent card click Build my Agent, then read the Client ID, Type, Grant types and Token auth rows (use Upgrade to AI Agent if it is shown)."],
      ["Reuse an existing setup", "Copying an existing agent pre-fills grant types and token auth for the next build and pre-checks its scope grants.", "In Existing agents in PingOne click Copy setup on a row, then build from the Build my Agent (copy of ...) button."],
      ["Grant scopes and add a resource", "Scopes are the agent's permissions and only take effect once saved, and you can define your own resource server with its own scopes.", "Tick scope pills under Demo resources, fill Resource name, Audience (optional) and Scopes, click Create resource, then click Apply grants (the Unsaved changes marker clears)."],
    ]),
  },
  "/agent-lifecycle": {
    title: "Agent Lifecycle Guide",
    talkingPoints: [
      "One agent's full access lifecycle is shown in four steps: register, call, step up and revoke.",
      "The agent's calls go through RFC 8693 token exchange and the gateway, and the token-chain rail on the page shows the result.",
      "Revocation uses the same kill switch as the AI Control Plane page, with an audit trail and lifecycle feed afterwards.",
    ],
    walkthrough: steps([
      ["Register and consent", "Step 1 explains that the Agent Builder creates the real PingOne application and the Agent Registry then lists it. The page needs an admin login.", "Play the embedded registration and consent video, or follow the PingOne Agent Builder and Agent Registry links in that step."],
      ["Call a tool with a scoped token, then step up", "The page pins the session to the retail vertical, so the agent's list_orders call and the $600 checkout both run on the scoped token path, and the checkout exceeds the retail threshold so Authorize requires a CIBA approval.", "Click Call list_orders as agent and toggle Pretty Form and Raw JSON, then click Checkout $600 headphones and approve the step-up request."],
      ["Revoke the agent", "Self-service revoke ends the agent's access and your own session, so it is real kill-switch behaviour and not a simulation.", "Click Revoke agent access, choose This instance only in the confirm dialog, then open View audit trail or View lifecycle export feed (Re-enable agent apps appears after a full revoke)."],
    ]),
  },
  "/autonomous-agents": {
    title: "Autonomous Agents Guide",
    talkingPoints: [
      "An autonomous agent runs on a schedule with nobody signed in and authenticates as itself, unlike a worker agent that acts inside a user session.",
      "It is bounded by a standing mandate, and anything over the mandate is parked for approval over CIBA.",
      "Every run keeps a full record and a replayable token chain with no act claim, because nobody delegated it.",
    ],
    walkthrough: steps([
      ["Know the difference", "The explainer cards contrast the worker agent (fired by a user turn, bounded by that user) with the autonomous agent (fired by a schedule, bounded by a standing mandate).", "Read the Worker agent and Autonomous agent cards, and the Nightly Fraud Watch and Balance Sweep examples near the top of the page."],
      ["Switch it on and start a run", "The page is public, but nothing is scheduled or runnable until the ff_autonomous_agents flag is on.", "Click the On/Off switch in the Autonomous agents card, then in Run history click Run fraud watch or Run balance sweep."],
      ["Inspect a run and approve a parked one", "An opened run shows what it looked at, its mandate, the identity it used and what policy said, and a run over the mandate waits for the account owner.", "Click a run row to expand it and read Authenticated as, Standing mandate and Policy said, replay the Token chain, and click Approve or Decline on a run showing Waiting on approval."],
    ]),
  },
  "/langchain": {
    title: "LangChain Guide",
    talkingPoints: [
      "This is a reference page for the default banking agent runtime, langchain_agent, a FastAPI service speaking AG-UI on port 8888.",
      "The framework package (llm_framework) and the brain (Heuristics, Gemini, llama.cpp) are chosen independently.",
      "Tools run through the BFF with the delegated Ping token, and API keys stay server-side.",
    ],
    walkthrough: steps([
      ["Check the active brain", "The blue banner reads the current status so you can say which provider and model are answering, and whether a key is set.", "Read the Active brain / provider line, then click Change in Config to switch it."],
      ["Walk the architecture", "The Architecture diagram and the LangGraph / LCEL pattern code block show the path Browser to AIAgent to BFF to langchain_agent and /internal/agent-tool to the MCP gateway and Ping Authorize.", "Point at the diagram, then at the create_react_agent code block and its tools coming through the BFF."],
      ["Compare brains and frameworks", "Two tables separate the demo brains from the framework packages in the repo, so the audience sees that swapping one does not change the other.", "Find the row marked active in the Demo brains table, then the langchain_agent row marked this page in All agents we have. The page needs no sign-in."],
    ]),
  },
  "/ungoverned-agent": {
    title: "Ungoverned Agent Guide",
    talkingPoints: [
      "This is the before picture: an agent riding a logged-in browser session moves money with full user privileges and leaves no agent identity behind.",
      "The bank records the transfer exactly as if the human made it, which is the gap the Agent Gateway closes.",
      "The same transfer run through the governed agent shows an actor, delegated scope, policy decision and audit trail.",
    ],
    walkthrough: steps([
      ["Set up the contrast", "The comparison table lines up Identity, Scopes, Consent, Authorization, Audit and Revocation for governed against ungoverned access.", "Read the rows of the Governed vs. ungoverned table and the 1-2-3 proof strip in See it live."],
      ["Run the ungoverned transfer", "There are two ways to run it: OpenCLI on the presenter's own Chrome, or the containerized ungoverned-agent sidecar, and both drive the transfer form with the user's session.", "Copy the command from the Live: OpenCLI block (npx skills add jackwener/opencli) or the Reproducible: containerized sidecar block (docker compose run --rm ungoverned-agent) and run it. OpenCLI needs desktop Chrome and its extension, and the sidecar needs the customer's session cookie."],
      ["Show the badge difference", "The Recent transfers widget labels each row from the stored client type, so a session-riding transfer reads Direct user session while a governed one reads Governed agent (act-as chain).", "Sign in via the Sign in button in the widget if it asks, find the Direct user session row, then run the same transfer through the governed agent and compare badges. Finish with See the full OWASP mapping."],
    ]),
  },
  "/delegation-chain-value": {
    title: "Delegation Chain Value Guide",
    talkingPoints: [
      "When a user authorizes one agent but a specialist acts, the gap between who was authorized and who acted needs evidence.",
      "Each scenario is a real agent run through the live token-exchange and authorization path, not a mock-up.",
      "The first run proves accountability through a nested act claim, and the second proves authorization by denying an unregistered agent identity.",
    ],
    walkthrough: steps([
      ["Frame the trust gap", "The intro explains that delegated agents let a different specialist or tool perform the action the user authorized, and the page makes that visible. It runs in the Super Sports vertical.", "Read the heading Prove who acted, and who authorized it and the two section cards beneath it."],
      ["Run the accountability scenario", "The prompt 'hand off to a specialist' delegates to another agent and mints a governed token whose nested act claims record each hop bound to the user.", "Click Run under Accountability, the audit trail, read the reply shown on the page, then look at the app's token chain trace for the chain."],
      ["Run the authorization scenario", "The prompt 'simulate an agent identity mismatch' repeats the delegation and then probes the same policy with an unregistered agent, so the same user and request shape is denied.", "Click Run under Authorization, the actor-aware decision, compare the denial to the first reply, then click Clear to reset both. The run may arm MCP gateway flags through an admin-gated route and ignore a failure there."],
    ]),
  },
};
