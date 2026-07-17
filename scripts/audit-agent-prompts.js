#!/usr/bin/env node
'use strict';

/**
 * Master list of every literal, agent-facing prompt hardcoded across the demo:
 * the /use-cases catalog (resolved across EVERY vertical, not just banking —
 * config/useCases.js's perVertical override system swaps in different trigger
 * text per vertical for 15 of 41 use cases, 119 additional prompt texts that a
 * banking-only scan misses entirely) plus scattered UI sources that separately
 * fire text at the live agent (AiAttacksPanel, OASDemoPage) or a non-text
 * backend simulation (AdminSideNav's "Intent Bypass"). Groups near-duplicate
 * intents (same ask, different wording) so additions don't silently pile up
 * more variants of "check my balance" or "transfer $X" — and flags which
 * prompts have no documented expected outcome at all, since only the
 * catalog's `expectedOutcome` and AgentDemoGuide's `watch[]` array assert
 * anything about what should happen.
 *
 * This is a STATIC inventory only — it does not run any prompt against a live
 * agent, and does not verify a prompt against any specific agent mode/backend
 * (see AGENT_MODES below — heuristics/gemini/llamacpp/mlx/claude/helix_google/
 * groq are the modes the main chat can run under; PingOneTestPage.jsx and
 * /langchain, /copilot were checked and confirmed to have no hardcoded
 * prompts of their own, so they are not separate "sources"). See the
 * `chip-correctness-testing` skill for the live-verification methodology as
 * a follow-up once this report shows what's worth checking, per agent mode.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Cross-reference against real recorded conversations, if any exist.
 * `demo_api_server/services/lmdb/conversationStore.lmdb.js` stores actual
 * prompt+response pairs per turn ({ role, content, ... }); `mcpAuditStore`
 * stores real tool-call results. If a prompt in this report has a matching
 * `role: 'user'` entry, that's real live ground truth, not just a declared
 * expectedOutcome. Best-effort and optional — the `lmdb` package or the data
 * directory may not be present in every environment this script runs in
 * (e.g. a bare CI checkout), so any failure here degrades to "unknown"
 * rather than crashing the whole report.
 */
function checkLmdbGroundTruth() {
  const result = { checked: true, error: null, conversationEntries: 0, mcpAuditEntries: 0, matchedPromptTexts: new Set() };
  let env;
  try {
    // eslint-disable-next-line global-require
    const { open } = require(path.join(ROOT, 'demo_api_server/node_modules/lmdb'));
    // readOnly: this may run against the main checkout's live LMDB file while
    // a real server has it open — never write, never risk lock contention.
    env = open({ path: path.join(ROOT, 'demo_api_server/data/persistent/lmdb'), maxDbs: 32, readOnly: true });
    const conversations = env.openDB('conversations', { encoding: 'json' });
    for (const { value } of conversations.getRange()) {
      result.conversationEntries++;
      if (value && value.role === 'user' && typeof value.content === 'string') {
        result.matchedPromptTexts.add(value.content.trim().toLowerCase());
      }
    }
    const mcpAudit = env.openDB('mcpAudit', { encoding: 'json' });
    for (const _ of mcpAudit.getRange()) { result.mcpAuditEntries++; }
  } catch (err) {
    result.checked = false;
    result.error = err.message;
  } finally {
    if (env) { try { env.close(); } catch (_) { /* already closed / never opened */ } }
  }
  return result;
}

const ROOT = path.join(__dirname, '..');
const OUT_MD = path.join(ROOT, 'docs/agent-prompts/audit.md');
const OUT_JSON = path.join(ROOT, 'docs/agent-prompts/audit.json');

const { USE_CASES, VERTICALS, resolveUseCase } = require(path.join(ROOT, 'demo_api_server/config/useCases'));

// The main chat's known LLM/heuristic backends (demo_api_ui/src/config/agentModes.js
// is the client SSOT; kept as a literal copy here since this script runs outside
// the React build). No prompt in this report has been live-verified against any
// of these yet — `chip-correctness-testing` is the methodology for that, this
// list just names what "verified" would need to cover.
const AGENT_MODES = ['heuristics', 'gemini', 'llamacpp', 'mlx', 'claude', 'helix_google', 'groq'];

