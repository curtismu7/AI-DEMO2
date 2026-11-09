#!/usr/bin/env node
'use strict';

/**
 * Merges the two airline booking rules INTO an exported PingOne Authorize snapshot,
 * producing a package that can be imported and published without replacing the
 * environment's policy tree.
 *
 *   node snapshots/merge-airline-booking-rules.js <export.json> [out.json]
 *
 * WHY A MERGER AND NOT A FULL SNAPSHOT IMPORT
 *
 * A P1AZ publish replaces the ENTIRE authorization version (see the header of
 * merge-mcp-amount-bands.js for the incident). So the only safe shape is: export
 * the live tree, add to it, re-import, publish. This script never creates a root
 * PolicySet and never imports the repo snapshot over the live tree.
 *
 * WHAT IT ADDS (eight objects, taken from the regenerated repo snapshot)
 *
 *   attributes  AgentSpendLimit (NUMBER, default 500), MemberTier (STRING, default none; resolved
 *               by PingOne Authorize from the PingOne user's airlineMemberTier, NOT from the request)
 *   conditions  AgentBookingOverUserLimit  (RULE A: an agent is acting AND Amount > AgentSpendLimit)
 *               PremiumOnlyBookingOver750  (RULE B: Amount > 750 AND MemberTier not premium)
 *   statements  mcp-airline-agent-spend-limit, mcp-airline-premium-only (DENY, not shared)
 *   rules       MCP Deny — Agent Booking Over User Limit      (RULE A, owner: the user)
 *               MCP Deny — Airline Premium-Only Over $750     (RULE B, owner: the airline)
 *
 * plus both rules' membership in the MCP Delegation policy, ahead of its catch-all
 * permit. The conditions read the environment's existing ToolName, Amount and
 * ActClientId attributes (matched by name; ids are remapped to the export's) and the
 * rules cite the environment's existing shared "MCP Tool Authorization Denied" statement.
 *
 * MemberTier AND THE PINGONE-USER RESOLVER: the snapshot-file form of the "PingOne User" resolver is
 * UNVERIFIED (no export in the repo has one). An attribute named MemberTier that the environment
 * already has is kept EXACTLY as exported, so the safest route is: create MemberTier in the
 * console (PingOne User resolver, keyed on UserId, path $['airlineMemberTier'], default none),
 * export, then run this script. It REFUSES an export whose MemberTier is still request-resolved
 * (a leftover from the earlier gateway-side design): the gateway no longer sends a tier, so every
 * user would silently be non-premium.
 *
 * IDEMPOTENT: if the export already contains the objects (same content) and the
 * policy already lists the rules, the output equals the input. The output of a run
 * is therefore a valid input to a second run with no further change.
 *
 * REFUSES (non-zero exit, nothing written) when the export lacks the ToolName,
 * Amount or ActClientId attribute, the MCP Delegation policy, the shared denied
 * statement, a package separator, or has anything other than exactly one PolicySet.
 *
 * UNVERIFIED: that each rule beats the consent obligation under DenyOverrides, and
 * that `Amount GreaterThan "750"` / `Amount GreaterThan AgentSpendLimit` compare
 * numerically at 500, 500.01, 750 and 750.01 on a real Authorize engine. Nothing here
 * has been imported anywhere.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const GENERATED = path.join(__dirname, 'AI_Demo_Transaction_Authorization_P1AZ.snapshot.json');
const IDS = {
  attrAgentSpendLimit: '12345678-0034-4321-abcd-000000000034',
  attrMemberTier: '12345678-0035-4321-abcd-000000000035',
  condA: '23456789-0034-4321-abcd-000000000034',
  condB: '23456789-0035-4321-abcd-000000000035',
  stmtA: '34567890-0034-4321-abcd-000000000034',
  stmtB: '34567890-0035-4321-abcd-000000000035',
  ruleA: '45678901-0034-4321-abcd-000000000034',
  ruleB: '45678901-0035-4321-abcd-000000000035',
  mcpPolicy: '56789012-0002-4321-abcd-000000000002',
  sharedDenied: '34567890-0004-4321-abcd-000000000004',
  catchAll: '45678901-0007-4321-abcd-000000000007',
  toolName: '12345678-0008-4321-abcd-000000000008',
  amount: '12345678-0001-4321-abcd-000000000001',
  actClientId: '12345678-0010-4321-abcd-000000000010',
};
/** The eight objects, in dependency order: [id, type]. */
const OBJECTS = [
  [IDS.attrAgentSpendLimit, 'ATTRIBUTE'], [IDS.attrMemberTier, 'ATTRIBUTE'],
  [IDS.condA, 'CONDITION'], [IDS.condB, 'CONDITION'],
  [IDS.stmtA, 'Statement'], [IDS.stmtB, 'Statement'],
  [IDS.ruleA, 'Rule'], [IDS.ruleB, 'Rule'],
];
const RULE_IDS = [IDS.ruleA, IDS.ruleB];

