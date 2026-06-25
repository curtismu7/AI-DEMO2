#!/usr/bin/env node
'use strict';

/**
 * healthcareRoutingEval.js — routing eval for the healthcare vertical.
 *
 * Measures how well a freeform phrase routes to the intended action. This is
 * the "#1 lever" from docs/llm-directive-and-trace.md made concrete: a
 * phrase -> expected-action fixture scored against parseNaturalLanguage, so any
 * directive / heuristic change becomes a measurable accuracy number instead of
 * a guess.
 *
 * By default it exercises the HEURISTIC layer (provider 'heuristic') — the
 * always-on, zero-latency catalog. It needs no API keys and runs in CI.
 * Pass `--provider=auto` to instead route through the configured LLM (Helix /
 * Claude) for the same fixture, to measure the LLM fallback path.
 *
 *   node scripts/healthcareRoutingEval.js
 *   node scripts/healthcareRoutingEval.js --provider=auto
 *
 * Exit code 0 when accuracy is 100%, 1 otherwise — usable as a gate.
 */

const { parseNaturalLanguage } = require('../services/geminiNlIntent');

// phrase -> expected action. Covers every healthcare action plus realistic
// paraphrases, with emphasis on the newly added view_claims and its confusables
// (claims vs coverage vs records).
const FIXTURE = [
  // view_records
  // NOTE: "show/view/get my medical|health records" is INTENTIONALLY the
  // feature-page demo trigger (VERTICAL_FEATURE_RE in nlIntentParser.js), so it
  // resolves to vertical_feature_demo, not view_records. Plain records intent is
  // reached via the phrasings below.
  { phrase: 'show my medical records', expect: 'vertical_feature_demo' },
  { phrase: 'pull up my patient records', expect: 'view_records' },
  { phrase: 'what health records do I have', expect: 'view_records' },
  { phrase: 'summarize my recent visits', expect: 'view_records' },

  // view_coverage
  { phrase: 'check my coverage', expect: 'view_coverage' },
  { phrase: "what's my deductible", expect: 'view_coverage' },
  { phrase: 'do I need a referral', expect: 'view_coverage' },
  { phrase: 'show my insurance details', expect: 'view_coverage' },

  // view_claims (NEW)
  { phrase: 'show my claims', expect: 'view_claims' },
  { phrase: 'my insurance claims', expect: 'view_claims' },
  { phrase: 'what is the status of my claim', expect: 'view_claims' },
  { phrase: 'claim status', expect: 'view_claims' },
  { phrase: 'list all my claims', expect: 'view_claims' },

  // list_appointments
  { phrase: 'my appointments', expect: 'list_appointments' },
  { phrase: 'what upcoming visits do I have', expect: 'list_appointments' },
  { phrase: 'show my appointment history', expect: 'list_appointments' },

  // book_appointment
  { phrase: 'book with Dr. Smith on Friday', expect: 'book_appointment' },
  { phrase: 'schedule cardiology next week', expect: 'book_appointment' },

  // view_billing
  { phrase: 'show my bills', expect: 'view_billing' },
  { phrase: 'what do I owe', expect: 'view_billing' },
  { phrase: 'my billing history', expect: 'view_billing' },
  { phrase: 'any outstanding invoices', expect: 'view_billing' },

  // pay_bill
  { phrase: 'pay bill 402', expect: 'pay_bill' },
  { phrase: 'pay my bill', expect: 'pay_bill' },
  { phrase: 'settle my balance for bill 403', expect: 'pay_bill' },

  // cancel_appointment
  { phrase: 'cancel appointment 202', expect: 'cancel_appointment' },
  { phrase: 'cancel my appointment', expect: 'cancel_appointment' },
  { phrase: 'cancel my visit', expect: 'cancel_appointment' },

  // reschedule_appointment
  { phrase: 'reschedule appointment 202 to Friday', expect: 'reschedule_appointment' },
  { phrase: 'move my appointment to next week', expect: 'reschedule_appointment' },
  { phrase: 'change my appointment', expect: 'reschedule_appointment' },

  // 15-intent expansion (heuristic-backed)
  { phrase: "what medications am I on", expect: "view_medications" },
  { phrase: "show me my current prescriptions", expect: "view_medications" },
  { phrase: "can I see my meds list", expect: "view_medications" },
  { phrase: "can you refill medication 503", expect: "refill_prescription" },
  { phrase: "I need a refill on prescription 501", expect: "refill_prescription" },
  { phrase: "request refill for med 505", expect: "refill_prescription" },
  { phrase: "show me my lab results", expect: "view_lab_results" },
  { phrase: "what were my blood work results", expect: "view_lab_results" },
  { phrase: "can I see my recent test results", expect: "view_lab_results" },
  { phrase: "show me my vitals", expect: "view_vitals" },
  { phrase: "what was my blood pressure at my last visit", expect: "view_vitals" },
  { phrase: "can I see my heart rate and weight history", expect: "view_vitals" },
  { phrase: "who are my doctors", expect: "view_care_team" },
  { phrase: "show me my care team", expect: "view_care_team" },
  { phrase: "list my providers and specialists", expect: "view_care_team" },
  { phrase: "show me my inbox", expect: "list_messages" },
  { phrase: "do I have any unread messages from my doctor", expect: "list_messages" },
  { phrase: "check my secure messages", expect: "list_messages" },
  { phrase: "show me my referrals", expect: "view_referrals" },
  { phrase: "do I have a specialist referral for cardiology", expect: "view_referrals" },
  { phrase: "I was referred to a dermatologist, can I see the details", expect: "view_referrals" },
  { phrase: "show me my health documents", expect: "view_documents" },
  { phrase: "what documents do I have on file", expect: "view_documents" },
  { phrase: "can I see my uploaded files from my doctor", expect: "view_documents" },

  // release_records
  // "share/release my medical records" now routes to release_records: the feature
  // trigger is vertical-scoped + verb-anchored (FEATURE_TRIGGERS.healthcare), so the
  // bare-"my" feature match no longer swallows the release intent. The feature chip
  // ("show my health record", asserted above as vertical_feature_demo) still works.
  { phrase: 'release record 102', expect: 'release_records' },
  { phrase: 'release my records', expect: 'release_records' },
  { phrase: 'send my records to dr smith', expect: 'release_records' },
  { phrase: 'share my medical records', expect: 'release_records' },
];

