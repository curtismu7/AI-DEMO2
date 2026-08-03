#!/usr/bin/env node
'use strict';
/*
 * check-vertical-coercion.js — behavioural gate against cross-vertical coercion.
 *
 * WHY THIS EXISTS
 * Seven separate code paths silently coerced a prompt's vertical to `banking`,
 * so healthcare, government and investment sessions were served bank account
 * chips. Each was found by hand, one at a time (#1214, #1228, #1232). Seven
 * instances of one shape means the next contributor writes the eighth. This
 * gate exists so an eighth cannot merge.
 *
 * A grep for the string 'banking' would be brittle and would fire on legitimate
 * code. So this drives the REAL resolution path — services/fallbackDataResolver
 * and config/fallback-chips/loader, unmocked — over a prompt corpus derived from
 * the vertical manifests, and asserts the invariant:
 *
 *   THE INVARIANT
 *   For any prompt, resolution returns either the ACTIVE vertical or an explicit
 *   no-match. It never returns a different vertical's identity, chips, or tools.
 *
 * Verticals are enumerated from config/verticals/<id>/manifest.json (the same
 * `dashboard.chips10` convention gen-intent-topology.js readChips() uses), and
 * the "routes cleanly" corpus is those manifests' own chip messages — so a newly
 * added vertical is covered the moment its manifest lands. That is the point.
 *
 * WHAT IT CANNOT SEE
 * The fallback/heuristic resolution path, plus the agent path's read-tool
 * selection (readPrimaryToolFor). The LLM dispatch loop itself, tool EXECUTION
 * (verticalDispatch, #1250), session pinning (routes/demoAgentNl.js, #1257) and
 * the UI's client-dispatched chips resolve elsewhere and are NOT covered here —
 * each has its own tests.
 *
 * PINNED EXCEPTIONS
 * Behaviour that is wrong-shaped but pre-existing and still an open product
 * decision is PINNED, not failed — see PINNED_* below. A pin is checked in both
 * directions: an unpinned coercion fails as new, and a pin that stops
 * reproducing fails as stale so it cannot silently outlive the behaviour it
 * describes. An accepted exception that is visible is fine; one that is
 * invisible is how these got in.
 *
 * Usage:
 *   node demo_api_server/scripts/check-vertical-coercion.js     # exit 1 on any violation
 *   npm --prefix demo_api_server run coercion:check
 *
 * Wired into `npm run hygiene:check` at the repo root, which CI runs as a
 * blocking gate after installing demo_api_server deps.
 */

const fs = require('node:fs');
const path = require('node:path');

const { resolveFallbackChips } = require('../services/fallbackDataResolver');
// VALID_VERTICAL_RE is imported, not re-declared: it is the shape check that
// decides whether a bogus id can reach the agent path at all, and a local copy
// would drift from the one that actually gates requests.
const { parseForFallback, VALID_VERTICAL_RE } = require('../services/nlIntentParser');
const { loadFallbackChips, FALLBACK_CHIPS } = require('../config/fallback-chips/loader');

const VERTICALS_DIR = path.join(__dirname, '..', 'config', 'verticals');

// ── Corpus ────────────────────────────────────────────────────────────────────

/*
 * Teaching / protocol prompts. These belong to NO vertical: they open an
 * education panel or dispatch a web search, read no vertical's data and appear
 * in no vertical's manifest. Two of the seven coercions lived exactly here —
 * parseForFallback's education branch (#1228) and parseBanking's trailing
 * web_search catch-all (#1232) both tagged their hits vertical:'banking'.
 *
 * Both branches are represented deliberately. parseBanking runs FIRST, so a
 * prompt it claims never reaches parseEducation; covering only one phrasing
 * would leave the other fix ungated.
 */
const TEACHING_PROMPTS = [
  // reach parseBanking's web_search catch-all (#1232)
  'what is par',
  'what is step-up mfa',
  'what is dpop',
  'what is a jwt',
  'who is ada lovelace',
  'what is the capital of france',
  // reach parseEducation (#1228)
  'explain pkce',
  'what is token exchange',
  'explain rfc 8693',
  'what is ciba',
];

/*
 * Activity-analysis phrasings — the shape that matches ACTIVITY_ANALYSIS_RE in
 * services/demoAgentLangGraphService.js. Kept as its own corpus segment because
 * this is the prompt shape that demonstrably shipped one vertical's DATA into
 * another's session (see KNOWN_UNFIXED_COERCIONS).
 */
const ACTIVITY_ANALYSIS_PROMPTS = [
  'spot any unusual activity',
  'any suspicious charges',
  'check for irregular orders',
  'anything anomalous in my records',
];

/** Prompts that route nowhere: no vertical may be invented for them. */
const NOWHERE_PROMPTS = [
  'asdfghjkl qwerty',
  'zzzz plugh xyzzy',
  '!!!???',
  '',
];