/** Stable deep serialisation (sorted keys at every level). */
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};

/**
 * Pure merge. Returns { merged, changed, policyName, ruleCount }. Throws Error on a refusal.
 * `generated` is the regenerated repo snapshot (source of the eight objects).
 */
function mergeAirlineBookingRules(exported, generated) {
  const pkg = JSON.parse(JSON.stringify(exported));

  const byName = (type, name) => pkg.find((o) => o && o.type === type && o.name === name);
  const toolAttr = byName('ATTRIBUTE', 'ToolName');
  const amountAttr = byName('ATTRIBUTE', 'Amount');
  const actAttr = byName('ATTRIBUTE', 'ActClientId');
  if (!toolAttr) throw new Error('export is missing attribute "ToolName" - cannot merge safely');
  if (!amountAttr) throw new Error('export is missing attribute "Amount" - cannot merge safely');
  if (!actAttr) throw new Error('export is missing attribute "ActClientId" - cannot merge safely');
  const mcpPolicy = pkg.find((o) => o && o.type === 'Policy' && o.id === IDS.mcpPolicy)
    || pkg.find((o) => o && o.type === 'Policy' && /MCP Delegation Authorization$/.test(o.name || ''));
  if (!mcpPolicy) throw new Error('export is missing the MCP Delegation policy - cannot merge safely');
  const sharedDenied = pkg.find((o) => o && o.type === 'Statement' && o.id === IDS.sharedDenied)
    || byName('Statement', 'MCP Tool Authorization Denied');
  if (!sharedDenied) throw new Error('export is missing the shared "MCP Tool Authorization Denied" statement');
  if (!sharedDenied.shared) throw new Error('"MCP Tool Authorization Denied" is not shared - citing it would fail the import');
  const roots = pkg.filter((o) => o && o.type === 'PolicySet');
  if (roots.length !== 1) throw new Error(`expected exactly 1 PolicySet in the export, found ${roots.length}`);
  if (pkg.findIndex((o) => o && o.type === 'SnapshotPackageFile$PackageSeparator') < 0) {
    throw new Error('export has no package separator - unexpected shape');
  }

  // An attribute the environment already has under the same NAME keeps its id: references
  // in the new objects are remapped to it rather than creating a second attribute.
  const existingAttr = (name) => byName('ATTRIBUTE', name);
  const idMap = new Map([
    [IDS.toolName, toolAttr.id], [IDS.amount, amountAttr.id], [IDS.actClientId, actAttr.id],
    [IDS.sharedDenied, sharedDenied.id],
  ]);
  for (const [id, name] of [[IDS.attrAgentSpendLimit, 'AgentSpendLimit'], [IDS.attrMemberTier, 'MemberTier']]) {
    const have = existingAttr(name);
    if (have) idMap.set(id, have.id);
  }

  const haveTier = existingAttr('MemberTier');
  if (haveTier && (haveTier.resolvers || []).length > 0 &&
      haveTier.resolvers.every((r) => r && r.attributeResolverType === 'request')) {
    throw new Error('export has a MemberTier attribute that is still resolved from the request (the old gateway-side design). ' +
      'Change its resolver to the PingOne User resolver on airlineMemberTier in the console (or delete it) and export again');
  }

  const pick = (id, type) => {
    const o = generated.find((x) => x && x.id === id && x.type === type);
    if (!o) throw new Error(`regenerated snapshot has no ${type} ${id} - run npm run snapshot:generate`);
    return o;
  };
  const remap = (o) => {
    let text = JSON.stringify(o);
    for (const [from, to] of idMap) if (from !== to) text = text.split(from).join(to);
    return JSON.parse(text);
  };

  let changed = false;
  const indexOf = (obj) => pkg.findIndex((o) => o && o.id === obj.id && o.type === obj.type);
  const insertAt = {
    ATTRIBUTE: () => {
      let last = -1;
      pkg.forEach((o, i) => { if (o && o.objectType === 'AttributeDefinition') last = i; });
      return last + 1;
    },
    CONDITION: () => pkg.findIndex((o) => o && o.type === 'SnapshotPackageFile$PackageSeparator'),
    Statement: () => pkg.findIndex((o) => o && o.type === 'Policy'),
    Rule: () => pkg.findIndex((o) => o && o.type === 'Policy'),
  };
  const added = [];
  for (const [id, type] of OBJECTS) {
    // A same-name attribute that already exists is the attribute: leave it as exported.
    if (type === 'ATTRIBUTE' && idMap.has(id)) continue;
    const obj = remap(pick(id, type));
    const i = indexOf(obj);
    if (i >= 0) {
      if (stable(pkg[i]) !== stable(obj)) { pkg[i] = obj; changed = true; }
    } else {
      pkg.splice(insertAt[type](), 0, obj);
      changed = true;
    }
    added.push(obj);
  }

  const policy = pkg.find((o) => o && o.type === 'Policy' && o.id === mcpPolicy.id);
  let childAdded = false;
  for (const ruleId of RULE_IDS) {
    if (policy.children.some((c) => c.id === ruleId)) continue;
    const catchAllIdx = policy.children.findIndex((c) => c.id === IDS.catchAll);
    const child = { id: ruleId, type: 'Rule' };
    if (catchAllIdx < 0) policy.children.push(child);
    else policy.children.splice(catchAllIdx, 0, child);
    childAdded = true;
  }
  if (childAdded) {
    // PingOne SKIPS an object whose version is unchanged, so the policy must get a
    // new version or the new children are never attached. Content-derived (not
    // random) so the same input always yields the same output.
    const hash = crypto.createHash('sha256').update(stable(policy.children)).digest('hex');
    policy.version = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4321-abcd-${hash.slice(12, 24)}`;
    changed = true;
  }

  // Validation: no dangling references, one root, rules cite only existing statements.
  const ids = new Set(pkg.filter((o) => o && o.id).map((o) => o.id));
  const problems = [];
  for (const o of added) {
    if (o.type === 'Rule') for (const sid of o.statements) if (!ids.has(sid)) problems.push(`rule ${o.name} cites missing statement ${sid}`);
    if (o.type === 'CONDITION') {
      const refs = new Set();
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (n.attribute && n.attribute.id) refs.add(n.attribute.id);
        if (n.reference && n.reference.id) refs.add(n.reference.id);
        Object.values(n).forEach(walk);
      };
      walk(o.condition);
      for (const r of refs) if (!ids.has(r)) problems.push(`condition ${o.name} references missing object ${r}`);
    }
  }
  if (pkg.filter((o) => o && o.type === 'PolicySet').length !== 1) problems.push('PolicySet count changed');
  if (problems.length) throw new Error(`merged package is invalid: ${problems.join('; ')}`);

  return { merged: pkg, changed, policyName: policy.name, ruleCount: policy.children.length };
}

function main() {
  const src = process.argv[2];
  if (!src) {
    console.error('usage: node snapshots/merge-airline-booking-rules.js <export.json> [out.json]');
    process.exit(1);
  }
  const out = process.argv[3] || path.join(__dirname, 'airline-booking-rules.merged.snapshot.json');
  try {
    const exported = JSON.parse(fs.readFileSync(src, 'utf8'));
    const generated = JSON.parse(fs.readFileSync(GENERATED, 'utf8'));
    const res = mergeAirlineBookingRules(exported, generated);
    fs.writeFileSync(out, `${JSON.stringify(res.merged, null, 0)}\n`);
    console.log(`Wrote ${out}`);
    console.log(res.changed
      ? `  added/updated the airline booking rules in "${res.policyName}" (${res.ruleCount} rules)`
      : '  export already contains the airline booking rules - no change');
  } catch (err) {
    console.error(`REFUSING TO WRITE: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { mergeAirlineBookingRules, IDS, OBJECTS };