// ---------------------------------------------------------------------------
// Extraction — one function per source, each returning PromptEntry[]:
//   { text, source, location, outcome }
// `outcome` is whatever that source documents about the expected result, or
// null if the source has no such field at all.
// ---------------------------------------------------------------------------

function extractCatalog() {
  const entries = [];
  const allVerticals = ['banking', ...VERTICALS];
  for (const uc of USE_CASES) {
    // De-dupe: a UC with no perVertical override resolves to the identical
    // base trigger for every vertical — only emit that once (as 'banking',
    // the default), not 10 identical copies. A UC WITH a perVertical entry
    // for a given vertical gets its own row, since the text genuinely differs.
    const seenForThisUc = new Set();
    for (const v of allVerticals) {
      const resolved = (v === 'banking' ? uc : resolveUseCase(uc.id, v)) || uc;
      const t = resolved.trigger || {};
      const hasOverrideForThisVertical = v !== 'banking' && uc.perVertical?.[v];
      if (v !== 'banking' && !hasOverrideForThisVertical) continue; // identical to banking row, skip
      if (t.type === 'chip' && t.text) {
        const dedupeKey = `${t.text.trim().toLowerCase()}`;
        if (seenForThisUc.has(dedupeKey)) continue; // same text resolved twice for this UC (rare) — one row is enough
        seenForThisUc.add(dedupeKey);
        entries.push({
          text: t.text,
          source: 'catalog (chip)',
          location: v === 'banking' ? uc.id : `${uc.id} [${v}]`,
          outcome: resolved.expectedOutcome || uc.expectedOutcome || null,
        });
      } else if (t.type === 'attack' && t.sim) {
        // Not free text — a backend simulation id. Recorded separately so the
        // report doesn't silently drop these, but excluded from text-based
        // duplicate grouping since there's no wording to compare.
        entries.push({
          text: `[simulation: ${t.sim}]`,
          source: 'catalog (attack-sim)',
          location: v === 'banking' ? uc.id : `${uc.id} [${v}]`,
          outcome: resolved.expectedOutcome || uc.expectedOutcome || null,
          nonText: true,
        });
      }
    }
  }
  return entries;
}

function extractSideNavNonTextTriggers() {
  // AdminSideNav.jsx's "AI Attack Demos" section: 5 entries just call
  // openEdu(EDU.AI_ATTACKS, tab) — already covered via AiAttacksPanel's own
  // extraction. "Intent Bypass" is different: it dispatches a
  // 'banking-attack-demo' event straight to a backend simulation endpoint
  // (AIAgent.js -> POST /api/dev/intent-bypass-demo), no free text involved.
  // Hand-recorded here rather than regex-scraped from AdminSideNav.jsx, since
  // it's one fixed entry, not a pattern likely to grow silently.
  return [{
    text: '[simulation: intent-bypass, POST /api/dev/intent-bypass-demo]',
    source: 'AdminSideNav.jsx (AI Attack Demos > Intent Bypass)',
    location: "action handler, 'banking-attack-demo' event",
    outcome: null,
    nonText: true,
  }];
}

function extractAiAttacksPanel() {
  const filePath = path.join(ROOT, 'demo_api_ui/src/components/education/AiAttacksPanel.js');
  const src = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  // RUN_BY_TAB entries: kind:'prompt' carries literal text in `message`;
  // kind:'showcase' fires a named canned showcase, not free text.
  const blockMatch = src.match(/const RUN_BY_TAB = \{([\s\S]*?)\n\};/);
  if (!blockMatch) return entries;
  const block = blockMatch[1];
  const entryRe = /'([\w-]+)':\s*\{([^}]*)\}/g;
  let m;
  while ((m = entryRe.exec(block))) {
    const [, tabId, body] = m;
    if (/kind:\s*'prompt'/.test(body)) {
      const msg = body.match(/message:\s*'([^']*)'/);
      if (msg) {
        entries.push({
          text: msg[1],
          source: 'AiAttacksPanel.js',
          location: `RUN_BY_TAB['${tabId}']`,
          outcome: null, // no expected-outcome field on this component
        });
      }
    } else if (/kind:\s*'showcase'/.test(body)) {
      const showcase = body.match(/showcase:\s*'([^']*)'/);
      entries.push({
        text: showcase ? `[showcase: ${showcase[1]}]` : '[showcase: unknown]',
        source: 'AiAttacksPanel.js (showcase)',
        location: `RUN_BY_TAB['${tabId}']`,
        outcome: null,
        nonText: true,
      });
    }
  }
  return entries;
}

