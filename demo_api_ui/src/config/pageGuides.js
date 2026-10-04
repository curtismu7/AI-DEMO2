// Route -> Guide content. Drives the shared <PageGuide /> button.
//   lessons:     ids from learning/lessonCatalog.js, rendered as read-only steps.
//   body:        a lazy-loaded learning page to render as-is instead.
//   talkingPoints + walkthrough: page-specific copy written inline below.
// Pages that ARE a learning page already (/jev-learning, /a2a-protocol-learning,
// /davinci-widget, /academy/*) are deliberately absent.
const steps = (rows) => rows.map(([title, explain, demonstrate]) => ({ title, explain, demonstrate }));

export const PAGE_GUIDES = {
  "/agent-registry": { title: "Agent Registry Guide", lessons: ["agent-landscape", "lifecycle"] },
  "/token-exchange-tester": { title: "Token Exchange Guide", lessons: ["delegation"] },
  "/pingone-mcp-inspector": { title: "MCP Inspector Guide", lessons: ["mcp"] },
  "/agent-gateway-inspector": { title: "Agent Gateway Guide", lessons: ["authorize"] },
  "/personal-agent": { title: "Personal Agent Guide", lessons: ["consumer-agent"] },
  "/audit-agent": { title: "Audit Agent Guide", lessons: ["evidence-timeline"] },
  "/use-cases/live": {
    title: "Live Use Cases Guide",
    lessons: ["customer-service-agent", "hitl-step-up", "threat-defense"],
  },
  "/intent-inspector": { title: "Intent Binding Guide", body: "intent-binding" },
  "/dashboard": { title: "Demo Steps Guide", body: "demo-steps" },

  "/protocol-playground": {
    title: "Protocol Playground Guide",
    talkingPoints: [
      "The page runs the identity protocols the demo depends on one request at a time against the live backend, so the audience sees the real request and response for each hop.",
      "Each protocol shows its spec, what it solves, and why it matters for AI agents: CIBA approves a specific action, DPoP binds a token to its holder, RFC 8693 narrows and records delegation, and PAR declares intent before acting.",
      "Steps unlock in order, and a failed call shows what a failure looks like on the wire, which a spec document cannot show.",
    ],
    walkthrough: steps([
      ["Pick a protocol", "Selecting a protocol loads its sequence diagram, its step cards and a spec explainer covering what it solves, a real-world example and why it matters for AI agents.", "Click a protocol in the Protocols list on the left, then read the explainer under the protocol name."],
      ["Step through one hop at a time", "Running a single step lets you explain what the call sends and what the next call needs from its response before moving on.", "Click Next Step, or the execute control on the first step card, and watch the progress text change to Step 1 of N."],
      ["Read the real traffic", "The activity panel streams each step's actual request and response, including the decoded token where one comes back.", "Click Execute All to finish the flow, then read the results in the activity panel on the right; use Reset to run it again."],
    ]),
  },
  "/llm-gateway": {
    title: "AI Guard Guide",
    talkingPoints: [
      "Every prompt on this page goes through a PingOne Privilege virtual key, so the provider key stays inside Privilege and policy can refuse a call before the model sees the text.",
      "The rate and token meters are the provider's own limits passed through the gateway, and the page does not show spend because Privilege publishes no per-key usage.",
      "Comparing the same prompt against local models with no policy layer shows what the gateway adds.",
    ],
    walkthrough: steps([
      ["Choose a lane", "Each lane is a route to a model, showing whether a key is set and any provider limits or Privilege key caps; local lanes run with no key and no policy.", "Click a lane in the Lanes column on the left and note its Key set or No key pill."],
      ["Send an attack prompt", "The attack library fills the prompt with a known bad input so you can show policy stopping it, while a normal prompt shows the call passing through.", "Pick an entry in the Attack library dropdown, review the filled prompt, then click Send; turn on Presenter notes to see what to say for that attack."],
      ["Read the decision and compare", "The Last decision panel and the path band show what the gateway decided, and the comparison shows the same prompt answered with no policy layer.", "Read the Last decision panel (switch between Form and JSON), then click Compare local models and Send again, or click Run all chat attacks for the scorecard."],
      ["Raw request tab", "A plain REST client for the gateway that interprets nothing and shows exactly what came back (status, latency, raw body), so you can check the Chat console's verdict against ground truth and see that the provider key never reaches the browser.", "Pick a Lane, choose a Path, edit the Request body and press Send request, then flip the response view between Form and JSON; use Direct vs through Privilege by pasting a Provider API key and pressing Compare."],
      ["Malicious MCP tab", "Shows tool poisoning: a hostile MCP server hides instructions in its tool descriptions to induce a call to create_transfer, and Privilege denies the call without ever inspecting the poisoned metadata.", "Click Step 1 - Switch to hostile door, Step 2 - Sign in with Privilege, then Step 3 - Load the poisoned tools; press the create_transfer fire button, or in Step 4 choose a Model and press Run agent, then read the Relay log for DENIED."],
      ["Malicious A2A tab", "Shows agent-card poisoning: a hostile agent hides instructions in its Agent Card and skill descriptions, A2A discovery passes them along unfiltered, and a scanner in front of the agent flags them.", "Choose a sample from the Agent Card dropdown (or the live card by URL), press Scan this card, then compare What a delegating agent reads with the Scanner verdict findings."],
      ["Attack Lab tab", "Runs five attack scenarios, each against the boundary that can actually evaluate it, and reports observed enforcement evidence instead of the model's opinion.", "Select a scenario under Attack scenarios (Tool Abuse, Tool Poisoning, Schema Violation, Inter-Agent Abuse, Malicious Content), press its run button and read the evidence panel; How to present this lab has presenter notes."],
    ]),
  },
  "/agent-gateway-authorization": {
    title: "Agent Gateway Authorization Guide",
    talkingPoints: [
      "An agent's proposal is not permission: the gateway enforces a decision that PingOne Authorize supplies.",
      "The policy evaluates subject, acting agent, action, resource and context such as amount and destination, and can return PERMIT, DENY or STEP-UP.",
      "The lesson links to the live inspectors so the same request can be followed through the gateway, the policy decision and the audit trail.",
    ],
    walkthrough: steps([
      ["Walk the request flow", "The request passes through the user or agent, the Agent Gateway, PingOne Authorize and the protected resource, and each stage has a distinct job.", "In the Request flow section, click each stage (User / agent, Agent Gateway, PingOne Authorize, Protected resource) and read the detail text below the diagram."],
      ["Pick a scenario", "Three requests show the three outcomes: a balance read is permitted, a $500 transfer needs step-up, and a transfer to a blocked payee is denied.", "In the Try it section, click Read account balance, Transfer $500 or Transfer to blocked payee and check the Decision request JSON on the right."],
      ["Run it live and follow the evidence", "Run live request sends the call through the app's normal BFF path, so the real gateway and policy answer, and nothing is decided locally.", "Click Run live request, then use the Run the story live cards (Inspect gateway enforcement, Test Authorize decisions, Watch the token and audit trail) to open the matching inspector."],
    ]),
  },
  "/privilege-demo": {
    title: "Privilege Demo Guide",
    talkingPoints: [
      "This is the presenter hub for the shared PingOne Privilege demo, with the personas, the overview and the setup guide in one place.",
      "Each persona card gives an email, a VM name and a link into that persona's Privilege console.",
      "The OAuth configuration panel shows the live MCP registration and lets you save and test OAuth settings for the MCP server behind the gateway.",
    ],
    walkthrough: steps([
      ["Review the overview and personas", "The overview and the persona strip tell you who the demo users are and which console each one uses.", "Read the overview callout, then click Open console on a persona card to open that persona's Privilege console in a new tab."],
      ["Open the SE1 guide and related views", "The SE1 Privilege Shared Demo guide holds the full onboarding and setup steps, and the header links go to the supporting tools.", "Click Open the SE1 - Privilege Shared Demo guide, then try Kibana logs or MCP observability in the page header."],
      ["Check the MCP registration", "The page shows the current banking-mcp registration (Auth Mode None) and an OAuth form for the Auth Mode OAuth case; OAuth is a documented platform blocker, so treat saving and testing as optional.", "Scroll to Current registration, then fill in the OAuth configuration fields and click Save or Test Connection if you need to."],
    ]),
  },
  "/code-search": {
    title: "Protected RAG Guide",
    talkingPoints: [
      "Retrieval is a governed action: the request carries a delegated identity and the code:search scope through the Agent Gateway before any document is touched.",
      "PingOne Authorize permits retrieval only when the subject, agent and resource policy align, and a denial stops before the document boundary with no answer generated from unauthorized sources.",
      "The workspace manages the indexed corpus and offers both a conversational Ask tab and a plain Search tab.",
    ],
    walkthrough: steps([
      ["Read the authorization path", "The four cards (Request, Authorize retrieval, Policy decision, Grounded answer) show where policy sits relative to the data.", "Point at the Protected RAG retrieval authorization flow and read the Retrieval denied note beneath it."],
      ["Choose a codebase", "The corpus is split into indexed packages, and queries run against whichever one is selected.", "Click a codebase under Indexed Codebases on the left, or add one with the uploader above it."],
      ["Ask and search", "Ask returns an answer grounded in the selected codebase, while Search returns the matching code chunks directly.", "On the Ask tab type a question and send it, then switch to the Search tab, enter something like \"find authentication logic\" and click Search."],
    ]),
  },
  "/ai-gateway/shadow-ai-detector": {
    title: "Shadow AI Detector Guide",
    talkingPoints: [
      "The detector is a browser-side layer that reports AI usage, OAuth-connected agents and sensitive data movement; this page documents the signals the Chrome extension actually records.",
      "Risk is a capped score mapped to Low, Medium, High and Critical bands from concrete signals, not from an LLM judgment.",
      "It reports activity and risk only; it does not prove an agent is malicious, and it can miss new providers or private endpoints.",
    ],
    walkthrough: steps([
      ["Cover what it watches", "Five signal types drive detection: AI sites and API traffic, OAuth consent, installed AI extensions, sensitive-data movement and browser-native AI.", "In the What it watches section, read each signal card and its Examples line."],
      ["Explain the scoring", "Individual events get a capped score and a severity label, and specific conditions such as risky OAuth scopes or bearer tokens to AI endpoints raise it.", "Show the How risk is scored table (0-29, 30-59, 60-79, 80-100) and the What can raise a score list."],
      ["Set expectations", "Knowing the limits and the telemetry stops a dashboard finding being over-read or the extension's permissions being misunderstood.", "Read What it does not detect and Permissions and telemetry, including the default event destination in the footer."],
    ]),
  },
  "/pingone-authorize": {
    title: "P1AZ Inspector Guide",
    talkingPoints: [
      "The inspector sends real decision requests to a live PingOne Authorize endpoint and shows the verbatim verdict, without changing the app-wide enforcement engine.",
      "Presets mirror what the BFF sends: Transaction tests amount thresholds and step-up, and MCP First Tool tests token audience, actor chain and HITL consent.",
      "The Authorization Policies tree lets you pick a rule and test it directly.",
    ],
    walkthrough: steps([
      ["Find a policy", "The policy tree lists the environment's authorization policies and rules so you can show what is actually deployed.", "Type in the Search policies box on the left, then use a rule's Quick tests button to load it into the Evaluate form."],
      ["Choose a preset and set inputs", "Each preset sends a different set of attributes to the decision endpoint, and Custom parameters lets you probe attribute combinations the presets do not cover.", "Select the Transaction, MCP First Tool or Custom parameters tab and change a value such as Amount (USD)."],
      ["Evaluate live and read the result", "The result shows the decision returned by PingOne, including step-up or consent requirements, in several views.", "Click Evaluate (live), then switch between the Decision, Response, Request and Form tabs."],
      ["Live vs simulated engine", "Decisions come from either the in-process simulated policy engine or your real PingOne Authorize endpoint, so you need to know which one is answering. The Console tab always uses a real endpoint; the Simulated/Live switch is on the Guided Scenarios tab.", "On Guided Scenarios & Learn, check the engine badge and open Engine Settings to pick Simulated (in-process) or PingOne Authorize (live); on the Console tab, pick the Policy Endpoint and read the LIVE badge."],
      ["Bulk Decisions tab", "Sends many decision requests to one Authorize decision endpoint in a single call and shows a per-item results table.", "Choose a Decision endpoint, click Load MCP tools to fill the test data (or edit the JSON), then click Run bulk decision and read the Label, Decision, Step-up, Consent, Elapsed and Decision ID columns."],
      ["Guided Scenarios & Learn tab", "Evaluates preset transactions against the active engine without submitting a real transaction.", "Click Run All Scenarios or run a preset such as Small Transfer, High-Value, No MFA, High-Value + MFA or Blocked Transaction, review Run History, and use Reset to clear results."],
      ["Mock Authz Rules tab", "Shows and edits the simulated rules (tool scope requirements by vertical, the HITL threshold gate) that the mock engine enforces.", "Pick a vertical under Tool scope requirements by vertical, try Test this rule or Test HITL gate, then Save rules or Reset to defaults."],
      ["Scopes & Resources tab", "Audits your PingOne resource servers and scopes and offers a scope reference showing which scopes the demo depends on.", "On the Scope Audit sub-tab click Run Audit, then open the Scope Reference sub-tab to browse the custom and built-in resource servers."],
      ["Snapshot Import tab", "Validates a policy snapshot JSON against the repo's scope topology and flags conflicts; PingOne does not accept policy changes by API, so the import itself is manual.", "Click Generate & download import file for the current snapshot, or choose a .json file and click Validate Snapshot to see Valid or Invalid, the Summary and any Conflicts."],
    ]),
  },
  "/control-plane": {
    title: "Agentic Control Plane Guide",
    talkingPoints: [
      "The page reads live from /api/control-plane/overview, so every number comes from the stores that already hold the data and nothing is cached.",
      "It lays out five zones (catalog, registry, discovery, governance, observability) plus an Enforcement row, so one screen shows the whole agent landscape.",
      "The Needs attention count and the Triage list are the same array, so the headline number can never disagree with the detail.",
    ],
    walkthrough: steps([
      ["Read the summary tiles", "The tiles for Identities, Needs attention, Scope drift and Lifecycle events give a live health read before any detail.", "On the Landscape tab, point out the four tiles and read the note under Scope drift, which says whether granted scopes match scope-topology."],
      ["Walk the zones", "Each zone shows what its own source reported, and a source that is down says 'could not ask' instead of showing a fake healthy state.", "Scroll through Agent / MCP Catalog, Agent Registry, Agent Discovery, Agent Governance and Agent Observability, and click a zone footer link such as Open registry to jump to where it can be acted on."],
      ["Drill into triage", "Triage ranks findings worst first (critical, advisory, structural) with the evidence for each.", "Click the Needs attention tile (or the Triage tab), open a finding to read its detail and evidence, then use Refresh in the top bar to re-read everything live."],
    ]),
  },
  "/ai-control-plane": {
    title: "Agent Kill Switch Guide",
    talkingPoints: [
      "An agent gets its identity and tokens from Ping, so Ping is the place to revoke its authority.",
      "Stopping an agent revokes the token, disables the app and writes an audit record, regardless of which LLM or vendor runs it.",
      "Any signed-in user can open this page, and the roster shows a single live PingOne-backed agent identity.",
    ],
    walkthrough: steps([
      ["Frame the problem", "The three numbered cards explain why revoking at Ping cuts off the agent everywhere it acts.", "Read the 'What this is' banner and the three cards: agents authenticate through Ping, every action needs that token, and revoke at Ping ends access everywhere."],
      ["Stop one instance or the whole agent", "Instance scope revokes a single session's authority, while full scope disables the agent's PingOne application and blocks new tokens for every user of that client.", "On the live agent row, click Stop this instance or Stop entire agent, confirm in the modal, and watch the pill change to REVOKED with a timestamp."],
      ["Recover or escalate", "Revocation is reversible for the agent, and the comprehensive shutdown goes further by also ending the PingOne SSO session.", "Click Re-enable on the revoked row to restore the agent, or click Comprehensive shutdown and read the progress line, which reports the enforcement steps run before it signs you out."],
    ]),
  },
  "/pingfederate-id-jag/demo": {
    title: "Run ID-JAG Demo Guide",
    talkingPoints: [
      "This route renders the same page as /demo/enterprise-mcp: the Enterprise-Managed MCP Authorization demo.",
      "The identity provider checks policy and signs an ID-JAG before any token is minted, and the MCP authorization server redeems it for its own token.",
      "The live run needs PingFederate and a PingFederate login, while the mock run replays a sample flow with no login or live tokens.",
    ],
    walkthrough: steps([
      ["Read the four-step preview", "The page lists the sequence first so the audience knows what to watch for: policy at the IdP, ID-JAG issued, ID-JAG redeemed, then the tool call.", "Read the 'What you are about to see' card, and open the explainer buttons under it if they are present."],
      ["Choose a run mode", "Live mode proves the real PingFederate flow, and mock mode is the safe fallback when you are signed out or PingFederate is not selected.", "Click Run live ID-JAG demo (it signs you out, asks for PingFederate login, then runs the 'show my balance' chip) or click Run mock demo for an immediate replay."],
      ["Inspect the token chain", "The trace shows the ID-JAG issued and ID-JAG redeemed steps, and an ordinary exchange is labelled as a stand-in.", "Scroll to the Token chain card and look for 'ID-JAG issued' and 'ID-JAG redeemed' in the filmstrip; if the amber PingOne-is-selected notice appears, switch to PF with the top-bar P1/PF switch and re-run."],
    ]),
  },
  "/demo/enterprise-mcp": {
    title: "Enterprise-Managed MCP Auth Guide",
    talkingPoints: [
      "IT decides centrally which employees reach which MCP servers, so users never see a per-server consent screen.",
      "The identity provider evaluates group policy first, so an employee who is not entitled gets no token at all.",
      "No redirect to an MCP authorize endpoint appears anywhere in the flow.",
    ],
    walkthrough: steps([
      ["Set up the four steps", "Policy at the IdP, ID-JAG issued, ID-JAG redeemed, and token calls the tool are the sequence the demo proves.", "Read the numbered list in the 'What you are about to see' card and note that group membership is checked before anything is minted."],
      ["Run the flow", "A live run uses real PingFederate tokens, while a mock replay shows the same shape without logging in.", "Click Run mock demo for an instant replay, or Run live ID-JAG demo for the real flow; the status line under the buttons says which mode is running."],
      ["Verify in the trace", "The token chain is the evidence that the grant was signed, redeemed and then used.", "In the Token chain card, find the 'ID-JAG issued' and 'ID-JAG redeemed' entries in the filmstrip."],
    ]),
  },
  "/delegated-commerce": {
    title: "Delegated Commerce Guide",
    talkingPoints: [
      "The page runs the whole delegated-agent lifecycle in four steps: register, delegate, approve and revoke.",
      "An administrator registers the agent and a customer claims it and grants scoped consent, so two personas are needed.",
      "A $600 checkout crosses the policy threshold and waits for human approval through CIBA, and revoking access makes the next call fail.",
    ],
    walkthrough: steps([
      ["Register and consent", "The agent is a standard PingOne OAuth application whose secret stays server-side, and the customer then claims it with a one-time code and approves scopes.", "As administrator, click Create in PingOne in step 1 and note the claim code; use 'Switch to customer', enter the code, click Claim agent, then Review scoped consent."],
      ["Call a tool, then hit the approval gate", "list_orders runs through RFC 8693 token exchange and PingOne Authorize, and the large checkout is held for a human decision.", "Select step 2 and click Call list_orders as agent, then select step 3, click Checkout $600 headphones, and use Open human approval page if the status is pending."],
      ["Revoke and prove it", "Ending consent should cut the agent off immediately, and the page retries the call and links to audit evidence.", "Select step 4, click Revoke agent access, read the retry result, then check the Live token and policy chain panel and the View audit evidence link."],
    ]),
  },
  "/delegation": {
    title: "Family Delegation Guide",
    talkingPoints: [
      "An account owner grants another person scoped access to their accounts, and the chosen scopes become the OAuth scopes on that person's token.",
      "A separate toggle controls whether the AI agent may act on the owner's behalf, using the RFC 8693 act claim.",
      "Delegates can be listed and revoked, and the page shows a live token chain so the effect is visible.",
    ],
    walkthrough: steps([
      ["Authorize the AI agent", "The agent can only act for the user while this authorization is on, and when enforcement is on a revoked agent is blocked.", "In the AI Agent Authorization card, click Revoke agent access or Authorize agent and watch the badge switch between 'Agent authorized' and 'Agent revoked'."],
      ["Grant scoped access to a delegate", "Each checkbox maps to a specific OAuth scope, so access is limited to what the owner chose.", "In Grant Account Access, type an email, tick scopes such as View Balances, click Grant Access, and use Copy credentials on the new-account card if one is created."],
      ["Review and revoke", "The Active Delegates list and the history tab give a record of who has access and when it was removed.", "Open the Active Delegates and Delegation History tabs, click Revoke on a delegate, and use Run guided delegation demo in the header for a narrated walkthrough."],
    ]),
  },
  "/weather-mcp": {
    title: "Weather MCP Guide",
    talkingPoints: [
      "The agent calls an unmodified third-party weather MCP server, and the Agent Gateway enforces a geographic scope that the server itself knows nothing about.",
      "The allowed region is read live on every request, so the same query can flip from denied to allowed mid-demo with no restart.",
      "The agent geocodes first, so the policy is applied to the coordinate call and not to the city name typed.",
    ],
    walkthrough: steps([
      ["Check the capability and the policy", "The header shows the gateway route and whether the capability flag is on, because a disabled flag denies everything with HTTP 403.", "Read the Capability pill and flag id in the header, then look at the Allowed region card with its region control and the Blocked cities list."],
      ["Run a permit and a deny", "Two scripted prompts show the same agent getting different outcomes purely from gateway policy.", "Click Run next to the Austin, TX prompt (PERMIT) and then next to the Miami prompt (DENY); each opens the dashboard chat and records a token chain."],
      ["Change policy and ask live", "Changing the scope and re-asking proves the decision comes from the gateway policy and not from the tool.", "Adjust the region or add a city in the Blocked cities control, then type a location in 'Check any location' and click Check weather."],
    ]),
  },
  "/brave-mcp": {
    title: "Brave Search MCP Guide",
    talkingPoints: [
      "The agent calls the real Brave Search API through a third-party MCP server, and the Agent Gateway inspects the query before it leaves the perimeter.",
      "Blocked terms (bitcoin, cryptocurrency, crypto) are matched as substrings and enforced in the gateway, not in the search server.",
      "The term list is fixed in tx-brave-scope.groovy and cannot be changed from this page, unlike the weather scope.",
    ],
    walkthrough: steps([
      ["Show the policy", "The page lists the exact blocked terms and the gateway route so the audience can see what will be refused.", "Read the Gateway route and Capability pill in the header, then the Blocked search terms card."],
      ["Run a permit and a deny", "A harmless query is forwarded and a crypto query is refused before any third party sees it.", "Click Run next to 'search the news for PingOne DaVinci' (PERMIT), then next to 'search the news for bitcoin price today' (DENY), and inspect the token chain on the dashboard."],
      ["Let the audience pick a query", "A free-form query goes down the same path, so it produces the same token chain as the scripted runs.", "In 'Search anything', type a query (include a blocked term to see a refusal) and click Search news; the 'Where it is enforced' card lists the Groovy and route files behind the policy."],
    ]),
  },
};
