Ready for review
Select text to add comments on the plan

Plan: Align SequenceDiagramPage with i4ai-ref-arch.mmd

Context
The /sequence-diagram page was built to simulate the i4ai token-exchange flow, but a detailed diff shows it diverges from the canonical i4ai-ref-arch.mmd in several ways:

- Participant column order is wrong (AG and PA are swapped)
- 4 steps are missing (MMD steps 1, 2, 46, 47)
- 1 phantom step exists at wrong position (old JS step 9 U→CB "Check my balance")
- 1 arrow has the wrong direction type (old JS step 22: type: 'response' should be 'request')
- All 14 Note over annotations are absent (no rendering support)
- SCENARIOS use stale step index ranges
- Only file to modify: banking_api_ui/src/components/SequenceDiagramPage.js

Fix 1 — Participant Column Order (Critical — visual arrow directions wrong)
MMD order: U, WA, CB, A, LLM, PID, AG, PA, MCP, RS
Current JS order: U, WA, CB, A, LLM, PID, PA, AG, MCP, RS ← AG and PA swapped

Every AG↔PA arrow renders in the wrong visual direction because lifeline x-positions are derived from array index. Fix: swap the two entries in PARTICIPANTS, and align labels to MMD:

const PARTICIPANTS = [
  { id: 'U',   label: 'User',            icon: '👤' },
  { id: 'WA',  label: 'Web App',         icon: '🌐' },
  { id: 'CB',  label: 'Chatbot',         icon: '💬' },
  { id: 'A',   label: 'Agent',           icon: '🤖' },
  { id: 'LLM', label: 'LLM',             icon: '🧠' },
  { id: 'PID', label: 'PingOne',         icon: '🏛️' },
  { id: 'AG',  label: 'Agent Gateway',   icon: '🔀' },   // ← was index 7, now index 6
  { id: 'PA',  label: 'Ping Authorize',  icon: '⚖️' },   // ← was index 6, now index 7
  { id: 'MCP', label: 'MCP',             icon: '🛠️' },
  { id: 'RS',  label: 'Resource Server', icon: '🏦' },
];

Fix 2 — Steps: Add 4 Missing, Remove 1 Phantom, Fix 1 Arrow Type
Add at the front (MMD steps 1–2):
{ step: 1, from: 'U',  to: 'CB', label: '"What is my current account balance and recent transactions?"', type: 'request' },
{ step: 2, from: 'CB', to: 'A',  label: 'Process user request via Agent', type: 'request' },
Remove phantom step:
Old JS step 9 (U→CB: "Check my balance") — no MMD counterpart at that position. Delete it. The user's initial prompt is now correctly placed as step 1.

Fix arrow type (old JS step 22, new step 23):
CB→A: Subject token (sub: user, may_act: {sub: agent1}) — MMD uses ->> (solid, request). Change type: 'response' → type: 'request'.

Add at the end (MMD steps 46–47):
{ step: 46, from: 'CB', to: 'WA', label: 'Response + context',             type: 'response' },
{ step: 47, from: 'WA', to: 'U',  label: 'Also sync to dashboard/full UI', type: 'response' },
Resulting ALL_STEPS: 47 steps, 1:1 with MMD autonumber
After the changes, ALL_STEPS step numbers match MMD autonumber exactly:

Step	from→to	type	Notes
1	U→CB	request	NEW — user's initial prompt
2	CB→A	request	NEW — chatbot hands off to agent
3	A→PID	request	was step 1
4	PID→A	response	was step 2
5	A→AG	request	was step 3
6	AG→PA	request	was step 4
7	PA→PID	request	was step 5
8	PID→PA	response	was step 6
9	PA→AG	response	was step 7
10	AG→A	response	was step 8
11	CB→A	request	was step 10 (old phantom step 9 removed)
12	A→LLM	request	was step 11
13	LLM→A	response	was step 12
14	A→AG	request	was step 13
15	AG→PA	request	was step 14
16	PA→AG	response	was step 15 (DENY)
17	AG→A	response	was step 16 (403)
18	A→CB	response	was step 17
19	CB→WA	request	was step 18
20	WA→PID	request	was step 19
21	PID→WA	response	was step 20 (subject token)
22	WA→CB	response	was step 21
23	CB→A	request	was step 22 — BUG FIX (was 'response')
24	A→PID	request	was step 23 (RFC 8693 #1)
25	PID→A	response	was step 24 (TX token)
26	A→AG	request	was step 25
27	AG→PA	request	was step 26
28	PA→PID	request	was step 27
29	PID→PA	response	was step 28
30	PA→AG	response	was step 29 (PERMIT)
31	AG→PID	request	was step 30 (RFC 8693 #2)
32	PID→AG	response	was step 31 (MCP token)
33	AG→MCP	request	was step 32
34	MCP→PID	request	was step 33 (RFC 8693 #3)
35	PID→MCP	response	was step 34 (RS token)
36	MCP→RS	request	was step 35
37	RS→PID	request	was step 36
38	PID→RS	response	was step 37
39	RS→MCP	response	was step 38 (balance data)
40	MCP→AG	response	was step 39
41	AG→A	response	was step 40
42	A→LLM	request	was step 41
43	LLM→A	response	was step 42
44	A→CB	response	was step 43
45	CB→U	response	was step 44
46	CB→WA	response	NEW
47	WA→U	response	NEW

Fix 3 — Note Annotations (14 notes from MMD)
Data model: Add type: 'note' steps to ALL_STEPS, interleaved between arrow steps:

{ type: 'note', participants: ['CB', 'WA'], text: 'If user is not authenticated,\nan authn event is triggered first' }
Renderer: In the SVG step renderer, detect type === 'note' and render an amber callout band spanning the participants columns — no arrow, no token card, italic text.

14 note positions (interleaved in ALL_STEPS between their adjacent arrow steps):

Before/After step	participants	text
Before step 1	U, CB	"User submits prompt"
Before step 3	A	"Agent initializes"
Before step 5	A	"Request tool list"
After step 8	PA	"Fine-grained policy evaluation:\nreturn allowed tools for this agent"
Before step 14	A	"Tool call — agent context only\n(no user subject token)"
Before step 19	CB, WA	"User already authenticated\nObtain scoped subject token"
Before step 19 (2nd)	CB, WA	"If user is not authenticated,\nan authn event is triggered first"
Before step 24	A, PID	"Exchange token for Agent Gateway (RFC 8693)"
After step 25	A	"sub=user, act=agent1 — Agent acts on behalf of user"
After step 25 (2nd)	A	"Option: aud: mcp-olb\n(requires assurance only path to MCP is via gateway)"
Before step 27	AG, PA	"Gateway authorizes TX token + tool call"
Before step 31	AG, PID	"Exchange token for MCP"
Before step 34	MCP, PID	"Exchange token for Resource Server"
After step 35	RS	"Validate: aud=resource-server,\nscope: balance, act: agent1"
After step 45	CB, U	"Chatbot shows AI response:\n'Your checking account balance is $2,450.32...'"
After step 47	U	"User can view in both\nchatbot interface and main dashboard"
Notes are skipped by scenarios that target specific arrow-step ranges — they appear in full-flow only (or adjacent to their included arrows in filtered scenarios).

Fix 4 — Update SCENARIOS
New ranges after renumbering (all step numbers shift +2 from old, minus the removed phantom):

const SCENARIOS = {
  'full-flow':        ALL_STEPS,
  'agent-init':       ALL_STEPS.filter(s => s.step && s.step <= 10),
  'no-subject-token': ALL_STEPS.filter(s => s.step >= 11 && s.step <= 18),
  'obtain-subject':   ALL_STEPS.filter(s => s.step >= 19 && s.step <= 23),
  'token-exchanges':  ALL_STEPS.filter(s =>
    [24,25,31,32,34,35].includes(s.step) || (s.step >= 26 && s.step <= 30)),
  'full-auth':        ALL_STEPS.filter(s => s.step >= 26 && s.step <= 30),
  'data-return':      ALL_STEPS.filter(s => s.step >= 36 && s.step <= 47),
};
Note: type: 'note' steps have no step number, so s.step && guards them out of all filtered scenarios. The full-flow scenario uses ALL_STEPS directly, so notes appear there.

Verification
npm run build in banking_api_ui/ → exit 0
Navigate to /sequence-diagram — participant order left-to-right: User | Web App | Chatbot | Agent | LLM | PingOne | Agent Gateway | Ping Authorize | MCP | Resource Server
Click Simulate → step 1 shows U→CB solid arrow (the user's initial prompt)
Steps 5–10: tools/list flow — AG is to the left of PA, arrows point rightward toward PA
Step 23 (CB→A Subject token) renders as solid arrow (request, not dashed)
Simulation reaches step 47: shows CB→WA and WA→U sync arrows at the end
Note callout bands (amber) appear between arrow steps in full-flow simulation
Scenario "Agent Init" includes the user prompt (steps 1–2) + CC token + tools/list (steps 3–10)
Scenario "Data Return" includes final sync steps 46–47