/*
 * Vertical ids that must never resolve to a real vertical's chips. The bare
 * `undefined` entry is the one that matters most: loadFallbackChips once carried
 * a `= 'banking'` DEFAULT PARAMETER, which no prompt can reach through the
 * resolver — only a direct call exposes it.
 */
const BOGUS_VERTICAL_IDS = [undefined, null, '', '   ', 'not-a-vertical', 'constructor', '__proto__', 'toString', 'BANKING '];

// ── Pinned exceptions ─────────────────────────────────────────────────────────

/*
 * SETTLED — was PINNED_BANKING_ACTION_WINS, now an assertion.
 *
 * The pin recorded an open product decision: parseForFallback tagged a genuine
 * banking ACTION vertical:'banking' whatever the active vertical was, so `show
 * my balance` typed in healthcare resolved to banking. The pin said "that is
 * arguably correct, and if it is ever decided that the active vertical must
 * win, THIS GATE is the place that changes".
 *
 * It has been decided: the ACTIVE VERTICAL WINS, symmetrically. Only the active
 * vertical's own patterns resolve; every other vertical's — banking's included
 * — must not. So these two rows flipped from pinned exceptions to asserted
 * behaviour, which is strictly stronger than the pin was: instead of recording
 * that the resolver switches verticals, the gate now fails if it ever does
 * again.
 *
 * Both must reach an explicit NO-MATCH rather than merely keeping the id. The
 * distinction is the whole point of the decision: a government session asking
 * for a transfer must be TOLD government has no such action, not quietly handed
 * government's chips as though something matched.
 */
const SETTLED_ACTIVE_VERTICAL_WINS = [
  { activeVertical: 'healthcare', prompt: 'show my balance' },
  { activeVertical: 'government', prompt: 'transfer $100 from checking to savings' },
];

/*
 * FIXED — the list is now EMPTY, and every one of the 123 chip messages is
 * ASSERTED to keep the active vertical in all 13 of them.
 *
 * This list held 52 entries covering TWO defects. #1261 fixed the cascade and
 * deleted 32. The remaining 20 were one class: a genuine banking ACTION —
 * transactions x6, transfer x5, balance x4, accounts x3, mortgage_demo,
 * sensitive_account_details — outranking the active vertical because the
 * phrasing overlaps banking's ("pto balance", "order history", "transfer my
 * membership"). That was the open product decision, not a bug, so they stayed.
 *
 * The decision is settled: the ACTIVE VERTICAL WINS, symmetrically. A banking
 * action is BANKING'S OWN pattern and may only win where banking is active, or
 * where no vertical is — exactly the rule #1261 applied to retail's \borders?\b.
 * Verified per row through the production resolver: each prompt now keeps its
 * OWN vertical (retail's "order history" -> retail, workforce's "pto balance"
 * -> workforce, admin's "adjust account balance" -> admin) while banking's own
 * claim is untouched inside banking and with no vertical active.
 *
 * Emptied rather than deleted so the stale-pin check below stays wired: an
 * entry here is the documented way to record an accepted coercion, and with
 * none, C6 fails on any vertical switch at all.
 */
const PINNED_CASCADE_COERCIONS = [];

/*
 * KNOWN-UNFIXED — NOT ACCEPTED, NOT A PIN.
 *
 * A pin above says "this is arguably correct and the decision is open". These
 * say "this is a bug, confirmed live, still on main". The gate does not exit 1
 * on them for one reason only: they are ALREADY on main, and a gate that is red
 * on main gets deleted within a day (#1223 -> #1239 is the local precedent). So
 * they are listed, and every PASSING run prints them as a ⚠️ block, which is the
 * opposite of the silence that let seven of these accumulate.
 *
 * FIXED — the list is now EMPTY. Sites 8 and 9 (the agent-path `|| banking`
 * defaults) went with #1250 and #1257. The last three entries were the parser
 * cascade itself, the root cause those two did not address, and it is now fixed
 * in nlIntentParser.js:
 *   - 'spot any unusual activity' and 'any suspicious charges' hit
 *     parseBanking's unusual_patterns, whose own declaration says the
 *     sec_llm_analyze chip "ships this exact text in EVERY vertical manifest"
 *     and must resolve the same way "regardless of vertical". It no longer
 *     carries a banking claim, so the active vertical stands. This also makes
 *     the fallback path agree with the agent path, which #1257 had already
 *     pointed at the ACTIVE vertical's read tool.
 *   - 'check for irregular orders' was taken by the retail keyword branch's
 *     \borders?\b. That branch now only guesses when no vertical is active.
 *
 * The list is emptied rather than deleted so the stale-pin check below stays
 * wired: with it empty, every ACTIVITY_ANALYSIS_PROMPT is now ASSERTED to keep
 * the active vertical instead of merely being reported — strictly stronger than
 * the entries were. Re-adding a key here is the documented way to record a
 * regression if one is ever accepted again.
 *
 * 'anything anomalous in my records' was already absent and stays that way: it
 * kept the active vertical even before this fix, so it has always been a
 * POSITIVE case in the corpus rather than a pre-excused one.
 */
