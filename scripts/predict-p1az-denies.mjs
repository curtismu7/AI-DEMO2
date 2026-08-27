#!/usr/bin/env node
/**
 * Offline PingOne Authorize evaluator — answers "which deny rules would fire?"
 * against the tracked snapshot, without importing anything.
 *
 * WHY THIS EXISTS
 * ---------------
 * There is no API to import or evaluate a P1AZ policy: a change reaches the
 * cloud only by a human importing + publishing it in the console. So the loop
 * for a caller that is denied has been: edit -> import -> publish -> replay ->
 * discover ONE more failing rule -> repeat. Each cycle costs a human round trip
 * and reveals a single gate, because DenyOverrides stops at the first deny it
 * reports.
 *
 * On 2026-08-26 that loop was replaced by this script for the external MCP
 * door. It predicted a third failing rule that the live run had not yet
 * reached, so the audience, actor-chain and D-05 exemptions could all be fixed
 * in ONE import instead of three.
 *
 * TRUST, THEN USE
 * ---------------
 * The evaluator is only worth as much as its agreement with the live product.
 * Validate it before believing a new prediction: run it against the snapshot
 * that is CURRENTLY PUBLISHED and check the rule it names matches the statement
 * in the real deny (IG logs it as `[P1AZ] RESPONSE ... "name" : "<rule>"`).
 * It reproduced the live "MCP Deny — Invalid Actor Chain" exactly before any of
 * the above was trusted.
 *
 * It implements only the condition grammar this snapshot uses -- comparison
 * (Equals / NotEquals / GreaterThan), and / or / not / reference / empty -- and
 * throws on anything else rather than guessing, so an unsupported node fails
 * loudly instead of silently reporting "no denies".
 *
 * WHAT IT IS NOT
 * --------------
 * Not a substitute for the live run. It cannot see attributes the PEP fails to
 * send, resolver behaviour, obligations, or the cloud's own combining quirks.
 * A clean prediction means "no rule in the tracked file rejects this request",
 * which is a necessary condition for PERMIT, never a sufficient one.
 *
 * USAGE
 *   node scripts/predict-p1az-denies.mjs [--snapshot <path>] [--case <name>] [Key=Value ...]
 *   npm run p1az:predict -- --case external-door
 *   npm run p1az:predict -- --case external-door TokenIss=https://evil.example
 *
 * Key=Value overrides are the point: they turn this into an adversarial check.
 * Flip the issuer to something undeclared and the deny rules must come back --
 * that is how the door exemptions were shown not to widen into a hole.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SNAPSHOT = path.join(REPO, 'snapshots', 'AI_Demo_Transaction_Authorization_P1AZ.snapshot.json');

/**
 * Named request shapes. `external-door` is copied verbatim from the
 * `[P1AZ] REQUEST → REAL | body={...}` line PingGateway logged for a real
 * `initialize` through cmuir-mcp.ping-devops.com — not hand-built, so it cannot
 * quietly diverge from what the PEP actually sends.
 */
const CASES = {
  'external-door': {
    DecisionContext: 'McpRequest',
    McpMethod: 'initialize',
    ToolName: '',
    ClientId: '1aee74ae-3d09-4bcf-a69f-7e1bc225b761',
    UserId: '1aee74ae-3d09-4bcf-a69f-7e1bc225b761',
    ActClientId: '',
    ActChainDepth: '0',
    NestedActClientId: '',
    MayActSub: '',
    TokenScopes: 'mcp:invoke read',
    McpResourceUri: 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp,https://api.ping.demo:3036/mcp/apikey,mcpserver.ping.demo',
    TokenIss: 'https://cmuir-mcp.ping-devops.com',
    TokenAudActual: 'mcpserver.ping.demo',
    TokenAudience: 'mcpserver.ping.demo',
    Amount: '', TransactionAmount: '', TransactionType: '', ToAccountId: '', Vertical: '',
    ToolReadOnly: 'false', ToolDestructive: 'false', ToolIdempotent: 'false',
    ElicitationConfirmed: 'false', IntentTokenValid: 'false', IntentMatchesTool: 'false',
    IntentTokenError: 'no_intent_token',
  },
};

