#!/usr/bin/env node
'use strict';

/**
 * Master list of every literal, agent-facing prompt hardcoded across the demo:
 * the /use-cases catalog plus four scattered UI sources that separately fire
 * text at the live agent (AiAttacksPanel, OASDemoPage, PingOneTestPage,
 * AgentDemoGuide). Groups near-duplicate intents (same ask, different wording)
 * so additions don't silently pile up more variants of "check my balance" or
 * "transfer $X" — and flags which prompts have no documented expected outcome
 * at all, since only the catalog's `expectedOutcome` and AgentDemoGuide's
 * `watch[]` array assert anything about what should happen.
 *
 * This is a STATIC inventory only — it does not run any prompt against a live
 * agent. See the `chip-correctness-testing` skill for the live-verification
 * methodology as a follow-up once this report shows what's worth checking.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT_MD = path.join(ROOT, 'docs/agent-prompts/audit.md');
const OUT_JSON = path.join(ROOT, 'docs/agent-prompts/audit.json');

const { USE_CASES } = require(path.join(ROOT, 'demo_api_server/config/useCases'));

// ---------------------------------------------------------------------------
// Extraction — one function per source, each returning PromptEntry[]:
//   { text, source, location, outcome }
// `outcome` is whatever that source documents about the expected result, or
// null if the source has no such field at all.
// ---------------------------------------------------------------------------

function extractCatalog() {
  const entries = [];
  for (const uc of USE_CASES) {
    const t = uc.trigger || {};
    if (t.type === 'chip' && t.text) {
      entries.push({
        text: t.text,
        source: 'catalog (chip)',
        location: uc.id,
        outcome: uc.expectedOutcome || null,
      });
    } else if (t.type === 'attack' && t.sim) {
      // Not free text — a backend simulation id. Recorded separately so the
      // report doesn't silently drop these, but excluded from text-based
      // duplicate grouping since there's no wording to compare.
      entries.push({
        text: `[simulation: ${t.sim}]`,
        source: 'catalog (attack-sim)',
        location: uc.id,
        outcome: uc.expectedOutcome || null,
        nonText: true,
      });
    }
  }
  return entries;
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
      source: 'PingOneTestPage.jsx',
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

  return { all, textEntries, nonTextEntries, exactDuplicates, nearDuplicates, unverified, unbucketed };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s).replace(/\|/g, '\\|');
}

function renderMarkdown(report) {
  const { textEntries, nonTextEntries, exactDuplicates, nearDuplicates, unverified } = report;
  const lines = [
    '<!-- AUTO-GENERATED by scripts/audit-agent-prompts.js — do not hand-edit -->',
    '',
    '# Agent Prompt Audit — master list',
    '',
    '> Scans every hardcoded, agent-facing prompt across the /use-cases catalog',
    '> and four scattered UI sources. Static inventory only — does not run any',
    '> prompt against a live agent (see the `chip-correctness-testing` skill for',
    '> that as a follow-up).',
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