function extractOasDemoPage() {
  const filePath = path.join(ROOT, 'demo_api_ui/src/components/OASDemoPage.jsx');
  const src = fs.readFileSync(filePath, 'utf8');
  const m = src.match(/encodeURIComponent\('([^']*)'\)/);
  if (!m) return [];
  return [{
    text: m[1],
    source: 'OASDemoPage.jsx',
    location: 'handleLaunchAgent',
    outcome: null,
  }];
}

function extractPingOneTestPage() {
  // Confirmed by direct read (2026-07-17): these agentPrompt strings are
  // illustrative-only — a typewriter-effect preview attached to this page's
  // own onTest() button, which tests PingOne token-exchange *configuration*,
  // not the live banking agent. Never navigates to /dashboard, never
  // dispatches an agent event. Kept in this report anyway (still real
  // prompt-shaped text that can go stale/duplicate) but labeled so nobody
  // chases a "why doesn't this launch the agent" bug that doesn't exist.
  const filePath = path.join(ROOT, 'demo_api_ui/src/components/PingOneTestPage.jsx');
  const src = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  const re = /agentPrompt:\s*"([^"]*)"/g;
  let m;
  let i = 0;
  while ((m = re.exec(src))) {
    i += 1;
    const line = src.slice(0, m.index).split('\n').length;
    entries.push({
      text: m[1],
      source: 'PingOneTestPage.jsx (illustrative text only — does not launch the agent)',
      location: `agentPrompt #${i} (line ${line})`,
      outcome: null,
    });
  }
  return entries;
}

// Verbs/phrases that mean "do this in the UI", not "type this to the agent"
// — AgentDemoGuide.jsx reuses the same `prompt:` field name for both. This is
// a prefix heuristic, not a parser: entries it doesn't catch stay in the main
// list and may need a human eyeball on the "Full inventory" section below.
const UI_INSTRUCTION_PREFIXES = [
  'go to', 'nav →', 'nav ->', 'click', 'select', 'reset', 'demo config',
  'sign in modal', '(no manual prompt', 're-enable', 're-disable',
  'read the returned',
];

function looksLikeUiInstruction(text) {
  const t = text.trim().toLowerCase();
  return UI_INSTRUCTION_PREFIXES.some((p) => t.startsWith(p));
}

