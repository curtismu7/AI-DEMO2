// Content for the eight Jev gallery demos. Figures are the creators' reported
// costs and timings from the article (generativeai.pub, Sep 2026), shown as
// reported — not measurements from this demo. Vendor claims are labelled.

export const GALLERY = [
  { id: 'pr-review', label: 'PR Review', title: 'Reviewing pull requests at almost zero cost', icon: 'doc' },
  { id: 'computer-use', label: 'Computer Use', title: 'Deciding the next screen action in under a second', icon: 'demo' },
  { id: 'internal-links', label: 'Internal Links', title: 'Finding internal links across an entire website', icon: 'lnk' },
  { id: 'doc-sort', label: 'Doc Sorting', title: 'Sorting tax documents at about $0.001 per page', icon: 'pol' },
  { id: 'game-agent', label: 'Game Agent', title: 'Playing a runner game, one decision per frame', icon: 'agt' },
  { id: 'compaction', label: 'Context Compaction', title: 'Clearing out an agent’s context more quickly', icon: 'cfg' },
  { id: 'trading', label: 'Trading Bot', title: 'A decision per block in a trading loop', icon: 'log' },
  { id: 'papers', label: 'Paper Organizer', title: 'Organizing more than 1,000 AI research papers', icon: 'arc' },
];