const KNOWN_UNFIXED_COERCIONS = [];

/*
 * FIXED — readPrimaryToolFor() now guards the lookup with hasOwnProperty,
 * matching loadFallbackChips(). The list is emptied rather than deleted so the
 * stale-pin check below stays wired: if the guard is ever reverted, re-adding
 * the key here is the documented way to record it.
 *
 * With the list empty, 'constructor' and 'toString' are no longer excluded from
 * the bogus-id sweep above, so they are now asserted to select NO tool rather
 * than merely reported — strictly stronger than the pin was.
 *
 * Correction to the pin's original note: the readPrimaryToolFor path is reached
 * via POST /api/demo-agent/message, not /nl. /nl was hitting a SEPARATE instance
 * of the same missing-guard class in FEATURE_TRIGGERS, where it was a hard 500.
 *
 * Three sibling lookups carried the same defect and were guarded at the same
 * time: FEATURE_TRIGGERS (nlIntentParser, HTTP 500),
 * INTENT_TO_PERMITTED_TOOLS (intentTokenService — minted an Intent Token whose
 * permitted_tools claim was dropped entirely by JSON.stringify), and
 * THEME_OVERRIDES (geminiNlIntent — native-code source concatenated into the
 * LLM system prompt).
 *
 * CORRECTION — an earlier revision of this comment claimed "every consumer reads
 * absent as unrestricted". That is FALSE, and the opposite of the truth: the
 * dropped claim is FAIL-CLOSED. Both gateways test membership with a list check
 * that an absent claim fails —
 * `Array.isArray(payload.permitted_tools) && …includes(toolName)`
 * (demo_mcp_gateway/src/intentTokenValidator.ts:99-100) and
 * `(permitted instanceof List) && permitted.contains(toolName)`
 * (ping-gateway/scripts/groovy/p1az-decision.groovy:434). Both yield false, so
 * IntentMatchesTool='false' with IntentTokenValid='true', which is exactly the
 * authz server's Rule 4b DENY (demo_authz_server/routes/decision.js:954). The
 * BFF holds NO local permitted_tools enforcement; its `?? []` reads
 * (routes/agentRun.js:288, routes/agentInvokeRoute.js:256,
 * services/agentMcpTokenService.js:276) are Token Chain DISPLAY payloads only.
 * The damage was a denied call plus an empty permitted-tools list in the rail —
 * a fidelity bug on a fail-closed path, not an authz bypass. Do not restore the
 * "unrestricted" reading: it overstates the severity and would justify a panic
 * fix on a control that was holding.
 */
const KNOWN_UNFIXED_PROTOTYPE_LOOKUP = [];

/*
 * PINNED: fallback chips whose tool is declared in ANOTHER vertical's manifest
 * and not in their own. `<vertical>:<chipId>:<tool>`. Pre-existing drift in the
 * older fallback-chip modules; listed so it cannot grow silently.
 */
const PINNED_FOREIGN_TOOLS = [
  'sporting-goods:sg1:list_orders',
  'sporting-goods:sg-direct:list_orders',
];

// ── Manifest reading ──────────────────────────────────────────────────────────

/**
 * Every vertical that carries chips, with its manifest. Verticals with an empty
 * or absent dashboard.chips10 (admin-console) are omitted — they have no
 * prompts and no identity to confuse. Same convention as
 * scripts/gen-intent-topology.js readChips().
 * @returns {Array<{vertical: string, manifest: object, chips: object[]}>}
 */
function readVerticals() {
  let dirs = [];
  try { dirs = fs.readdirSync(VERTICALS_DIR); } catch (_e) { dirs = []; }
  const out = [];
  for (const vertical of dirs.sort()) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(VERTICALS_DIR, vertical, 'manifest.json'), 'utf8'));
    } catch (_e) { continue; }
    // NESTED. manifest.chips10 does not exist; reading it finds zero for every
    // vertical and the gate reports a clean, entirely fictional run.
    const chips = (manifest.dashboard && manifest.dashboard.chips10) || [];
    if (!chips.length) continue;
    out.push({ vertical, manifest, chips });
  }
  return out;
}

/**
 * Every vertical that has a manifest at all, chips or not. The per-vertical tool
 * maps are keyed by vertical id, not by "vertical that carries chips", and
 * admin-console — the one a live probe caught being served banking data — has a
 * manifest and no chips10, so readVerticals() would skip exactly the case that
 * shipped.
 * @returns {string[]}
 */
function readAllManifestVerticals() {
  let dirs = [];
  try { dirs = fs.readdirSync(VERTICALS_DIR); } catch (_e) { dirs = []; }
  return dirs.sort().filter((v) => fs.existsSync(path.join(VERTICALS_DIR, v, 'manifest.json')));
}