function extractAgentDemoGuide() {
  const filePath = path.join(ROOT, 'demo_api_ui/src/components/AgentDemoGuide.jsx');
  const src = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  // Anchored to line-start (not a bare substring search): several `action:`
  // labels in this file are themselves phrases like "Send a read prompt:",
  // which a bare /prompt:\s*"([^"]*)"/ would latch onto mid-string and then
  // capture garbage up to the *next* quote. Every real `prompt:` field in
  // this file's consistent object-literal formatting starts its own line.
  const re = /^\s*prompt:\s*"([^"]*)"/gm;
  let m;
  while ((m = re.exec(src))) {
    const text = m[1];
    const line = src.slice(0, m.index).split('\n').length;
    if (!text.trim()) continue;
    const isUi = looksLikeUiInstruction(text);
    // Look for a sibling `watch: [...]` array within ~600 chars after this
    // prompt — cheap proximity heuristic, not a real parser. Good enough to
    // flag "has some documented expectation" vs "none at all".
    const window = src.slice(m.index, m.index + 800);
    const watchMatch = window.match(/watch:\s*\[([\s\S]*?)\]/);
    const watchCount = watchMatch
      ? (watchMatch[1].match(/"/g) || []).length / 2
      : 0;
    entries.push({
      text,
      source: isUi ? 'AgentDemoGuide.jsx (UI instruction, not a prompt)' : 'AgentDemoGuide.jsx',
      location: `line ${line}`,
      outcome: watchCount > 0 ? `watch[] has ${Math.round(watchCount)} entries` : null,
      nonText: isUi,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Grouping — exact duplicates (same literal text, any source) and
// near-duplicates by intent (same underlying ask, different wording).
// ---------------------------------------------------------------------------

const INTENT_BUCKETS = [
  { key: 'balance', label: 'Balance check', test: (t) => /\bbalance/i.test(t) },
  { key: 'transfer', label: 'Transfer $X', test: (t) => /transfer/i.test(t) && /\$/.test(t) },
  { key: 'fee-waiver', label: 'Fee waiver request', test: (t) => /waive.*fee|fee.*waive/i.test(t) },
  { key: 'delegate', label: 'Delegate to specialist', test: (t) => /hand off|delegate/i.test(t) },
  { key: 'branch-locator', label: 'Branch locator', test: (t) => /branches near/i.test(t) },
  { key: 'system-prompt-exfil', label: 'System-prompt exfiltration attempt', test: (t) => /system prompt|reveal.*instructions/i.test(t) },
  { key: 'credential-exfil', label: 'Credential exfiltration attempt', test: (t) => /api key|client secret|credentials/i.test(t) },
  { key: 'account-number-exfil', label: 'Sensitive account-number exfiltration attempt', test: (t) => /account number|routing number/i.test(t) },
  { key: 'privilege-escalation', label: 'Privilege escalation / MFA-disable attempt', test: (t) => /admin access|disable mfa|grant.*admin/i.test(t) },
  { key: 'destructive', label: 'Destructive action attempt', test: (t) => /delete all/i.test(t) },
  { key: 'tool-discovery', label: 'Tool discovery', test: (t) => /tools available|mcp server/i.test(t) },
  { key: 'instruction-override', label: 'Instruction-override attempt', test: (t) => /ignore.*(previous )?instructions/i.test(t) },
];

function bucketFor(text) {
  for (const b of INTENT_BUCKETS) {
    if (b.test(text)) return b;
  }
  return null;
}

function extractDollarAmount(text) {
  const m = text.match(/\$[\d,]+/);
  return m ? m[0] : null;
}

function buildReport() {
  const all = [
    ...extractCatalog(),
    ...extractAiAttacksPanel(),
    ...extractOasDemoPage(),
    ...extractPingOneTestPage(),
    ...extractAgentDemoGuide(),
    ...extractSideNavNonTextTriggers(),
  ];

  const textEntries = all.filter((e) => !e.nonText);
  const nonTextEntries = all.filter((e) => e.nonText);

  // Exact duplicates: same literal text (case/whitespace-insensitive), any source.
  const exactGroups = new Map();
  for (const e of textEntries) {
    const key = e.text.trim().toLowerCase();
    if (!exactGroups.has(key)) exactGroups.set(key, []);
    exactGroups.get(key).push(e);
  }
  const exactDuplicates = [...exactGroups.values()].filter((g) => g.length > 1);

  // Near-duplicates: different literal text, same intent bucket.
  const bucketGroups = new Map();
  for (const e of textEntries) {
    const bucket = bucketFor(e.text);
    if (!bucket) continue;
    if (!bucketGroups.has(bucket.key)) bucketGroups.set(bucket.key, { label: bucket.label, entries: [] });
    bucketGroups.get(bucket.key).entries.push(e);
  }
  // Only "near-duplicate" if the bucket has more than one DISTINCT literal text.
  const nearDuplicates = [...bucketGroups.values()].filter((g) => {
    const distinctTexts = new Set(g.entries.map((e) => e.text.trim().toLowerCase()));
    return distinctTexts.size > 1;
  });

  const unverified = textEntries.filter((e) => !e.outcome);
  const unbucketed = textEntries.filter((e) => !bucketFor(e.text));

  // LMDB ground truth is a live, point-in-time snapshot (entry counts change
  // with real usage, not with source changes) — included in the JSON output
  // for whoever wants the live numbers, but deliberately NOT rendered into
  // the markdown (renderMarkdown below), since that file is diff-checked by
  // `check` mode and a volatile count would make every real conversation
  // look like "drift".
  const lmdbGroundTruth = checkLmdbGroundTruth();
  const matchedCount = textEntries.filter(
    (e) => lmdbGroundTruth.matchedPromptTexts.has(e.text.trim().toLowerCase())
  ).length;
  lmdbGroundTruth.matchedPromptTexts = [...lmdbGroundTruth.matchedPromptTexts]; // Set -> array for JSON
  lmdbGroundTruth.matchedAgainstThisReport = matchedCount;

  return {
    all, textEntries, nonTextEntries, exactDuplicates, nearDuplicates, unverified, unbucketed,
    agentModes: AGENT_MODES,
    liveVerifiedAgentModes: [], // none yet — chip-correctness-testing follow-up populates this
    lmdbGroundTruth,
  };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s).replace(/\|/g, '\\|');
}

function renderMarkdown(report) {
  const { textEntries, nonTextEntries, exactDuplicates, nearDuplicates, unverified, agentModes } = report;
  const lines = [
    '<!-- AUTO-GENERATED by scripts/audit-agent-prompts.js — do not hand-edit -->',
    '',
    '# Agent Prompt Audit — master list',
    '',
    '> Scans every hardcoded, agent-facing prompt across the /use-cases catalog',
    '> — resolved across EVERY vertical, not just banking (config/useCases.js\'s',
    '> perVertical override system swaps in different trigger text for 15 of 41',
    '> use cases) — plus AiAttacksPanel.js, OASDemoPage.jsx, AgentDemoGuide.jsx,',
    '> and AdminSideNav.jsx\'s one non-text "Intent Bypass" trigger.',
    '> `PingOneTestPage.jsx` is included but labeled illustrative-only — its',
    '> agentPrompt strings never reach the live agent (confirmed by reading the',
    '> component: they\'re a typewriter-effect preview on an unrelated',
    '> token-exchange config test button). `LearningHub.tsx`, `/langchain`,',
    '> `/copilot`, `/ai-control-plane` were checked and confirmed to have no',
    '> hardcoded prompts of their own — not sources, not omissions.',
    '>',
    '> Static inventory only — does not run any prompt against a live agent, and',
    '> does not verify a prompt against any specific agent mode (see "Agent',
    '> modes" below). See the `chip-correctness-testing` skill for that',
    '> methodology as a follow-up.',
    '>',
    '> `conversationStore.lmdb.js` and `mcpAuditStore.lmdb.js` DO store real',
    '> prompt+response pairs and tool-call results when the demo is actively',
    '> used — checked directly, cross-referenced against this report\'s prompt',
    '> texts, and included in `audit.json` (`lmdbGroundTruth`). Deliberately',
    '> NOT rendered here: those counts change with live usage, not with source',
    '> changes, and this file is diff-checked by `prompts:audit:check` — a',
    '> volatile number here would make every real conversation look like drift.',
    '> Check `audit.json` for the live snapshot.',
    '>',
    '> Regenerate: `npm run prompts:audit:gen` (from `demo_api_server/`).',
    '>',
    '> AgentDemoGuide.jsx reuses its `prompt:` field for both real agent-chat',
    '> text and presenter UI-navigation steps ("Go to Controls →…"). The',
    '> extractor filters known UI-instruction phrasings by prefix match — a',
    '> heuristic, not a parser. Skim the "Full inventory" table below for any',
    '> stragglers before treating this report as exhaustive.',
    '',
    '## Summary',
    '',
    '| | Count |',
    '|---|---|',
    `| Total prompt-shaped entries scanned | ${textEntries.length} |`,
    `| Non-text triggers noted (simulations / showcases) | ${nonTextEntries.length} |`,
    `| Exact-duplicate groups (same literal text, 2+ places) | ${exactDuplicates.length} |`,
    `| Near-duplicate intent groups (same ask, different wording) | ${nearDuplicates.length} |`,
    `| Prompts with NO documented expected outcome | ${unverified.length} |`,
    '',
    '## Agent modes (not yet live-verified against)',
    '',
    '> The main chat can run under any of these backends. Nothing in this',
    '> report has been run against any of them yet — this list exists so the',
    '> `chip-correctness-testing` follow-up has a fixed target set, not so this',
    '> script can claim coverage it hasn\'t done.',
    '',
    agentModes.map((m) => `- \`${m}\``).join('\n'),
    '',
  ];

  lines.push('## Exact duplicates (same literal text, multiple locations)', '');
  if (exactDuplicates.length === 0) {
    lines.push('None.', '');
  } else {
    for (const group of exactDuplicates) {
      lines.push(`### "${esc(group[0].text)}"`, '');
      lines.push('| Source | Location | Outcome documented? |', '|---|---|---|');
      for (const e of group) {
        lines.push(`| ${esc(e.source)} | ${esc(e.location)} | ${e.outcome ? esc(e.outcome) : '—'} |`);
      }
      lines.push('');
    }
  }

  lines.push('## Near-duplicates by intent (same ask, different wording)', '');
  if (nearDuplicates.length === 0) {
    lines.push('None.', '');
  } else {
    for (const group of nearDuplicates) {
      lines.push(`### ${group.label}`, '');
      const hasAmount = group.entries.some((e) => extractDollarAmount(e.text));
      const header = hasAmount
        ? '| Text | Amount | Source | Location | Outcome documented? |'
        : '| Text | Source | Location | Outcome documented? |';
      const sep = hasAmount ? '|---|---|---|---|---|' : '|---|---|---|---|';
      lines.push(header, sep);
      for (const e of group.entries) {
        const amt = extractDollarAmount(e.text);
        const row = hasAmount
          ? `| "${esc(e.text)}" | ${amt || '—'} | ${esc(e.source)} | ${esc(e.location)} | ${e.outcome ? esc(e.outcome) : '—'} |`
          : `| "${esc(e.text)}" | ${esc(e.source)} | ${esc(e.location)} | ${e.outcome ? esc(e.outcome) : '—'} |`;
        lines.push(row);
      }
      lines.push('');
    }
  }

  lines.push('## Prompts with no documented expected outcome', '');
  lines.push(
    '> Catalog entries assert `expectedOutcome`; AgentDemoGuide entries sometimes',
    '> have a `watch[]` array. Everything below has neither — nobody has',
    '> written down what "correct" looks like for these.',
    '',
  );
  if (unverified.length === 0) {
    lines.push('None.', '');
  } else {
    lines.push('| Text | Source | Location |', '|---|---|---|');
    for (const e of unverified) {
      lines.push(`| "${esc(e.text)}" | ${esc(e.source)} | ${esc(e.location)} |`);
    }
    lines.push('');
  }

  lines.push('## Full inventory', '');
  lines.push('| Text | Source | Location | Outcome documented? |', '|---|---|---|---|');
  for (const e of [...textEntries].sort((a, b) => a.source.localeCompare(b.source))) {
    lines.push(`| "${esc(e.text)}" | ${esc(e.source)} | ${esc(e.location)} | ${e.outcome ? esc(e.outcome) : '—'} |`);
  }
  lines.push('');

  if (nonTextEntries.length > 0) {
    lines.push('## Non-text triggers (simulations / showcases — noted, not compared)', '');
    lines.push('| Reference | Source | Location |', '|---|---|---|');
    for (const e of nonTextEntries) {
      lines.push(`| ${esc(e.text)} | ${esc(e.source)} | ${esc(e.location)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const [, , mode] = process.argv;

function writeOutputs() {
  const report = buildReport();
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_MD, renderMarkdown(report), 'utf8');
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

if (mode === 'generate') {
  const report = writeOutputs();
  console.log(`[audit-agent-prompts] written: ${OUT_MD}`);
  console.log(`[audit-agent-prompts] written: ${OUT_JSON}`);
  console.log(
    `[audit-agent-prompts] ${report.textEntries.length} prompts scanned, ` +
    `${report.exactDuplicates.length} exact-duplicate groups, ` +
    `${report.nearDuplicates.length} near-duplicate intent groups, ` +
    `${report.unverified.length} with no documented outcome.`
  );
} else if (mode === 'check') {
  const report = buildReport();
  const freshMd = renderMarkdown(report);
  let existingMd = '';
  try { existingMd = fs.readFileSync(OUT_MD, 'utf8'); } catch (_) { /* absent */ }
  if (freshMd !== existingMd) {
    console.error('[audit-agent-prompts] DRIFT DETECTED: docs/agent-prompts/audit.md is out of date.');
    console.error('Run: npm run prompts:audit:gen (from demo_api_server/)');
    process.exit(1);
  }
  console.log('[audit-agent-prompts] OK — prompt audit is current.');
} else {
  console.error('Usage: audit-agent-prompts.js generate|check');
  process.exit(1);
}