export const ARTICLES = {
  'pr-review': {
    scenario: 'prCheck',
    kind: 'batch',
    reported: '$0.00007 per review · ~0.5 s · 14 checks in one call',
    lead: 'Send the diff, get every check back as a probability: block, security-review, flag, or merge. The creator reported $0.00007 per review against $14.50 for a frontier-model setup — 1,000 PRs for seven cents.',
    lesson: 'The interesting part is the uncertain middle: when a critical check lands between 0.35 and 0.65 the system escalates to a person instead of guessing. Drag the band to see how much of the run flips from automated to escalated.',
    checks: [
      { id: 'secrets', label: 'Exposed secrets', text: "const API_KEY = 'sk-proj-realkeyvalue123';" },
      { id: 'sqli', label: 'SQL injection', text: "const q = \"SELECT * FROM users WHERE name = '\" + userName + \"'\";" },
      { id: 'authz', label: 'Auth changes need review', text: 'diff: middleware/auth.js — removed the RBAC scope check on /admin routes' },
      { id: 'tests', label: 'Deleted tests', text: 'diff: test/auth.test.js — deleted 3 test cases covering token expiry' },
      { id: 'desc', label: 'Description matches code', text: 'PR says "bump dependency versions" but the diff edits auth middleware' },
      { id: 'benign', label: 'Benign styling change', text: 'diff: styles.css — padding: 12px → 16px on card headers' },
    ],
  },
  'computer-use': {
    scenario: 'uiAction',
    kind: 'single',
    reported: '< 1 s response · near-zero cost per action',
    lead: 'A computer-use agent asks the model which control to activate next. The screen state goes in, one typed action comes out — click, type, navigate, or done.',
    lesson: 'The software still owns the hard parts: describing the screen as choices, executing the action, checking the result. The model just decides. Try the different screens.',
    screens: [
      {
        id: 'login', name: 'Sign-in screen', goal: 'Sign in as the demo customer',
        state: 'A login form with an email field focused, a password field, and a Sign in button. The email field is empty.',
        expected: 'type',
        expectedWhy: 'The focused empty email field is the next thing that needs input.',
      },
      {
        id: 'menu', name: 'Settings screen', goal: 'Enable the dark-mode toggle',
        state: 'A settings page. The Display section is collapsed inside a submenu; a dark-mode toggle exists inside it.',
        expected: 'navigate',
        expectedWhy: 'The control is inside a collapsed submenu — open the menu before the toggle exists to click.',
      },
      {
        id: 'confirm', name: 'Confirmation screen', goal: 'Sign in as the demo customer (form submitted)',
        state: 'A "Signed in successfully" banner is showing. The goal has been achieved.',
        expected: 'done',
        expectedWhy: 'The goal is already complete — a wrong model here would click something and undo it.',
      },
    ],
  },
  'internal-links': {
    scenario: 'linkPair',
    kind: 'batch',
    reported: '586 pages → 584 links placed in 45.1 s · $0.21 · 139 declined',
    lead: 'Score every candidate page pair for reader relevance, link the strong pairs, decline the rest. The creator’s run declined 139 pages because no good match existed — a decline is a result, not a failure.',
    lesson: 'Word-overlap matching (the baseline) says yes whenever two pages share vocabulary. That is how you get links that feel spammy. The decline count is the honest number: a linking pass that declines nothing is over-linking.',
    pairs: [
      { from: 'Guide to AI coding tools', to: 'What is MCP? A detailed explanation of the Model Context Protocol', match: true },
      { from: 'Guide to AI coding tools', to: 'Our company picnic photos, 2025', match: false },
      { from: 'OAuth 2.0 flows explained', to: 'PKCE: why public clients need it', match: true },
      { from: 'OAuth 2.0 flows explained', to: 'Best coffee grinders of 2026', match: false },
    ],
  },
  'doc-sort': {
    scenario: 'docType',
    kind: 'batch',
    reported: '~$0.001 per page · 34× cheaper, 6× faster than the previous pipeline · 100% strict accuracy on 314 filled pages',
    lead: 'Classify each page into a form category with a confidence value. Below the threshold does not mean wrong — it means "send to a person", which is a different outcome from a confident mislabel.',
    lesson: 'The creator’s eval had zero wrong labels on 753 blank pages — but 38 pages fell below the confidence threshold and counted as strict errors. Keep those two numbers separate in your head: misclassification sends a process in the wrong direction; low confidence just costs a human glance.',
    docs: [
      { name: 'scan-001.png', text: 'Form W-2 Wage and Tax Statement. Employer: Acme Corp. Wages: $84,200. Federal income tax withheld: $11,300.' },
      { name: 'scan-002.png', text: '1099-INT Interest Income. Payer: First National Bank. Interest income: $412.19.' },
      { name: 'scan-003.png', text: 'RECEIPT — Hardware Store. Total: $63.87. Paid with card ending 4417. Thank you!' },
      { name: 'scan-004.png', text: 'INVOICE #2026-081. Amount due: $2,400. Net 30. Purchase order PO-9921.' },
      { name: 'scan-005.png', text: 'Handwritten note: "reminders — dentist tuesday, call plumber". No letterhead.' },
    ],
  },
  'game-agent': {
    scenario: 'gameMove',
    kind: 'game',
    reported: 'Superhuman reaction reported · 50 simultaneous games · run cost < $0.01',
    lead: 'The runner sends each frame’s situation and gets one action back: stay, left, right, jump, or slide. Press Run and watch the decision loop.',
    lesson: 'A game is the fastest way to see whether a sequence of decisions works: the character either clears the obstacle or doesn’t. The demo shows every decision with its score, so a crash is explainable — but remember the clip’s performance depends on the whole setup (screen reading + action execution), not just the model.',
  },
  compaction: {
    scenario: 'keepTurn',
    kind: 'batch',
    reported: 'Scores every tool call and result in one pass (fast-jev-compaction)',
    lead: 'An agent’s context grows until it drowns. Compaction scores each item: keep or drop. The plugin’s rules still apply on top — recent messages protected, call/result pairs kept together, user text untouched.',
    lesson: 'The hard part is the item that looks useless now but explains a failure ten turns later. The baseline keeps anything containing "error" or "test" — which is why it also keeps noise that merely mentions them. Adjust the protect window and watch the trade.',
    transcript: [
      { turn: '[t-8]', text: 'Read src/billing.js — 340 lines of pricing logic' },
      { turn: '[t-7]', text: 'Ran tests: 12 passed' },
      { turn: '[t-6]', text: 'Error: TypeError reading price of undefined in billing.js:214' },
      { turn: '[t-5]', text: 'Read billing.js lines 200-230' },
      { turn: '[t-4]', text: 'Fixed: guard added for missing price object' },
      { turn: '[t-3]', text: 'Ran tests: 12 passed, 3 previously failing now pass' },
      { turn: '[t-2]', text: 'Read README.md — installation instructions, unrelated to fix' },
      { turn: '[t-0]', text: 'User: now update the changelog to mention the billing fix' },
    ],
  },
  trading: {
    scenario: 'tradeSide',
    kind: 'game',
    reported: 'Executes on Kuru (Monad) order book, targeting the 300 ms block interval',
    lead: 'Every block, the bot sends the price move and gets a side: buy or sell. This version is a simulation — it logs every decision against the price that followed, which is the evaluation the real demo lacks.',
    lesson: 'A fast buy/sell decision tells you nothing about whether it is profitable. The demo’s standing instruction is "always pick a side" — no abstain — which is exactly what you would remove in a real strategy. Watch the equity line next to the decision log.',
  },
  papers: {
    scenario: 'paperTopic',
    kind: 'batch',
    reported: '1,018 papers classified · $0.08 total · 256 ms median per paper (summaries: $3.99 via DeepSeek V4 Flash)',
    lead: 'Each paper’s title and abstract goes in; one of ten topics comes out with a confidence. This is the two-model split that made the creator’s total $4.07: a cheap LLM summarizes, Jev classifies.',
    lesson: 'Browse by topic and the categories earn their keep or they don’t. The point is not accuracy on one paper — it is that adjusting a category list is a prompt edit, not a retraining job.',
    papers: [
      { title: 'ReAct: Synergizing Reasoning and Acting in Language Models', abstract: 'Large language models generate reasoning traces and task-specific actions interleaved for tool use in agentic settings.' },
      { title: 'LoRA: Low-Rank Adaptation of Large Language Models', abstract: 'We freeze pretrained weights and inject trainable rank-decomposition matrices, cutting trainable parameters by 10,000×.' },
      { title: 'Not what you’ve been trained on: prompt injection against tool-using agents', abstract: 'We demonstrate jailbreak attacks that hijack agent tool calls via poisoned retrieved documents.' },
      { title: 'Retrieval-augmented generation for knowledge-intensive tasks', abstract: 'We combine a parametric memory with a non-parametric retrieval index and study grounding of generated text.' },
      { title: 'Scaling test-time compute optimally for arithmetic reasoning', abstract: 'We study how allocating more inference-time compute to search improves chain-of-thought accuracy.' },
    ],
  },
};