/** Tools a manifest declares: chip tool, chip denyTool, featurePage.mcpTool. */
function manifestToolSet(entry) {
  const s = new Set();
  for (const c of entry.chips) {
    if (c.tool) s.add(c.tool);
    if (c.denyTool) s.add(c.denyTool);
  }
  const fp = entry.manifest.featurePage;
  if (fp && fp.mcpTool) s.add(fp.mcpTool);
  return s;
}

// ── Findings ──────────────────────────────────────────────────────────────────

const failures = [];
const fail = (check, detail) => failures.push({ check, detail });

/** Known-unfixed entries observed reproducing this run — printed, not failed. */
const knownUnfixedSeen = [];
const knownUnfixed = (detail) => knownUnfixedSeen.push(detail);

const idsOf = (chips) => (chips || []).map((c) => c.id);
const toolsOf = (chips) => [...new Set((chips || []).map((c) => c.tool).filter(Boolean))].sort();
const q = (s) => (s === '' ? '(empty string)' : JSON.stringify(s));

// ── Checks ────────────────────────────────────────────────────────────────────

/**
 * C1 — the loader never substitutes another vertical's chips.
 * Catches BOTH loader coercions: the `= 'banking'` default parameter (which no
 * prompt can reach, so only a direct call proves it) and the unknown-vertical
 * branch that returned FALLBACK_CHIPS.banking.
 */