function actionOf(result) {
  if (!result) return 'none';
  if (result.kind === 'vertical') return result.action || 'none';
  if (result.kind === 'banking') return result.banking?.action || 'none';
  return result.kind || 'none'; // 'none', 'education', etc.
}

async function main() {
  const providerArg = (process.argv.find((a) => a.startsWith('--provider=')) || '').split('=')[1];
  const provider = providerArg || 'heuristic';
  const ctx = { vertical: 'healthcare', role: 'patient' };

  // Fixtures are independent — run them concurrently. Promise.all preserves
  // input order, so the printed table stays stable. This matters for
  // --provider=auto (real LLM calls): serial await would be ~1-2s x N.
  const rows = await Promise.all(FIXTURE.map(async ({ phrase, expect }) => {
    const { result } = await parseNaturalLanguage(phrase, ctx, provider, {});
    const got = actionOf(result);
    return { ok: got === expect, phrase, expect, got };
  }));
  const pass = rows.filter((r) => r.ok).length;

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nHealthcare routing eval — provider=${provider}\n`);
  console.log(`  ${pad('', 4)}${pad('expected', 20)}${pad('got', 20)}phrase`);
  console.log(`  ${'-'.repeat(70)}`);
  for (const r of rows) {
    console.log(`  ${pad(r.ok ? 'PASS' : 'FAIL', 4)}${pad(r.expect, 20)}${pad(r.got, 20)}"${r.phrase}"`);
  }
  const pct = ((pass / FIXTURE.length) * 100).toFixed(1);
  console.log(`\n  Accuracy: ${pass}/${FIXTURE.length} (${pct}%)\n`);

  const failures = rows.filter((r) => !r.ok);
  if (failures.length) {
    console.log('  Misroutes:');
    for (const f of failures) console.log(`   - "${f.phrase}" expected ${f.expect}, got ${f.got}`);
    console.log('');
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
