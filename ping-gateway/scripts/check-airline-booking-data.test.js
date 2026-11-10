'use strict';

/**
 * Airline booking data: the gateway copy, the member record and the Groovy lookup.
 *
 *   node --test ping-gateway/scripts/check-airline-booking-data.test.js
 *
 * PingGateway reads ping-gateway/config/airline-booking-policy-data.json (synced from
 * demo_mcp_resource_server/seed/) to put the catalogue fare and the user's agent spend limit in
 * the Authorize request for book_airline_flight. The member tier is NOT sent: PingOne Authorize
 * reads it from the PingOne user's airlineMemberTier. These tests pin the copy, the absence of any
 * tier in the data file and the gateway request, and the Groovy source. The Groovy lookup itself runs
 * only when `groovy` is installed; otherwise it is reported as skipped (UNVERIFIED).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PG = path.join(ROOT, 'ping-gateway');
const { compare, SOURCE, COPY } = require(path.join(ROOT, 'scripts', 'sync-airline-booking-data.js'));
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, SOURCE), 'utf8'));
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo_mcp_resource_server', 'seed', 'airlines.seed.json'), 'utf8'));
const GROOVY = fs.readFileSync(path.join(PG, 'scripts', 'groovy', 'p1az-decision.groovy'), 'utf8');

test('the gateway copy is byte-identical to the source of truth (sync --check)', () => {
  const r = compare(ROOT);
  assert.strictEqual(r.inSync, true, `${COPY}: ${r.reason}. Run: node scripts/sync-airline-booking-data.js`);
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-airline-booking-data.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(cli.status, 0, cli.stderr);
});

test('the data file holds no member tier: the tier is read from the PingOne user, not from the gateway', () => {
  assert.strictEqual(DATA.defaultMember.agentSpendLimitUsd, 500, 'the user preference defaults to $500');
  assert.ok(!('memberTier' in DATA.defaultMember), 'defaultMember must not carry a tier');
  for (const [sub, m] of Object.entries(DATA.members)) assert.ok(!('memberTier' in m), `members.${sub} must not carry a tier`);
  assert.ok(/airlineMemberTier/.test(DATA._comment), 'the data file must say where the tier now comes from');
});

test('premiumTiers is explicit, non-empty, and every entry is a tier that exists in the seed', () => {
  assert.ok(Array.isArray(DATA.premiumTiers) && DATA.premiumTiers.length > 0);
  const tiers = new Set(SEED.passengers.map((p) => p.loyalty_tier));
  for (const t of DATA.premiumTiers) assert.ok(tiers.has(t), `${t} is not a seed tier`);
  assert.ok(/ASSUMPTION/.test(DATA._comment), 'the premium set must be flagged as an assumption for the owner');
  assert.ok(DATA.premiumTiers.includes('Premier Gold'), 'the demo user holds Premier Gold, which must count as premium');
  assert.ok(!DATA.premiumTiers.includes('Premier Silver'), 'Premier Silver is the standard example and must not be premium');
});

test('SH000 is the open-fare flight: listed in openFareFlights, a seed flight (AUS-ANY), and not in the fare catalogue', () => {
  assert.deepStrictEqual(DATA.openFareFlights, ['SH000']);
  assert.ok(!('SH000' in DATA.flights), 'an open-fare flight has no catalogue fare');
  const f = SEED.flights.find((x) => x.flight_number === 'SH000');
  assert.ok(f, 'SH000 must be a seed flight');
  assert.strictEqual(`${f.origin}-${f.destination}`, 'AUS-ANY');
  assert.ok(/openFareFlights/.test(DATA._comment) && /trusted/.test(DATA._comment), 'the data file must say who may use an open fare');
  // the catalogue is unchanged
  assert.deepStrictEqual(Object.keys(DATA.flights).filter((k) => k.startsWith('SH')),
    ['SH101', 'SH102', 'SH103', 'SH104', 'SH105', 'SH106', 'SH107', 'SH108', 'SH109']);
});

test('the catalogue covers the nine scenario flights at the contracted fares', () => {
  assert.deepStrictEqual(
    ['SH101', 'SH102', 'SH103', 'SH104', 'SH105', 'SH106', 'SH107', 'SH108', 'SH109'].map((f) => DATA.flights[f]),
    [180, 320, 480, 500, 500.01, 620, 940, 750, 750.01]);
  for (const f of Object.keys(DATA.flights)) {
    assert.ok(SEED.flights.some((x) => x.flight_number === f), `${f} must be a seed flight`);
  }
});

test('p1az-decision.groovy: authoritative fare override, member facts and fail-closed codes are present', () => {
  for (const needle of [
    '/var/gateway/config/airline-booking-policy-data.json', 'lookupBookingFacts', 'BigDecimal', 'toPlainString',
    'unknown_flight_fare', 'booking_data_unavailable', 'parameters.AgentSpendLimit',
    'fareOverride', 'bookingFacts',
  ]) assert.ok(GROOVY.includes(needle), `p1az-decision.groovy must contain ${needle}`);
  // Only book_airline_flight is touched, and the override is inside the tools/call branch.
  assert.ok(/if \(toolName == 'book_airline_flight'\)/.test(GROOVY));
  assert.ok(/if \(bookingFare != null\) \{\s*parameters\.AgentSpendLimit/.test(GROOVY), 'the new key is added only when a booking fare resolved');
  // The override happens before denyLocal is defined, the fail-closed check after it. Each index
  // must be found (>= 0): a missing statement must not pass as "-1 < n".
  const iOverride = GROOVY.indexOf('transactionAmount = bookingFare.toPlainString()');
  const iDeny = GROOVY.indexOf('def denyLocal =');
  const iFailClosed = GROOVY.indexOf('if (bookingError) {');
  assert.ok(iOverride >= 0, 'the authoritative fare override statement is missing');
  assert.ok(iDeny >= 0 && iFailClosed >= 0, 'denyLocal and the bookingError check must both exist');
  assert.ok(iOverride < iDeny && iDeny < iFailClosed);
});

// Exact whole-line statements, so a hard-coded value or a swapped source cannot hide in a substring.
const hasLine = (src, stmt) => src.split('\n').some((l) => l.trim() === stmt);

// Source text of the `if (toolName == 'book_airline_flight') {` block, by brace matching.
function bookingBlock() {
  const start = GROOVY.indexOf("if (toolName == 'book_airline_flight') {");
  assert.ok(start >= 0, "the book_airline_flight branch is missing");
  const open = GROOVY.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < GROOVY.length; i++) {
    if (GROOVY[i] === '{') depth++;
    else if (GROOVY[i] === '}' && --depth === 0) return GROOVY.slice(open, i + 1);
  }
  throw new Error('unbalanced braces in the book_airline_flight branch');
}

test('p1az-decision.groovy: the fare override sits inside the book_airline_flight branch and takes the catalogue value', () => {
  const block = bookingBlock();
  for (const stmt of [
    'transactionAmount = bookingFare.toPlainString()',
    'bookingFare   = facts.fare',
    'bookingLimit  = facts.limit',
    'bookingError = facts.error',
  ]) assert.ok(hasLine(block, stmt), `inside the booking branch, expected the exact statement: ${stmt}`);
  // The caller's amount may only be recorded as a mismatch, never assigned to the judged amount
  // after the override.
  const afterOverride = block.slice(block.indexOf('transactionAmount = bookingFare.toPlainString()'));
  assert.ok(!/transactionAmount\s*=(?!=)/.test(afterOverride.replace('transactionAmount = bookingFare.toPlainString()', '')),
    'transactionAmount must not be reassigned after the authoritative override');
  // The override exists nowhere outside the booking branch.
  assert.strictEqual(GROOVY.split('transactionAmount = bookingFare.toPlainString()').length - 1, 1);
  // The flight is looked up case-insensitively on the trimmed string (so sh107 and SH107 agree).
  assert.ok(/flightArg\.toString\(\)\.trim\(\)\.toUpperCase\(\)/.test(GROOVY), 'flight lookup must trim and upper-case');
  assert.ok(hasLine(GROOVY, 'if (bookingError) {'), 'the fail-closed check must be the exact statement');
});

test('p1az-decision.groovy: AgentSpendLimit comes from the member record; NO MemberTier is sent; the user subject is', () => {
  assert.ok(hasLine(GROOVY, 'parameters.AgentSpendLimit = bookingLimit.toPlainString()'), 'AgentSpendLimit must be assigned from bookingLimit');
  assert.strictEqual(GROOVY.split('parameters.AgentSpendLimit').length - 1, 1, 'AgentSpendLimit is assigned exactly once');
  assert.ok(/if \(bookingFare != null\) \{\s*parameters\.AgentSpendLimit = bookingLimit\.toPlainString\(\)\s*\}/.test(GROOVY));
  // Rule B's tier is resolved by PingOne Authorize from the PingOne user: the gateway must not
  // carry, look up or claim a tier at all.
  assert.ok(!/parameters\.MemberTier/.test(GROOVY) && !/MemberTier\s*:/.test(GROOVY), 'the gateway must not send a MemberTier parameter');
  assert.ok(!/bookingTier|facts\.tier|memberTier/.test(GROOVY), 'the gateway must not look up a member tier');
  // What the user resolver needs: the token subject as UserId (and ClientId), always sent.
  assert.ok(/^\s*UserId\s*:\s*sub,/m.test(GROOVY), 'UserId must be the token sub');
  assert.ok(hasLine(GROOVY, "def sub = tokenInfo['sub'] ?: ''") || /def sub\s*=\s*tokenInfo\['sub'\]/.test(GROOVY), 'sub must come from the introspected token');
  // Amount and TransactionAmount sent to P1AZ both carry the judged amount.
  assert.ok(/Amount\s*:\s*transactionAmount,/.test(GROOVY));
  assert.ok(/TransactionAmount:\s*transactionAmount,/.test(GROOVY));
});

const hasGroovy = spawnSync('groovy', ['--version'], { encoding: 'utf8' }).status === 0;
test('Groovy lookupBookingFacts runs in isolation against the real data file', { skip: hasGroovy ? false : 'groovy not installed (UNVERIFIED here)' }, () => {
  const r = spawnSync('groovy', [path.join(PG, 'scripts', 'check-airline-booking-lookup.groovy'), PG], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ALL OK/);
});

// ── HITL pre-approval by the user's own limit (X-Hitl-Preapproved: user-limit) ─────────────────────
// The decision (decideHitlPreapproval) is a pure closure and is EXECUTED by
// check-airline-booking-preapproval.groovy: with a local `groovy`, else in the already-present IG image
// (docker run --network none, the scripts mounted read-only, nothing else). The wiring around it (header
// read and strip, the call arguments, HitlApproved, the audit field) lives in the script body and cannot be
// run without IG, so it is pinned below by exact statements. Neither runner available = skipped, UNVERIFIED.
const IG_IMAGE = 'us-docker.pkg.dev/forgeops-public/images-base/ig:latest';
function runGroovy(script, dir = PG) {
  if (hasGroovy) return spawnSync('groovy', [path.join(dir, 'scripts', script), dir], { encoding: 'utf8' });
  const hasImage = spawnSync('docker', ['image', 'inspect', IG_IMAGE], { encoding: 'utf8' }).status === 0;
  if (!hasImage) return null;
  return spawnSync('docker', ['run', '--rm', '--network', 'none', '-v', `${dir}:/pg:ro`, '--entrypoint', 'java', IG_IMAGE,
    '-cp', '/opt/gateway/lib/*', 'groovy.ui.GroovyMain', `/pg/scripts/${script}`, '/pg'], { encoding: 'utf8' });
}
const preapprovalRun = runGroovy('check-airline-booking-preapproval.groovy');
test('Groovy decideHitlPreapproval: granted only for trust + tool + header + no receipt + fare <= limit; header limit rules',
  { skip: preapprovalRun ? false : 'neither groovy nor the IG image is available (UNVERIFIED here)' }, () => {
    assert.strictEqual(preapprovalRun.status, 0, preapprovalRun.stdout + preapprovalRun.stderr);
    assert.match(preapprovalRun.stdout, /ALL OK/);
    assert.ok(!/^FAIL/m.test(preapprovalRun.stdout));
    assert.ok((preapprovalRun.stdout.match(/^ok /gm) || []).length >= 60, 'the case list must not have shrunk');
  });

// Source text of the decideHitlPreapproval closure, by the same end marker the Groovy runner uses.
function preapprovalClosure() {
  const start = GROOVY.indexOf('def decideHitlPreapproval = {');
  assert.ok(start >= 0, 'decideHitlPreapproval is missing');
  return GROOVY.slice(start, GROOVY.indexOf('\n}\n', start) + 2);
}

test('p1az-decision.groovy: both pre-approval headers are read once, at top level, and stripped before anything can return or proxy', () => {
  for (const stmt of [
    "def hitlPreapprovedHeader = request.headers.getFirst('X-Hitl-Preapproved')",
    "def agentSpendLimitHeader = request.headers.getFirst('X-Agent-Spend-Limit')",
    "request.headers.remove('X-Hitl-Preapproved')",
    "request.headers.remove('X-Agent-Spend-Limit')",
  ]) {
    // Whole line, no indentation: top-level, not inside a conditional that could skip the strip.
    assert.ok(GROOVY.split('\n').includes(stmt), `expected the top-level statement: ${stmt}`);
    assert.strictEqual(GROOVY.split(stmt).length - 1, 1, `${stmt} must appear exactly once`);
  }
  const firstReturn = GROOVY.indexOf('return Promises');
  assert.ok(firstReturn >= 0);
  assert.ok(GROOVY.indexOf("request.headers.remove('X-Hitl-Preapproved')") < firstReturn, 'strip must precede the first response/return');
  assert.ok(GROOVY.indexOf("request.headers.remove('X-Agent-Spend-Limit')") < firstReturn);
  // Neither header is read anywhere else (so no second, ungated reader exists).
  assert.strictEqual(GROOVY.split("getFirst('X-Hitl-Preapproved')").length - 1, 1);
  assert.strictEqual(GROOVY.split("getFirst('X-Agent-Spend-Limit')").length - 1, 1);
});

test('p1az-decision.groovy: the pre-approval call passes the trust flag, the tool, the AUTHORITATIVE fare and the file default', () => {
  const call = GROOVY.match(/hitlPreapproval = decideHitlPreapproval\(([^)]*)\)/);
  assert.ok(call, 'the decideHitlPreapproval call is missing');
  const argv = call[1].split(',').map((a) => a.trim());
  // trusted, tool, preapproved header, challenge id, authoritative fare, data-file default, limit header
  assert.deepStrictEqual(argv, ['trustedCaller', 'toolName', 'hitlPreapprovedHeader', 'hitlChallengeId',
    'bookingFare', 'bookingLimit', 'agentSpendLimitHeader']);
  // It runs after receipt verification (so the receipt path wins) and before the Authorize request is built.
  const iReceipt = GROOVY.indexOf('verdict');
  const iCall = GROOVY.indexOf('hitlPreapproval = decideHitlPreapproval(');
  const iBody = GROOVY.indexOf('def requestBody = JsonOutput.toJson');
  assert.ok(iReceipt >= 0 && iCall > iReceipt && iBody > iCall);
  // Guarded by `if (!hitlApproved)` and the only new way to set hitlApproved is a non-null decision.
  assert.ok(/if \(!hitlApproved\) \{\s*hitlPreapproval = decideHitlPreapproval\(/.test(GROOVY));
  assert.ok(/if \(hitlPreapproval != null\) hitlApproved = true/.test(GROOVY));
  assert.strictEqual(GROOVY.split('hitlApproved = true').length - 1, 2, 'hitlApproved may be set true in exactly two places: a verified receipt and this decision');
  assert.ok(hasLine(GROOVY, 'def hitlPreapproval = null'));
});

test('p1az-decision.groovy: HitlApproved reaches Authorize only through hitlApproved; the audit trail records the basis only when granted', () => {
  assert.strictEqual(GROOVY.split('parameters.HitlApproved').length - 1, 1);
  assert.ok(/if \(hitlApproved\) \{\s*parameters\.HitlApproved = 'true'/.test(GROOVY));
  // The audit field is the closure result itself (null when not granted), never a literal.
  assert.ok(hasLine(GROOVY, 'hitlPreapproved: hitlPreapproval,'));
  assert.strictEqual(GROOVY.split('hitlPreapproved:').length - 1, 1);
  // The audit field sits inside auditTrail, which is serialised into every X-Gw-Audit-Trail.
  const iTrail = GROOVY.indexOf('def auditTrail = [');
  assert.ok(iTrail >= 0 && GROOVY.indexOf('hitlPreapproved: hitlPreapproval,') > iTrail);
  // Pre-existing behaviour is untouched: the user limit still goes to Authorize unchanged.
  assert.ok(hasLine(GROOVY, 'parameters.AgentSpendLimit = bookingLimit.toPlainString()'));
});

test('p1az-decision.groovy: the decision closure itself carries the gate, the exact header value, the receipt rule, and fare <= limit', () => {
  const c = preapprovalClosure();
  for (const needle of [
    '!trusted', "tool != 'book_airline_flight'", "preapprovedHdr != 'user-limit'", 'challengeId', 'fare == null',
    'limit == null', 'fare.compareTo(limit) > 0', '[0-9]+(\\.[0-9]+)?', 'limitHdr.length() <= 7', 'signum() > 0',
  ]) assert.ok(c.includes(needle), `closure must contain ${needle}`);
  // Fare over the limit is the only comparison, strict: exactly equal passes.
  assert.ok(!/compareTo\(limit\)\s*>=/.test(c));
  // No caller-supplied amount can reach the decision: the closure never sees one.
  assert.ok(!/amt|amount|claimed/i.test(c.replace(/\/\/.*$/gm, '')), 'the decision must not read any caller amount');
});

// ── Open fare (SH000): the TRUSTED connector's stated amount is the judged amount ─────────────────
// check-airline-open-fare.groovy EXECUTES parseStatedAmount, lookupOpenFare, decideHitlPreapproval and the real
// book_airline_flight block of p1az-decision.groovy against a stub binding (local groovy, else the IG image with
// --network none). The wiring that cannot run without IG is pinned below by exact statements, and the mutation
// tests re-run the Groovy check against deliberately broken copies and require each to FAIL.
const openFareRun = runGroovy('check-airline-open-fare.groovy');
const NO_RUNTIME = 'neither groovy nor the IG image is available (UNVERIFIED here)';
test('Groovy open fare: stated amount accepted only for trusted + tool + openFareFlights + valid amount; everything else falls back',
  { skip: openFareRun ? false : NO_RUNTIME }, () => {
    assert.strictEqual(openFareRun.status, 0, openFareRun.stdout + openFareRun.stderr);
    assert.match(openFareRun.stdout, /ALL OK/);
    assert.ok(!/^FAIL/m.test(openFareRun.stdout));
    assert.ok((openFareRun.stdout.match(/^ok /gm) || []).length >= 110, 'the case list must not have shrunk');
  });

test('p1az-decision.groovy: the stated amount is wired through trustedCaller, the open-fare lookup runs first, and the audit says where the fare came from', () => {
  const call = GROOVY.match(/def facts = lookupOpenFare\(([^\n]*)\)\n/);
  assert.ok(call, 'the lookupOpenFare call is missing');
  const argv = call[1].split(',').map((a) => a.trim());
  assert.strictEqual(argv[0], 'bookingData');
  assert.strictEqual(argv[1], 'flightArg');
  assert.strictEqual(argv[3], 'trustedCaller', 'the trust flag must be passed, not a literal');
  const block = bookingBlock();
  assert.ok(block.indexOf('lookupOpenFare(') >= 0 && block.indexOf('lookupOpenFare(') < block.indexOf('lookupBookingFacts('), 'the open-fare lookup runs before the catalogue lookup');
  assert.ok(hasLine(block, 'if (facts == null) facts = lookupBookingFacts(bookingData, flightArg, String.valueOf(sub ?: \'\'))'), 'a non-open flight falls back to the catalogue lookup');
  assert.strictEqual(GROOVY.split('lookupOpenFare(').length - 1, 1, 'exactly one call: no second, ungated use');
  assert.ok(hasLine(block, "bookingFareSource = facts.fareSource ?: 'catalogue'"));
  assert.ok(hasLine(GROOVY, 'fareSource        : bookingFareSource,'), 'the audit trail records the fare source');
  // the judged amount is still assigned once, from bookingFare, so a stated amount and a catalogue fare reach Authorize the same way
  assert.strictEqual(GROOVY.split('transactionAmount = bookingFare.toPlainString()').length - 1, 1);
  // the two new fail-closed reasons are distinct and go through denyLocal before P1AZ is called
  for (const needle of ["'open_fare_untrusted'", "'open_fare_bad_amount'"]) {
    assert.ok(GROOVY.includes(needle), `expected ${needle}`);
  }
  assert.ok(/bookingError == 'open_fare_untrusted'/.test(GROOVY) && /bookingError == 'open_fare_bad_amount'/.test(GROOVY));
});

test('p1az-decision.groovy: the open-fare closures read no header and no request state (pure), so only the passed trust flag can open them', () => {
  const start = GROOVY.indexOf('def parseStatedAmount = {');
  const end = GROOVY.indexOf('// Pre-approval of a booking by the user');
  assert.ok(start >= 0 && end > start);
  const code = GROOVY.slice(start, end).replace(/\/\/.*$/gm, '');
  assert.ok(!/request\.|headers|System\.getenv|trustedCaller/.test(code), 'the open-fare closures must not read request state or the outer trust variable');
});

// Mutation checks: copy only the two files the Groovy check reads (plus the check itself) into a temp dir, break
// one thing, and require the Groovy check to fail. A mutation that does not apply is itself a failure.
function mutatedRun(mutate) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'open-fare-mut-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts', 'groovy'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'config'));
    const mutated = mutate(GROOVY);
    assert.notStrictEqual(mutated, GROOVY, 'the mutation did not change the source');
    fs.writeFileSync(path.join(dir, 'scripts', 'groovy', 'p1az-decision.groovy'), mutated);
    fs.copyFileSync(path.join(PG, 'scripts', 'check-airline-open-fare.groovy'), path.join(dir, 'scripts', 'check-airline-open-fare.groovy'));
    fs.copyFileSync(path.join(PG, 'config', 'airline-booking-policy-data.json'), path.join(dir, 'config', 'airline-booking-policy-data.json'));
    return runGroovy('check-airline-open-fare.groovy', dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const MUTATIONS = [
  ['the trust gate removed', "if (!trusted) return [error: 'open_fare_untrusted']", ''],
  ['the openFareFlights membership check removed', ' || !open.contains(flight)', ''],
  ['the amount range check removed', "if (v.signum() <= 0 || v.compareTo(new BigDecimal('100000')) > 0) return null", ''],
  ['the 2-decimal check removed', 'if (v.stripTrailingZeros().scale() > 2) return null', ''],
  ['the Number-type check removed (strings accepted)', 'if (!(raw instanceof Number)) return null', ''],
  ['the invalid-amount refusal removed', "if (stated == null) return [error: 'open_fare_bad_amount']", ''],
  ['the caller amount used for catalogue flights', 'transactionAmount = bookingFare.toPlainString()', 'transactionAmount = amt != null ? String.valueOf(amt) : bookingFare.toPlainString()'],
  ['trust hard-wired to true at the call', 'args instanceof Map ? args.get(\'amount\') : null, trustedCaller,', 'args instanceof Map ? args.get(\'amount\') : null, true,'],
  ['the fare source not recorded as stated', "bookingFareSource = facts.fareSource ?: 'catalogue'", "bookingFareSource = 'catalogue'"],
];
for (const [label, from, to] of MUTATIONS) {
  test(`mutation: ${label} -> the Groovy open-fare check FAILS`, { skip: openFareRun ? false : NO_RUNTIME }, () => {
    assert.ok(GROOVY.includes(from), `the text to break is missing from p1az-decision.groovy: ${from}`);
    const r = mutatedRun((src) => src.replace(from, to));
    assert.notStrictEqual(r.status, 0, `the check still passed with ${label}`);
    assert.match(r.stdout, /^FAIL /m, `${label}: the check must fail on a case, not on a crash\n${r.stderr}`);
  });
}