async function checkLoaderNeverSubstitutes(verticals) {
  for (const id of BOGUS_VERTICAL_IDS) {
    const chips = await loadFallbackChips(id);
    if (chips && chips.length) {
      const looksLike = Object.keys(FALLBACK_CHIPS).find((v) => FALLBACK_CHIPS[v] === chips);
      fail('loader-never-substitutes',
        `loadFallbackChips(${q(id)}) returned ${chips.length} chips` +
        `${looksLike ? ` — they are ${looksLike}'s` : ''}. It must return null: a vertical id that names no chip set has no chips, and substituting another vertical's is how bank account actions reached healthcare.`);
    }
  }
  // A manifest vertical with no fallback module of its own must also get null,
  // not a stand-in.
  for (const { vertical } of verticals) {
    if (Object.prototype.hasOwnProperty.call(FALLBACK_CHIPS, vertical)) continue;
    const chips = await loadFallbackChips(vertical);
    if (chips && chips.length) {
      fail('loader-never-substitutes',
        `loadFallbackChips('${vertical}') returned ${chips.length} chips, but ${vertical} has no fallback-chip module. Those chips belong to another vertical.`);
    }
  }
}

/**
 * C2 — with no active vertical, an unroutable or teaching prompt must produce an
 * explicit no-match, never an invented vertical.
 *
 * Catches fallbackDataResolver's `intent.vertical || 'banking'`, and catches the
 * education (#1228) and web_search (#1232) tags independently of which vertical
 * is active — a coercion to banking is invisible while banking is active.
 */
async function checkNoVerticalIsNotInvented() {
  for (const prompt of [...NOWHERE_PROMPTS, ...TEACHING_PROMPTS]) {
    const r = await resolveFallbackChips(prompt, {});
    if (r.verticalId !== null || !r.noMatch || (r.chips || []).length) {
      fail('no-vertical-is-not-invented',
        `prompt ${q(prompt)} with NO active vertical resolved to verticalId=${JSON.stringify(r.verticalId)} with ${(r.chips || []).length} chips (noMatch=${!!r.noMatch}). It must be an explicit no-match with verticalId null — this prompt names no vertical, so no vertical may be invented for it.`);
    }
  }
}

/**
 * C3 — a teaching/protocol prompt keeps the ACTIVE vertical.
 * The resolver-level half of the #1228 / #1232 nets: "what is par" typed in
 * investment must stay investment.
 */
async function checkTeachingKeepsActiveVertical(verticals) {
  for (const { vertical } of verticals) {
    for (const prompt of TEACHING_PROMPTS) {
      const r = await resolveFallbackChips(prompt, { verticalId: vertical });
      if (r.verticalId !== vertical) {
        fail('teaching-keeps-active-vertical',
          `prompt ${q(prompt)} in the '${vertical}' vertical resolved to '${r.verticalId}'. Teaching and protocol prompts belong to no vertical, so the active one must stand.`);
      }
    }
  }
}

/**
 * C4 — when the parser throws, the active vertical survives.
 * The resolver's catch block once resolved every thrown error to banking.
 * Object.create(null) has no prototype, so String() on it throws inside the
 * parser's norm() — a real, unmocked error on the production path.
 */
async function checkParseErrorKeepsActiveVertical(verticals) {
  const hostile = () => Object.create(null);

  // The resolver's catch block warns on every one of these. Capturing the
  // warnings keeps a PASSING run's output clean, and counting them proves the
  // catch block is what ran — without it this check could pass because the
  // parser quietly stopped throwing, testing nothing.
  const realWarn = console.warn;
  let caught = 0;
  console.warn = (msg) => { if (String(msg).includes('[fallback] Intent detection failed')) caught += 1; };

  try {
    await runParseErrorProbes(verticals);
  } finally {
    console.warn = realWarn;
  }

  const expected = verticals.length + 1;
  if (caught !== expected) {
    fail('parse-error-keeps-active-vertical',
      `the hostile prompt reached the resolver's catch block ${caught} time(s), expected ${expected}. It no longer forces a parse error, so this check proves nothing about the error path — give it an input the parser still throws on.`);
  }
}

async function runParseErrorProbes(verticals) {
  const hostile = () => Object.create(null);

  for (const { vertical } of verticals) {
    const r = await resolveFallbackChips(hostile(), { verticalId: vertical });
    if (r.verticalId !== vertical || (r.chips || []).length) {
      fail('parse-error-keeps-active-vertical',
        `a prompt that makes the parser throw, in the '${vertical}' vertical, resolved to verticalId=${JSON.stringify(r.verticalId)} with ${(r.chips || []).length} chips. A failed parse proves nothing about the vertical, so it must degrade to a no-match on '${vertical}' — not to another vertical's chips.`);
    }
  }

  const none = await resolveFallbackChips(hostile(), {});
  if (none.verticalId !== null || (none.chips || []).length) {
    fail('parse-error-keeps-active-vertical',
      `a prompt that makes the parser throw with NO active vertical resolved to verticalId=${JSON.stringify(none.verticalId)} with ${(none.chips || []).length} chips. It must be a no-match with verticalId null.`);
  }
}

/**
 * C5 — identity and payload agree.
 * A correct verticalId with another vertical's chips attached is exactly the bug
 * that shipped, so the returned chips and tools are asserted, not just the id.
 * This check is never pinned: whatever vertical a result claims, the payload
 * must be that vertical's own.
 */
function checkResultCoherence(result, byVertical, context) {
  const chips = result.chips || [];
  const claimed = result.verticalId;

  if (result.noMatch) {
    if (chips.length) {
      fail('identity-payload-coherence',
        `${context}: a no-match carried ${chips.length} chips. A no-match must carry none — a caller that renders the list would show foreign data.`);
    }
    const own = new Set(claimed && byVertical[claimed] ? idsOf(byVertical[claimed].chips) : []);
    for (const s of result.suggestions || []) {
      if (!own.has(s.id)) {
        fail('identity-payload-coherence',
          `${context}: a no-match on '${claimed}' suggested chip '${s.id}', which is not one of ${claimed}'s own dashboard.chips10. Suggestions must come from the vertical the result names.`);
      }
    }
    return;
  }

  if (!chips.length) return;

  const own = FALLBACK_CHIPS[claimed];
  if (!own) {
    fail('identity-payload-coherence',
      `${context}: resolved to '${claimed}' with ${chips.length} chips, but '${claimed}' has no fallback-chip module. Those chips belong to some other vertical.`);
    return;
  }
  const gotIds = idsOf(chips).join(',');
  const wantIds = idsOf(own).join(',');
  if (gotIds !== wantIds) {
    const actualOwner = Object.keys(FALLBACK_CHIPS).find((v) => idsOf(FALLBACK_CHIPS[v]).join(',') === gotIds);
    fail('identity-payload-coherence',
      `${context}: claims verticalId '${claimed}' but carries chips [${gotIds}]${actualOwner ? ` — those are ${actualOwner}'s` : ''}. Expected ${claimed}'s own [${wantIds}].`);
  }
  const gotTools = toolsOf(chips).join(',');
  const wantTools = toolsOf(own).join(',');
  if (gotTools !== wantTools) {
    fail('identity-payload-coherence',
      `${context}: claims verticalId '${claimed}' but carries tools [${gotTools}]. Expected ${claimed}'s own [${wantTools}].`);
  }
}

/**
 * C6 — the chip-message corpus, every vertical against every vertical.
 * Runs each manifest's own chip messages in its own vertical (they must route
 * cleanly) and in every other vertical (they must not steal it). Any vertical
 * switch must be a pinned, pre-existing cascade coercion.
 */
async function checkChipMessageCorpus(verticals, byVertical) {
  const pinned = new Map(PINNED_CASCADE_COERCIONS);
  const reproduced = new Set();

  const prompts = [];
  const seen = new Set();
  for (const { vertical, chips } of verticals) {
    for (const chip of chips) {
      const message = chip.message || chip.label;
      if (!message || seen.has(message)) continue;
      seen.add(message);
      prompts.push({ message, owner: vertical, chipId: chip.id });
    }
  }

  for (const { vertical } of verticals) {
    for (const { message, owner, chipId } of prompts) {
      const r = await resolveFallbackChips(message, { verticalId: vertical });
      const where = owner === vertical ? `its OWN vertical` : `the '${vertical}' vertical`;
      const context = `${q(message)} (${owner} chip ${chipId}) in ${where}`;

      checkResultCoherence(r, byVertical, context);

      if (r.verticalId === vertical) continue;

      if (pinned.get(message) === r.verticalId) {
        reproduced.add(message);
        continue;
      }
      fail('no-unearned-vertical-switch',
        `${context} resolved to '${r.verticalId}'. The active vertical must win, or the result must be an explicit no-match. If this is intended pre-existing behaviour, it has to be added to PINNED_CASCADE_COERCIONS in this file with a reason — an accepted exception is only acceptable while it is visible.`);
    }
  }

  for (const [message, target] of PINNED_CASCADE_COERCIONS) {
    if (reproduced.has(message)) continue;
    fail('stale-pin',
      `PINNED_CASCADE_COERCIONS still lists ${q(message)} -> '${target}', but that no longer happens. If the coercion was fixed, delete the line; if the prompt was removed from every manifest, delete the line. A pin that outlives its behaviour hides the next one.`);
  }
}

/**
 * C7 — prompts that route nowhere keep the active vertical and its own chips.
 */
async function checkNowherePrompts(verticals, byVertical) {
  for (const { vertical } of verticals) {
    for (const prompt of NOWHERE_PROMPTS) {
      const r = await resolveFallbackChips(prompt, { verticalId: vertical });
      const context = `unroutable prompt ${q(prompt)} in the '${vertical}' vertical`;
      checkResultCoherence(r, byVertical, context);
      if (r.verticalId !== vertical) {
        fail('no-unearned-vertical-switch',
          `${context} resolved to '${r.verticalId}'. Nothing in it names a vertical, so the active one must stand.`);
      }
    }
  }
}

/**
 * C7b — activity-analysis prompts, every vertical.
 * The prompt shape behind site 8. On the fallback path it resolves to banking
 * from every vertical, which is a KNOWN_UNFIXED_COERCIONS entry — reported, not
 * failed. A NEW vertical it starts stealing, or any change of target, fails.
 */
async function checkActivityAnalysisPrompts(verticals, byVertical) {
  const known = new Map(KNOWN_UNFIXED_COERCIONS);
  const reproduced = new Set();

  for (const { vertical } of verticals) {
    for (const prompt of ACTIVITY_ANALYSIS_PROMPTS) {
      const r = await resolveFallbackChips(prompt, { verticalId: vertical });
      const context = `activity-analysis prompt ${q(prompt)} in the '${vertical}' vertical`;
      checkResultCoherence(r, byVertical, context);

      if (r.verticalId === vertical) continue;
      if (known.get(prompt) === r.verticalId) { reproduced.add(prompt); continue; }
      fail('no-unearned-vertical-switch',
        `${context} resolved to '${r.verticalId}'. This is the prompt shape that shipped one vertical's data into another's session; a NEW target for it is a regression, not a variation.`);
    }
  }

  for (const [prompt, target] of KNOWN_UNFIXED_COERCIONS) {
    if (reproduced.has(prompt)) {
      knownUnfixed(`${q(prompt)} resolves to '${target}' from every vertical on the fallback path — the parser cascade, the root cause #1250/#1257 did not address.`);
      continue;
    }
    fail('stale-pin',
      `KNOWN_UNFIXED_COERCIONS still lists ${q(prompt)} -> '${target}', but that no longer happens. If it was fixed, delete the line and say so.`);
  }
}

/**
 * C7c — no vertical may resolve to ANOTHER vertical's read tool.
 *
 * This asserts the invariant, not the mechanism. The mechanism it replaces was
 * `READ_PRIMARY_TOOL_BY_VERTICAL[activeId] || 'get_my_transactions'`, which the
 * gate caught live on `airlines` (#1252 landed with no map entry, so the agent
 * ran banking's get_my_transactions in an airlines session). #1257 replaced it
 * with readPrimaryToolFor(), which returns null on a miss — so "absent from the
 * map" is now SAFE and demanding an entry per vertical would be hand-maintenance
 * of something the code no longer needs.
 *
 * What must stay true is ownership: drive the real readPrimaryToolFor() for
 * every vertical and derive tool -> owners from its own answers. A vertical that
 * declares none must select none; a tool claimed by two verticals means one of
 * them inherited the other's, which is precisely what a reintroduced
 * cross-vertical default looks like. A new vertical with no entry passes.
 */
function checkReadPrimaryToolOwnership() {
  const svc = require('../services/demoAgentLangGraphService');
  const readPrimaryToolFor = svc.__test && svc.__test.readPrimaryToolFor;
  if (typeof readPrimaryToolFor !== 'function') {
    fail('read-tool-belongs-to-its-own-vertical',
      'demoAgentLangGraphService.__test.readPrimaryToolFor is not exported, so the activity-analysis tool selection cannot be driven. If it was renamed, point this check at the new name — do not delete the check, the coercion it guards was live on main as recently as #1252.');
    return;
  }

  const owners = new Map();
  for (const vertical of readAllManifestVerticals()) {
    const tool = readPrimaryToolFor(vertical);
    if (!tool || typeof tool !== 'string') continue;
    if (!owners.has(tool)) owners.set(tool, []);
    owners.get(tool).push(vertical);
  }
  for (const [tool, vs] of owners) {
    if (vs.length < 2) continue;
    fail('read-tool-belongs-to-its-own-vertical',
      `readPrimaryToolFor() returns '${tool}' for ${vs.length} different verticals (${vs.join(', ')}). A read tool belongs to one vertical; more than one owner means the rest inherited it — the shape that ran banking's get_my_transactions inside an airlines session.`);
  }

  // A vertical id nothing owns must select NOTHING. A tool here is by definition
  // some other vertical's, since this id is not a vertical at all. The
  // prototype-chain ids are excluded and handled below: they return a function
  // or a plain object rather than a tool name, which is a different defect.
  const protoKeys = new Set(KNOWN_UNFIXED_PROTOTYPE_LOOKUP);
  const shapeValid = (v) => typeof v === 'string' && VALID_VERTICAL_RE.test(v) && !protoKeys.has(v);
  for (const bogus of BOGUS_VERTICAL_IDS.filter(shapeValid)) {
    const tool = readPrimaryToolFor(bogus);
    if (tool) {
      fail('read-tool-belongs-to-its-own-vertical',
        `readPrimaryToolFor(${q(bogus)}) selected '${tool}'. An id that names no vertical must select no tool, or an unknown slug inherits whichever vertical's data that tool reads.`);
    }
  }

  for (const key of KNOWN_UNFIXED_PROTOTYPE_LOOKUP) {
    const tool = readPrimaryToolFor(key);
    if (tool) {
      // NOT JSON.stringify: it renders a function as `undefined`, which is what
      // made 'constructor' look safe when it is not.
      const rendered = typeof tool === 'function' ? `[Function ${tool.name || 'anonymous'}]` : JSON.stringify(tool);
      const reach = VALID_VERTICAL_RE.test(key)
        ? 'REACHABLE — VALID_VERTICAL_RE accepts this id, so a request can supply it'
        : 'not reachable — VALID_VERTICAL_RE rejects this id';
      knownUnfixed(`readPrimaryToolFor(${q(key)}) returns ${rendered} via the prototype chain instead of null — a bare map[id] lookup with no hasOwnProperty guard (${reach}).`);
      continue;
    }
    fail('stale-pin',
      `KNOWN_UNFIXED_PROTOTYPE_LOOKUP still lists ${q(key)}, but readPrimaryToolFor now returns a falsy value for it. The guard landed — delete the line.`);
  }
}

/**
 * C8 — static shape of the fallback-chip map itself.
 * checkResultCoherence compares a result against FALLBACK_CHIPS[verticalId], so
 * it cannot see an aliased map: `healthcare: require('./banking')` would make
 * both sides agree. These checks anchor the map to the manifests instead.
 */
function checkFallbackModuleShape(verticals, byVertical) {
  const owners = new Map();
  const seenArrays = new Map();

  for (const [vertical, chips] of Object.entries(FALLBACK_CHIPS)) {
    if (!byVertical[vertical]) {
      fail('fallback-modules-not-aliased',
        `FALLBACK_CHIPS has an entry for '${vertical}', which is not a vertical with a manifest. It can only serve another vertical's data under a name nothing owns.`);
    }
    if (seenArrays.has(chips)) {
      fail('fallback-modules-not-aliased',
        `FALLBACK_CHIPS['${vertical}'] is the same array as FALLBACK_CHIPS['${seenArrays.get(chips)}']. One vertical cannot serve another's chips.`);
    }
    seenArrays.set(chips, vertical);

    for (const chip of chips) {
      if (owners.has(chip.id)) {
        fail('fallback-modules-not-aliased',
          `chip id '${chip.id}' appears in both ${owners.get(chip.id)} and ${vertical} fallback chips. Chip ids are per-vertical; a shared one means one module is serving the other's data.`);
      }
      owners.set(chip.id, vertical);
    }
  }

  const declaredBy = new Map();
  for (const entry of verticals) {
    for (const tool of manifestToolSet(entry)) {
      if (!declaredBy.has(tool)) declaredBy.set(tool, new Set());
      declaredBy.get(tool).add(entry.vertical);
    }
  }

  const pinnedForeign = new Set(PINNED_FOREIGN_TOOLS);
  const seenForeign = new Set();
  for (const [vertical, chips] of Object.entries(FALLBACK_CHIPS)) {
    for (const chip of chips) {
      if (!chip.tool) continue;
      const declarers = declaredBy.get(chip.tool);
      if (!declarers || declarers.has(vertical)) continue;
      const key = `${vertical}:${chip.id}:${chip.tool}`;
      if (pinnedForeign.has(key)) { seenForeign.add(key); continue; }
      fail('no-foreign-tool-in-fallback-chips',
        `${vertical} fallback chip '${chip.id}' dispatches tool '${chip.tool}', which only ${[...declarers].join(', ')} declares. A chip must dispatch a tool its own vertical owns.`);
    }
  }
  for (const key of PINNED_FOREIGN_TOOLS) {
    if (!seenForeign.has(key)) {
      fail('stale-pin', `PINNED_FOREIGN_TOOLS still lists '${key}', but that no longer happens. Delete the line.`);
    }
  }
}

/**
 * C9 — the settled decision, asserted rather than pinned.
 * See SETTLED_ACTIVE_VERTICAL_WINS above. A genuine banking action typed in
 * another vertical must keep that vertical AND report an explicit no-match.
 * Both halves are asserted: keeping the id while serving that vertical's chips
 * would claim a match for a prompt nothing in it matched.
 */
async function checkSettledActiveVerticalWins() {
  for (const { activeVertical, prompt } of SETTLED_ACTIVE_VERTICAL_WINS) {
    const parsed = parseForFallback(prompt, { verticalId: activeVertical });
    const r = await resolveFallbackChips(prompt, { verticalId: activeVertical });
    if (parsed.vertical !== activeVertical) {
      fail('active-vertical-wins',
        `${q(prompt)} in '${activeVertical}' made parseForFallback claim ${JSON.stringify(parsed.vertical)}. A banking action is BANKING'S OWN pattern; typed in another vertical it must not resolve, so the active vertical has to stand.`);
    }
    if (!r.noMatch) {
      fail('active-vertical-wins',
        `${q(prompt)} in '${activeVertical}' resolved to '${r.verticalId}' with ${(r.chips || []).length} chips instead of an explicit no-match. '${activeVertical}' has no such action, and saying so is the point of the decision — silently serving its chips reports a match that never happened.`);
    }
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  const verticals = readVerticals();
  if (verticals.length < 2) {
    console.error('❌ check-vertical-coercion: found fewer than 2 verticals with dashboard.chips10 — the corpus would prove nothing. Is config/verticals readable?');
    process.exit(1);
  }
  const byVertical = Object.fromEntries(verticals.map((e) => [e.vertical, e]));

  await checkLoaderNeverSubstitutes(verticals);
  await checkNoVerticalIsNotInvented();
  await checkTeachingKeepsActiveVertical(verticals);
  await checkParseErrorKeepsActiveVertical(verticals);
  await checkNowherePrompts(verticals, byVertical);
  await checkChipMessageCorpus(verticals, byVertical);
  await checkActivityAnalysisPrompts(verticals, byVertical);
  checkReadPrimaryToolOwnership();
  checkFallbackModuleShape(verticals, byVertical);
  await checkSettledActiveVerticalWins();

  const chipCount = verticals.reduce((n, e) => n + e.chips.length, 0);

  if (failures.length) {
    const byCheck = new Map();
    for (const f of failures) {
      if (!byCheck.has(f.check)) byCheck.set(f.check, []);
      byCheck.get(f.check).push(f.detail);
    }
    console.error(`\n❌ check-vertical-coercion FAILED — ${failures.length} violation(s) across ${byCheck.size} check(s).\n`);
    for (const [check, details] of byCheck) {
      console.error(`  [${check}]`);
      for (const d of details) console.error(`    - ${d}`);
      console.error('');
    }
    console.error('The invariant: for any prompt, resolution returns either the ACTIVE vertical');
    console.error('or an explicit no-match — never a different vertical\'s identity, chips or tools.');
    process.exit(1);
  }

  console.log(`✅ check-vertical-coercion PASSED — ${chipCount} chip messages x ${verticals.length} verticals, plus teaching, activity-analysis, unroutable, bogus-vertical and parse-error prompts, resolve to the active vertical or to an explicit no-match. ${PINNED_CASCADE_COERCIONS.length + PINNED_FOREIGN_TOOLS.length} pinned pre-existing exceptions still reproduce.`);

  if (knownUnfixedSeen.length) {
    console.log(`\n⚠️  ${knownUnfixedSeen.length} KNOWN-UNFIXED coercion(s) reproduced. These are bugs on main, not accepted behaviour — the gate reports them instead of exiting 1 so it can stay blocking. See the KNOWN_UNFIXED_* blocks in this file for the sites.`);
    for (const d of knownUnfixedSeen) console.log(`    - ${d}`);
  }
}

main().catch((err) => {
  console.error('❌ check-vertical-coercion crashed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