function parseArgs(argv) {
  const out = { snapshot: DEFAULT_SNAPSHOT, caseName: 'external-door', overrides: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--snapshot') { out.snapshot = argv[++i]; continue; }
    if (a === '--case') { out.caseName = argv[++i]; continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { out.overrides[a.slice(0, eq)] = a.slice(eq + 1); continue; }
    throw new Error(`unrecognized argument: ${a}`);
  }
  return out;
}

export function predict(snapshotPath, request) {
  const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')).filter((o) => o && typeof o === 'object');
  const byId = new Map(snap.map((o) => [o.id, o]));
  const attrs = snap.filter((o) => o.type === 'ATTRIBUTE');
  const attrName = new Map(attrs.map((a) => [a.id, a.name]));
  const attrDefault = new Map(attrs.map((a) => [a.id, a.defaultValue]));

  // An attribute the caller does not send resolves to its declared
  // defaultValue -- the same fail-safe the snapshot relies on, and the reason
  // every attribute in it carries one.
  const valueOf = (id) => {
    const name = attrName.get(id);
    if (name && Object.prototype.hasOwnProperty.call(request, name)) return request[name];
    const d = attrDefault.get(id);
    return d === undefined ? '' : d;
  };
  const norm = (v) => (typeof v === 'boolean' ? String(v) : v);

  const evalNode = (node) => {
    if (!node || typeof node !== 'object') return false;
    if (node.empty) return true;
    if (node.reference) {
      const ref = byId.get(node.reference.id);
      if (!ref) throw new Error(`dangling condition reference: ${node.reference.id}`);
      return evalNode(ref.condition);
    }
    if (node.not) return !evalNode(node.not.condition);
    if (node.and) return (node.and.conditions || []).every(evalNode);
    if (node.or) return (node.or.conditions || []).some(evalNode);
    if (node.comparison) {
      const c = node.comparison;
      const L = norm(c.left?.attribute ? valueOf(c.left.attribute.id) : c.left?.constant?.value);
      const R = norm(c.right?.attribute ? valueOf(c.right.attribute.id) : c.right?.constant?.value);
      switch (c.op) {
        case 'Equals': return String(L) === String(R);
        case 'NotEquals': return String(L) !== String(R);
        case 'GreaterThan': return Number(L) > Number(R);
        default: throw new Error(`unsupported comparison op: ${c.op}`);
      }
    }
    throw new Error(`unsupported condition node: ${JSON.stringify(node).slice(0, 160)}`);
  };

  const rules = snap.filter((o) => o.type === 'Rule');
  const denyRules = rules.filter((r) => (r.effectSettings || {}).type === 'conditionalDenyElsePermit');
  const fired = denyRules.filter((r) => evalNode(r.effectSettings.condition)).map((r) => r.name);
  return { ruleCount: rules.length, denyRuleCount: denyRules.length, fired };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const { snapshot, caseName, overrides } = parseArgs(process.argv.slice(2));
  const base = CASES[caseName];
  if (!base) {
    console.error(`unknown --case "${caseName}". known: ${Object.keys(CASES).join(', ')}`);
    process.exit(2);
  }
  const request = { ...base, ...overrides };
  const { ruleCount, denyRuleCount, fired } = predict(snapshot, request);

  console.log(`snapshot : ${path.relative(REPO, snapshot)}`);
  console.log(`case     : ${caseName}${Object.keys(overrides).length ? ` (+${Object.keys(overrides).join(', ')})` : ''}`);
  console.log(`rules    : ${ruleCount} (${denyRuleCount} deny-style)\n`);
  if (!fired.length) {
    console.log('NO DENY RULE FIRES — this request would be PERMITted by the tracked policy.');
    console.log('(Necessary, not sufficient: confirm against the live door after import + publish.)');
  } else {
    console.log(`WOULD DENY (${fired.length}):`);
    for (const n of fired) console.log(`  ✖ ${n}`);
  }
  // Never non-zero for a deny: denies are the expected answer for most cases,
  // and a non-zero exit would make this unusable in a pipeline that just wants
  // the report.
}
