#!/usr/bin/env node
/**
 * gen-authorize-snapshot.js — SoT-driven reconciler for the cloud PingOne
 * Authorize import file.
 *
 * PingOne Authorize has NO policy API for COMPARISON conditions, so the cloud
 * policy is updated by importing a snapshot. This script keeps that snapshot in
 * sync with scope-topology.json (the single source of truth all engines share)
 * so the cloud policy gates EVERY use-case/chip tool, not just create_transfer.
 *
 * It reconciles, by stable ID, the SoT-driven parts of the snapshot:
 *   - RequiresHitlConsent  (cond 0010): ToolName IN {challengeType:'consent'} AND HitlApproved!=true  -> HITL
 *   - RequiresMcpStepUp    (cond 0013): ToolName IN {challengeType:'step_up'} AND NOT HasMFAAuthentication -> step-up
 *   - IsConsentTransaction (cond 0014): Amount > confirm($250) -> transaction-path consent
 *   - HasValidMcpAudience  (cond 0007): TokenAudience IN {SoT gateway resource URIs} (set semantics —
 *     the old attribute-to-attribute TokenAudience==McpResourceUri equality denied ALL MCP traffic post-C1)
 *   - Fine-grained deny rules mirroring demo_authz_server/routes/decision.js:
 *     D-05 anti-bypass (Rule 0b-2), resource owner (3.5a), intent tamper/mismatch
 *     (4a/4b), admin-role write restriction (2.95)
 *   - RAR (RFC 9396) amount-cap deny (step 9, landed via #611/#612/#615):
 *     RarMaxAmount NUMBER attr + RarAmountExceeded -> rar_amount_exceeded DENY,
 *     mirroring simulatedAuthorizeService NNP-1 / mock Rule 3c (amount half)
 *   - Banking tier ceilings, UC21 (step 10): IsStandardTier / IsTierRestrictedTool
 *     / ExceedsTierAmountCap, generated from the banking vertical manifest's
 *     `tiers` block — the same data groupPolicy.getTierDefinitions() feeds to the
 *     simulator. These three were hand-authored and had already drifted.
 * plus the rules that reference them and their membership in the two policies.
 * Everything else in the snapshot is left untouched. Re-running is idempotent.
 *
 * DELIBERATELY NOT MODELED in the cloud policy (PEP + mock only — the P1AZ DSL
 * cannot express them faithfully; see planning/authz-fix-contract.md):
 *   - Temporal exp/iat/nbf (mock Rules 0c-0f): the snapshot Timestamp attribute
 *     is an ISO 8601 STRING while token claims are epoch-second strings; without
 *     a verified CurrentEpoch attribute and confirmed numeric coercion the
 *     comparison would be meaningless or silently always-false.
 *   - Per-tool scope membership (mock Rule 3): TokenScopes is a space-separated
 *     set and the DSL has no set/contains operator; enumerating scope x tool
 *     combinations as OR-of-equals would not survive multi-scope tokens.
 *   - RAR payee allow-list (mock Rule 3c payee half): permitted payees are an
 *     array; same missing set-membership operator.
 *   - D-05 multi-aud: TokenAudTargetsUpstream compares a SINGLE aud string; a
 *     space-joined multi-aud value is only caught at the PEP (gateway) and mock.
 *   - tiers.groupToTier (step 10): mapping a PingOne group ARRAY to a tier needs
 *     set membership. The BFF resolves it and sends the scalar UserTier, the same
 *     flattening precedent as InRequiredGroup / TokenKidKnown. The tier
 *     THRESHOLDS stay in the cloud policy — sending a pre-computed ceiling would
 *     move the policy back out of the product this demo is about.
 *
 * Usage:  node snapshots/gen-authorize-snapshot.js          (writes in place)
 *         node snapshots/gen-authorize-snapshot.js --check  (fail if out of date)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = path.resolve(__dirname, '..');
const SOT = path.join(REPO, 'scope-topology.json');
const SNAP = path.join(__dirname, 'AI_Demo_Transaction_Authorization_P1AZ.snapshot.json');
// Banking is the ONLY vertical with a `tiers` block, and this file is the
// banking policy — so the tier SoT is read from that one manifest by path
// rather than through the vertical resolver (which needs demo_api_server's
// node_modules; this generator must stay runnable from a bare checkout).
// Verified equal to verticalManifest.resolver.resolve('banking').tiers, which
// is what groupPolicy.getTierDefinitions() — and the simulator — reads.
const BANKING_MANIFEST = path.join(REPO, 'demo_api_server', 'config', 'verticals', 'banking', 'manifest.json');

const ATTR = {
  Amount: '12345678-0001-4321-abcd-000000000001',
  UserId: '12345678-0003-4321-abcd-000000000003',
  ToolName: '12345678-0008-4321-abcd-000000000008',
  ActClientId: '12345678-0010-4321-abcd-000000000010',
  ActChainDepth: '12345678-0014-4321-abcd-000000000014',
  HitlApproved: '12345678-0013-4321-abcd-000000000013',
  DecisionContext: '12345678-0007-4321-abcd-000000000007',
  TokenAudience: '12345678-0009-4321-abcd-000000000009',
  // New request-resolved attributes (cloud delta). Defaults are the inert
  // sentinels — a request that omits the key changes no decision.
  //
  // Id-suffix -0021 is RETIRED in every id class: ver() derives the version
  // suffix from the id suffix, and #615 parked the RAR quartet's VERSIONS at
  // suffix -0021 (ids stay -0020) — an object at id -0021 would collide with
  // those version UUIDs, and the snapshot keeps version UUIDs unique file-wide.
  // UC21 entitlement tier, pre-resolved by the BFF from PingOne group membership
  // (groupPolicy.resolveUserTier). STRING, defaultValue 'none' — the inert side,
  // so the tier rules do nothing until ff_authorize_group_policy is on.
  UserTier: '12345678-0015-4321-abcd-000000000015',
  TokenAudActual: '12345678-0018-4321-abcd-000000000018',
  ResourceOwnerId: '12345678-0019-4321-abcd-000000000019',
  RarMaxAmount: '12345678-0020-4321-abcd-000000000020',     // RFC 9396 granted amount ceiling (NUMBER, defaultValue 0 — see step 9)
  IntentTokenValid: '12345678-0025-4321-abcd-000000000025', // NOT -0021 (retired, see above)
  IntentMatchesTool: '12345678-0022-4321-abcd-000000000022',
  IntentTokenError: '12345678-0023-4321-abcd-000000000023',
  UserRole: '12345678-0024-4321-abcd-000000000024',
  // BFF-pre-resolved JWKS membership of the token's header kid. BOOLEAN with
  // defaultValue TRUE — the inert side. The BFF OMITS this key when membership
  // is unknown (no kid, or the JWKS fetch failed), so an absent value MUST NOT
  // deny; defaulting false would deny every call that omits it, including
  // during a PingOne JWKS outage. Same fail-open default as InRequiredGroup.
  TokenKidKnown: '12345678-0027-4321-abcd-000000000027',
  // The kid string itself. Reportable input only — no rule branches on it; it
  // exists so the deny payload and the recent-decisions log can name the key.
  // Default '' (absent), matching TokenAudActual / ResourceOwnerId.
  TokenKid: '12345678-0028-4321-abcd-000000000028',
};
// The accepted gateway identities (step 0) are read from these SoT resource
// entries — the same identities the runtime accepts (PG_GATEWAY_RESOURCE_URI +
// PG_GATEWAY_RESOURCE_ID; groovy p1az-decision.groovy acceptedAuds). Never
// hardcode the URIs here (REGRESSION_PLAN §3).
//
// The A2A gateway MUST be in this list. Its resource was added to the SoT after
// this constant was written, so the generated snapshot accepted only two of the
// three identities the runtime accepts (MCP_GW_RESOURCE_URI carries all three).
// Importing that snapshot made HasValidMcpAudience false for every A2A token —
// and rule 45678901-0004 denies NOT that condition — so ALL A2A TRAFFIC WOULD
// HAVE BEEN DENIED, with the same all-or-nothing shape as the step-0 blocker
// this reconcile pass exists to prevent. Adding a gateway resource to the SoT
// means adding it here; snapshotAudienceParity.test.js now fails if it does not.
const GATEWAY_RESOURCE_NAMES = [
  'Super Banking MCP Gateway',
  'Super Banking PingGateway MCP',
  'Super Banking A2A MCP Gateway',
];
// D-05 anti-bypass blacklist — parity with demo_authz_server/scopeTopology.js
// upstreamAudiences(): the SoT upstream resources plus the banking RS (env-driven
// with the same default), minus the gateway's own URI.
const UPSTREAM_RESOURCE_NAMES = ['Super Banking MCP Server', 'Super Banking MCP Invest'];
const BANKING_RS_URI_DEFAULT = 'https://banking-resource-server.ping.demo';
// Every DecisionContext value that must route to the MCP Delegation policy.
// The condition originally listed only McpFirstTool + McpToolCall, but both
// gateways send McpToolsList for tools/list and McpRequest for session
// lifecycle. Those fell through to `NOT IsMcpFirstToolRequest`, so the
// Transaction policy evaluated them with no Amount and returned an
// unconditional PERMIT — no MCP delegation rule ever ran for tool discovery.
const MCP_DECISION_CONTEXTS = ['McpFirstTool', 'McpToolCall', 'McpToolsList', 'McpRequest'];
const COND = {
  HasValidActorChain: '23456789-0009-4321-abcd-000000000009',
  HasMFAAuthentication: '23456789-0003-4321-abcd-000000000003',
  RequiresA2aDelegation: '23456789-0011-4321-abcd-000000000011',
  HasValidMcpAudience: '23456789-0007-4321-abcd-000000000007',
  RequiresHitlConsent: '23456789-0010-4321-abcd-000000000010',
  RequiresMcpStepUp: '23456789-0013-4321-abcd-000000000013',
  IsConsentTransaction: '23456789-0014-4321-abcd-000000000014',
  IsMcpFirstToolRequest: '23456789-0008-4321-abcd-000000000008',
  RarAmountExceeded: '23456789-0020-4321-abcd-000000000020', // RAR grant present AND Amount > RarMaxAmount (landed via #611)
  // UC21 tier conditions (step 10). Already imported and live-verified; this
  // reconciler now GENERATES their contents from the banking manifest instead of
  // leaving them hand-authored. Rules 45678901-0012/-0013 reference them and are
  // NOT regenerated — only the data inside the conditions moves.
  IsStandardTier: '23456789-0015-4321-abcd-000000000015',
  IsTierRestrictedTool: '23456789-0016-4321-abcd-000000000016',
  ExceedsTierAmountCap: '23456789-0018-4321-abcd-000000000018',
  // New fine-grained deny conditions (cloud delta). -0020 is taken by
  // RarAmountExceeded above; -0021 is retired (its ver() version suffix
  // collides with #615's bumped RAR condition version — see the ATTR map note).
  ResourceOwnerMismatch: '23456789-0022-4321-abcd-000000000022', // NOT -0021 (retired)
  IntentTokenTampered: '23456789-0023-4321-abcd-000000000023',
  IntentToolMismatch: '23456789-0024-4321-abcd-000000000024',
  AdminRoleOnWriteTool: '23456789-0025-4321-abcd-000000000025',
  TokenAudTargetsUpstream: '23456789-0026-4321-abcd-000000000026',
  TokenKidUnpublished: '23456789-0027-4321-abcd-000000000027',
};
const STMT = {
  a2aDelegationRequired: '34567890-0010-4321-abcd-000000000010',   // code mcp-invalid-a2a-generalist (shared)
  stepUp: '34567890-0003-4321-abcd-000000000003',           // step-up-required (reused)
  mcpSharedDeny: '34567890-0004-4321-abcd-000000000004',    // mcp-authorization-denied (shared, reused)
  hitl: '34567890-0009-4321-abcd-000000000009',             // HITL (reused)
  txConsent: '34567890-0011-4321-abcd-000000000011',        // new transaction consent
  // New fine-grained deny statements (cloud delta). One rule each -> shared:false.
  // -0017 is retired (the mcp-rar-amount-exceeded statement, superseded by
  // rar_amount_exceeded at -0020 which landed via #611); -0021 is retired
  // (its ver() version suffix collides with #615's bumped RAR statement
  // version — see the ATTR map note).
  bypassAttempt: '34567890-0015-4321-abcd-000000000015',
  resourceOwnerMismatch: '34567890-0016-4321-abcd-000000000016',
  intentInvalid: '34567890-0018-4321-abcd-000000000018',
  intentMismatch: '34567890-0019-4321-abcd-000000000019',
  rarAmountExceeded: '34567890-0020-4321-abcd-000000000020', // rar_amount_exceeded (DENY)
  adminRole: '34567890-0022-4321-abcd-000000000022',         // NOT -0021 (retired)
  invalidKid: '34567890-0027-4321-abcd-000000000027',        // mcp-invalid-kid (DENY)
};
const RULE = {
  mcpHitl: '45678901-0008-4321-abcd-000000000008',          // existing (generalized)
  mcpStepUp: '45678901-0010-4321-abcd-000000000010',        // new
  txConsent: '45678901-0011-4321-abcd-000000000011',        // new
  rarAmountExceeded: '45678901-0020-4321-abcd-000000000020', // new: RAR amount-cap DENY
  mcpPermitValid: '45678901-0007-4321-abcd-000000000007',
  txPermitStandard: '45678901-0003-4321-abcd-000000000003',
  mcpDenyAudience: '45678901-0004-4321-abcd-000000000004',  // existing — condition 0007 changes, the rule does NOT
  // New fine-grained deny rules (cloud delta), all in the MCP Delegation policy.
  // -0017 is retired (mcpDenyRarAmount, superseded by rarAmountExceeded above);
  // -0020 is taken by rarAmountExceeded; -0021 is retired (its ver() version
  // suffix collides with #615's bumped RAR rule version — see the ATTR map note).
  mcpDenyUpstreamAud: '45678901-0015-4321-abcd-000000000015',
  mcpDenyResourceOwner: '45678901-0016-4321-abcd-000000000016',
  mcpDenyIntentInvalid: '45678901-0018-4321-abcd-000000000018',
  mcpDenyIntentMismatch: '45678901-0019-4321-abcd-000000000019',
  mcpDenyAdminRole: '45678901-0022-4321-abcd-000000000022',  // NOT -0021 (retired)
  mcpDenyInvalidKid: '45678901-0027-4321-abcd-000000000027',
};
const POLICY = { transaction: '56789012-0001-4321-abcd-000000000001', mcp: '56789012-0002-4321-abcd-000000000002' };
const CONFIRM_USD = '250';

// ⚠️ Version-UUID generation for the reconciler-owned tier conditions (step 10).
//
// PingOne's snapshot import SKIPS an object whose version is unchanged — the
// exact trap #615 hit with the RAR quartet ("the live import would skip the
// objects again"). So a regenerated condition whose VERSION did not move is a
// no-op in the cloud: the console shows the old ceiling and the demo enforces a
// stale limit while git looks correct.
//
// Every other version UUID in this file uses group `4321`. `4322` is generation
// 2 and is therefore unique file-wide, and it sorts after `4321` under either an
// identity or an ordering interpretation of "newer".
//
// BUMP THIS (4323, 4324, …) IN THE SAME COMMIT AS ANY CHANGE TO banking's
// manifest `tiers` block. reconcile() prints a warning when it rewrites tier
// content, because forgetting this is silent.
const TIER_VERSION_GROUP = '4322';
const tierVer = (id) => `bbbbbbbb-${id.slice(9, 13)}-${TIER_VERSION_GROUP}-abcd-${id.slice(24)}`;

function toolOr(tools) {
  return { or: { conditions: tools.map((t) => ({
    comparison: { left: { attribute: { id: ATTR.ToolName } }, op: 'Equals', right: { constant: { value: t } } },
  })) } };
}

// ⚠️ Version UUIDs are CONTENT-DERIVED. This is load-bearing, not cosmetic.
//
// PingOne's snapshot import SKIPS an object whose version is unchanged. The old
// `ver()` derived the version from the object's ID alone, so an object's content
// could change forever while its version stayed frozen — and every regeneration
// of it was a guaranteed no-op in the cloud. git looked correct, the file WAS
// correct, and the live policy silently kept the old content with nothing to
// indicate it.
//
// That is not hypothetical. AdminRoleOnWriteTool grew from 84 to 87 write tools
// (the UC28 request-only chips) at a frozen version `…-0025-4321-…`. The live
// environment had the 84-tool version, the repo had the 87-tool version, and
// re-importing could never have closed the gap.
//
// A drift check cannot catch this class: the committed file and the regenerated
// file AGREE. The drift is between the file and the cloud, which the generator
// cannot see. Deriving the version group from a hash of the content is what makes
// "the file is right" actually imply "the import lands" — any content change
// moves the version automatically, so no one has to remember to bump anything.
//
// TIER_VERSION_GROUP above stays as-is: those conditions are reconciled in place
// (step 10) against content already in the snapshot, and their guard warns
// separately. The RAR quartet's hand-pinned versions (#615) also stay parked.
const contentGroup = (content) => crypto.createHash('sha256')
  .update(JSON.stringify(content)).digest('hex').slice(0, 4);

/**
 * Version uuid follows the house pattern — same digits as the id — with the
 * group segment carrying a short hash of the object's content.
 */
const ver = (prefix, id, content) => `${prefix}-${id.slice(9, 13)}-${contentGroup(content)}-${id.slice(19)}`;

/** A STRING/NUMBER/BOOLEAN attribute resolved from the decision request. */
function requestAttr(id, name, valueType, defaultValue, description) {
  return {
    objectType: 'AttributeDefinition', id,
    version: ver('aaaaaaaa', id, { name, valueType, defaultValue, description }), type: 'ATTRIBUTE',
    name, fullName: name, description, parentId: null, numberOfChildren: null,
    valueProcessor: null, valueType,
    resolvers: [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }],
    defaultValue, repetitionSource: null, valueSchema: null,
  };
}

function conditionDef(id, name, description, condition) {
  return {
    objectType: 'ConditionDefinition', id,
    version: ver('bbbbbbbb', id, { name, description, condition }), type: 'CONDITION',
    name, fullName: name, description, parentId: null, numberOfChildren: null, condition,
  };
}

/**
 * A DENY statement. The decision response must expose ONLY `code` to the BFF
 * obligation classifier (it reads type||id||code — an extra field would shadow
 * the code and silently defeat the gate); `id`/`type` here are snapshot
 * structure, not response fields.
 */
function denyStatement(id, name, code, description, payload) {
  return {
    id, version: ver('cccccccc', id, { name, code, description, payload }),
    type: 'Statement', name, shared: false, description,
    code, appliesTo: 'DENY', appliesIf: 'PATH_MATCHES', payload,
    obligatory: false, attributes: [], services: [],
  };
}

/** A conditional-deny rule carrying [specific statement, shared mcp-authorization-denied]. */
function denyRule(id, name, description, condId, stmtId) {
  return {
    id, version: ver('dddddddd', id, { name, description, condId, stmtId }),
    type: 'Rule', targets: [], name, description,
    shared: false, disabled: false, statements: [stmtId, STMT.mcpSharedDeny],
    effectSettings: { type: 'conditionalDenyElsePermit', condition: { and: { conditions: [{ reference: { id: condId } }] } } },
    condition: { empty: {} },
  };
}

/** Pure SoT derivation (exported for tests — loadSot() is the file-reading wrapper). */
function deriveSot(sot) {
  const tools = sot.tools || {};
  const consent = [];
  const stepUp = [];
  const writeTools = [];
  const a2aDelegated = [];
  for (const [name, meta] of Object.entries(tools)) {
    if (!meta || typeof meta !== 'object') continue;
    if (meta.challengeType === 'consent') consent.push(name);
    else if (meta.challengeType === 'step_up') stepUp.push(name);
    // Same derivation as demo_authz_server/scopeTopology.js isWriteTool().
    if ((meta.requiredScopes || []).includes('write')) writeTools.push(name);
    // UC2: tools reachable ONLY through a specialist delegation. Same flag the
    // mock reads via scopeTopology.isA2aDelegatedTool().
    if (meta.a2aDelegated === true) a2aDelegated.push(name);
  }
  consent.sort(); stepUp.sort(); writeTools.sort(); a2aDelegated.sort();
  // Step 0 — the accepted gateway identities, by resource NAME. A missing entry
  // must abort generation: emitting a partial OR would silently deny one
  // gateway's entire traffic on import.
  const resources = sot.resources || {};
  const requireUri = (name, why) => {
    const uri = resources[name] && resources[name].uri;
    if (!uri) {
      throw new Error(
        `scope-topology.json resources is missing "${name}" (or its uri) — ` +
        `cannot derive ${why}; refusing to emit a partial rule.`
      );
    }
    return uri;
  };
  const acceptedGatewayAudiences = GATEWAY_RESOURCE_NAMES.map((name) =>
    requireUri(name, 'the accepted MCP audience set (HasValidMcpAudience)'));
  // Parity with demo_authz_server/scopeTopology.js upstreamAudiences(): SoT
  // upstream URIs + banking RS (same env var, same default), minus the MCP
  // Gateway's own URI. Multi-aud tokens (space-joined) are only caught at the
  // PEP — the cloud DSL compares single strings.
  const gatewayUri = resources['Super Banking MCP Gateway'] && resources['Super Banking MCP Gateway'].uri;
  const upstreamAudiences = [
    ...UPSTREAM_RESOURCE_NAMES.map((name) => requireUri(name, 'the D-05 upstream audience blacklist')),
    process.env.BANKING_RESOURCE_SERVER_RESOURCE_URI || BANKING_RS_URI_DEFAULT,
  ].filter((u) => u && u !== gatewayUri);
  return { consent, stepUp, writeTools, a2aDelegated, acceptedGatewayAudiences, upstreamAudiences };
}

function loadSot() {
  return deriveSot(JSON.parse(fs.readFileSync(SOT, 'utf8')));
}

/**
 * Pure derivation of the UC21 tier policy from a vertical manifest's `tiers`
 * block (exported for tests — loadTiers() is the file-reading wrapper).
 *
 * Every guard below refuses to emit rather than emitting a rule that silently
 * gates nothing — the same stance as requireUri() above. A tier ceiling that
 * degrades to an unmatchable constant is indistinguishable from "no limit".
 */
function deriveTiers(manifest) {
  const tiers = (manifest && manifest.tiers) || {};
  const defs = tiers.definitions || {};
  const defaultTier = tiers.default || 'Standard';
  const names = Object.keys(defs);
  if (!names.length || !defs[defaultTier]) {
    throw new Error(
      `banking manifest tiers.definitions is empty or does not define tiers.default ("${defaultTier}") — ` +
      'cannot derive the UC21 tier ceilings; refusing to emit a partial rule.'
    );
  }
  // A ceiling must be a positive number, and the check must be on the RAW value:
  // Number(null) and Number('') are both 0, so a coercing guard would accept a
  // null ceiling and emit the constant "0" — a cap that denies every amount.
  // The opposite slip (undefined) emits "undefined", which no Amount exceeds, so
  // the cap enforces nothing. Both look present in the P1AZ console.
  const badCeiling = names.find((t) => {
    const v = defs[t].maxAmountUsd;
    return typeof v !== 'number' || !Number.isFinite(v) || v <= 0;
  });
  if (badCeiling) {
    throw new Error(
      `tiers.definitions.${badCeiling}.maxAmountUsd is not a positive number — the generated ceiling ` +
      'constant would either match nothing (no cap) or match everything (deny all).'
    );
  }
  // The cloud rule is `IsStandardTier AND IsTierRestrictedTool`, so a tool
  // restriction can only ever apply to the DEFAULT tier. A non-default tier
  // declaring restrictedTools would be silently dropped.
  const unmodelled = names.filter((t) => t !== defaultTier && (defs[t].restrictedTools || []).length > 0);
  if (unmodelled.length) {
    throw new Error(
      `tiers.definitions.${unmodelled[0]}.restrictedTools is non-empty, but the cloud rule ` +
      '"MCP Deny — Tier Tool Not Allowed" gates the DEFAULT tier only — that restriction would be ' +
      'silently dropped on import. Model the non-default tier explicitly before regenerating.'
    );
  }
  // Default tier first, then the rest alphabetically. Deterministic (so --check
  // is stable) and it preserves the branch order the committed snapshot carries.
  const order = [defaultTier, ...names.filter((t) => t !== defaultTier).sort()];
  return {
    defaultTier,
    // [tier, ceiling] pairs. Ceilings are STRING constants: this DSL's proven
    // numeric form (see the ActChainDepth note in 1b) and what the committed
    // snapshot already uses — `Amount GreaterThan "2000"` demonstrably denies.
    ceilings: order.map((t) => [t, String(defs[t].maxAmountUsd)]),
    restrictedTools: [...(defs[defaultTier].restrictedTools || [])].sort(),
  };
}

function loadTiers() {
  return deriveTiers(JSON.parse(fs.readFileSync(BANKING_MANIFEST, 'utf8')));
}

function reconcile(snap, { consent, stepUp, writeTools, a2aDelegated, acceptedGatewayAudiences, upstreamAudiences }, tiers = loadTiers()) {
  const byId = new Map(snap.map((o) => [o.id, o]));
  const sepIdx = snap.findIndex((o) => o.type === 'SnapshotPackageFile$PackageSeparator');

  // 0) BLOCKER — HasValidMcpAudience must use SET semantics. The original
  // condition was `TokenAudience Equals McpResourceUri` (attribute-to-attribute
  // string equality). Post-C1 every caller sends the token's real single `aud`
  // as TokenAudience and the comma-joined accepted set as McpResourceUri, so
  // that equality is NEVER true and an import would deny all MCP traffic
  // (rule 45678901-0004 denies NOT this condition — the rule is unchanged).
  // Now: TokenAudience Equals any accepted gateway identity from the SoT.
  const audCond = byId.get(COND.HasValidMcpAudience);
  audCond.description =
    `TokenAudience (the token's real aud) is one of the accepted gateway identities ` +
    `(${acceptedGatewayAudiences.join(', ')}). A token minted for any other resource fails this ` +
    `and is denied by "MCP Deny — Invalid Token Audience". Generated from scope-topology.json ` +
    `gateway resource URIs for the AI Demo environment — do not hand-edit.`;
  audCond.condition = { or: { conditions: acceptedGatewayAudiences.map((uri) => ({
    comparison: { left: { attribute: { id: ATTR.TokenAudience } }, op: 'Equals', right: { constant: { value: uri } } },
  })) } };

  // 1) Generalize RequiresHitlConsent -> consent tool list.
  const hitlCond = byId.get(COND.RequiresHitlConsent);
  hitlCond.name = 'RequiresHitlConsent';
  hitlCond.fullName = 'RequiresHitlConsent';
  hitlCond.description =
    `ToolName is one of the consent-gated tools (${consent.join(', ')}) AND HitlApproved is not true. ` +
    `Fires the HITL approval obligation. On a verified retry (HitlApproved=true) this is false and the call proceeds. ` +
    `Generated from scope-topology.json (challengeType=consent) — do not hand-edit.`;
  hitlCond.condition = { and: { conditions: [
    toolOr(consent),
    { comparison: { left: { attribute: { id: ATTR.HitlApproved } }, op: 'NotEquals', right: { constant: { value: true } } } },
  ] } };

  // 1b) RequiresA2aDelegation — the UC2 control, and it was BACKWARDS.
  //
  // As inherited this condition was `ActChainDepth GreaterThan "1"`, attached to
  // a conditionalDenyElsePermit rule. Read it literally: DENY when the chain is
  // two-hop. That denies the CORRECT specialist delegation and permits the
  // generalist acting alone — the exact case UC2 exists to block, inverted.
  //
  // It never fired, which is the only reason A2A works: probed live 2026-07-27
  // against the imported policy, depth 1, 2 and 5 all PERMIT with valid actor
  // ids, and the rule sits at index 3 of a DenyOverrides policy so ordering
  // cannot explain it. So the rule is inert AND wrong — harmless today, but a
  // landmine: any future import that made it evaluate would break every A2A
  // demo while looking like enforcement.
  //
  // Correct semantics, matching mock Rule 1c's depth half: DENY when an
  // a2aDelegated tool is called WITHOUT a two-hop chain. The tool list comes
  // from scope-topology.json (a2aDelegated), never hand-typed, so adding a
  // specialist tool cannot silently leave it ungated. The constant is a NUMBER
  // to match ActChainDepth's valueType (NUMBER, defaultValue 0) rather than the
  // quoted "1" it carried.
  //
  // The generalist half of Rule 1c (nested act.sub must be the registered agent)
  // is already enforced live by "MCP Deny — Invalid Actor Chain", so this rule
  // deliberately covers depth only.
  const a2aCond = byId.get(COND.RequiresA2aDelegation);
  if (a2aCond) {
    a2aCond.name = 'RequiresA2aDelegation';
    a2aCond.fullName = 'RequiresA2aDelegation';
    a2aCond.description =
      `ToolName is one of the A2A-delegated tools (${a2aDelegated.join(', ')}) AND ActChainDepth < 2, ` +
      `i.e. NOT(ActChainDepth > 1) — the caller is not a specialist acting under a two-hop act chain. ` +
      `Fires the delegation-required DENY. ` +
      `Generated from scope-topology.json (a2aDelegated) — do not hand-edit.`;
    // depth < 2 expressed as NOT(depth > 1), and the constant is the STRING "1".
    //
    // Both deliberate. A survey of the whole snapshot: 162 string constants, 2
    // booleans, and — before this — ZERO numbers; `GreaterThan` appears 7 times,
    // `LessThan` zero. The first draft used `LessThan` with a numeric 2, which
    // introduced an untested operator AND an untested value type in one line.
    //
    // I had reasoned "ActChainDepth's valueType is NUMBER, so send a number",
    // but the live policy contradicts that: `Amount GreaterThan "2000"` is a
    // STRING constant and demonstrably denies a 5000 transfer. So string
    // constants are the proven form for numeric comparisons in this DSL, and
    // GreaterThan is the proven operator. Using only constructs this file
    // already exercises removes the import as a variable.
    a2aCond.condition = { and: { conditions: [
      toolOr(a2aDelegated),
      { not: { condition: {
        comparison: { left: { attribute: { id: ATTR.ActChainDepth } }, op: 'GreaterThan', right: { constant: { value: '1' } } },
      } } },
    ] } };
  }

  // 1c) The DENY message must describe what the rule now tests.
  //
  // The rule fires on a SHALLOW chain (no delegation), but its statement still
  // read "nested generalist '<id>' is not the registered AI Agent" — the reason
  // for a DIFFERENT rule. Left alone, the demo denies correctly and then explains
  // the denial wrongly on screen, which is worse than a wrong verdict because it
  // is not visibly wrong.
  //
  // The CODE stays mcp-invalid-a2a-generalist: DENY_CODE_BY_REASON_PREFIX in
  // demo_authz_server/routes/decision.js deliberately maps BOTH
  // a2a_delegation_required and invalid_a2a_generalist onto it, so consumers
  // already treat one code as covering both halves of mock Rule 1c. Changing it
  // would break that mapping for no gain.
  const a2aStmt = byId.get(STMT.a2aDelegationRequired);
  if (a2aStmt) {
    a2aStmt.name = 'MCP Denied — A2A Delegation Required';
    a2aStmt.description =
      'Returned when an A2A-delegated tool is called without a two-hop act chain — the generalist '
      + 'acting alone, or no delegation at all. PingOne Authorize validates the RFC 8693 chain depth, '
      + 'not just the immediate actor.';
    a2aStmt.payload = JSON.stringify({
      denied: true,
      reason: 'a2a-delegation-required',
      message:
        'A2A delegation is required for this tool: the call did not arrive through a two-hop act '
        + 'chain (specialist delegated by the generalist). The generalist acting alone is denied.',
    });
  }

  // 1d) HasValidActorChain — the A2A specialists were never added to it.
  //
  // The condition is an OR of `ActClientId Equals <registered actor>`. It
  // carried 7 ids; the tenant has 9 A2A specialists. The four missing
  // (tax, finaid, supplier, holdings) map EXACTLY to the four verticals that
  // failed verify:a2a-policy with depth2=DENY after the policy import —
  // government, university, manufacturing, investment. They were denied by THIS
  // rule (mcp-invalid-actor), not by the delegation-depth rule, so a correct
  // two-hop chain was rejected for having an unrecognised specialist.
  //
  // UNION, never replace. The client ids live only in demo_api_server/.env,
  // which is gitignored — so a checkout without it (CI, a fresh clone, another
  // worktree) must not be able to SHRINK the list and silently un-register a
  // specialist. Ids already in the snapshot are always kept; env only adds.
  // That also keeps `--check` deterministic: a machine with no .env regenerates
  // byte-identical output instead of failing the drift gate.
  const actorCond = byId.get(COND.HasValidActorChain);
  if (actorCond) {
    const existing = [];
    const collect = (n) => {
      if (!n || typeof n !== 'object') return;
      const v = n.comparison && n.comparison.right && n.comparison.right.constant;
      if (v && typeof v.value === 'string') existing.push(v.value);
      Object.values(n).forEach(collect);
    };
    collect(actorCond.condition);

    const fromEnv = Object.keys(process.env)
      .filter((k) => /^PINGONE_A2A_[A-Z0-9]+_AGENT_CLIENT_ID$/.test(k))
      .map((k) => (process.env[k] || '').trim())
      .filter(Boolean);

    const actors = [...new Set([...existing, ...fromEnv])].sort();
    if (actors.length > existing.length) {
      console.log(`  actor chain: +${actors.length - existing.length} specialist id(s) from env`);
    }
    actorCond.description =
      `ActClientId is one of the registered chain identities (${actors.length}): the MCP Token `
      + `Exchanger, the AI Agent, and each A2A specialist. A two-hop chain whose specialist is not `
      + `listed here is denied as an invalid actor, regardless of chain depth. Union of the ids `
      + `already in the snapshot and PINGONE_A2A_*_AGENT_CLIENT_ID — never shrinks.`;
    // The RULE description is what a reader sees in the policy UI. It said
    // "any of the 5 A2A specialist agents" while the list held 7 and the tenant
    // had 9 — a stale count is how nobody noticed four specialists were absent.
    const actorRule = byId.get('45678901-0006-4321-abcd-000000000006');
    if (actorRule) {
      actorRule.description =
        `DENY when ActClientId is not one of the ${actors.length} registered chain identities `
        + `(the MCP Token Exchanger, the AI Agent, and each A2A specialist). Validates the RFC 8693 `
        + `delegation chain has a known registered actor. Generated — do not hand-edit the list.`;
    }
    actorCond.condition = { or: { conditions: actors.map((id) => ({
      comparison: { left: { attribute: { id: ATTR.ActClientId } }, op: 'Equals', right: { constant: { value: id } } },
    })) } };
  }

  // 2) Ensure RequiresMcpStepUp condition (step_up tool list AND no MFA yet).
  const stepUpCond = {
    objectType: 'ConditionDefinition', id: COND.RequiresMcpStepUp,
    version: 'bbbbbbbb-0013-4321-abcd-000000000013', type: 'CONDITION',
    name: 'RequiresMcpStepUp', fullName: 'RequiresMcpStepUp',
    description: `ToolName is one of the step-up-gated tools (${stepUp.join(', ')}) AND the user has NOT completed MFA. ` +
      `Fires the step-up obligation on the MCP path. Generated from scope-topology.json (challengeType=step_up) — do not hand-edit.`,
    parentId: null, numberOfChildren: null,
    condition: { and: { conditions: [
      toolOr(stepUp),
      { not: { condition: { reference: { id: COND.HasMFAAuthentication } } } },
    ] } },
  };

  // 3) Ensure IsConsentTransaction condition (transaction-path amount consent).
  const txConsentCond = {
    objectType: 'ConditionDefinition', id: COND.IsConsentTransaction,
    version: 'bbbbbbbb-0014-4321-abcd-000000000014', type: 'CONDITION',
    name: 'IsConsentTransaction', fullName: 'IsConsentTransaction',
    description: `Amount exceeds $${CONFIRM_USD} — the consent (HITL) threshold for transactions. ` +
      `Step-up ($500) and deny ($2,000) take precedence in the BFF obligation classifier.`,
    parentId: null, numberOfChildren: null,
    condition: { and: { conditions: [
      { comparison: { left: { attribute: { id: ATTR.Amount } }, op: 'GreaterThan', right: { constant: { value: CONFIRM_USD } } } },
    ] } },
  };

  // Upsert the two new conditions just before the package separator.
  for (const cond of [stepUpCond, txConsentCond]) {
    const existing = snap.findIndex((o) => o.id === cond.id && o.objectType === 'ConditionDefinition');
    if (existing >= 0) snap[existing] = cond;
    else snap.splice(snap.findIndex((o) => o.type === 'SnapshotPackageFile$PackageSeparator'), 0, cond);
  }

  // 3b) Widen IsMcpFirstToolRequest to every MCP DecisionContext the gateways
  // actually send. Both policies are guarded on this condition (the MCP policy
  // on it, the Transaction policy on its negation), so a context missing here
  // is silently routed to the Transaction policy and, with no Amount present,
  // reaches only the always-true Permit Standard rule.
  const mcpCtxCond = byId.get(COND.IsMcpFirstToolRequest);
  mcpCtxCond.description =
    `DecisionContext is one of ${MCP_DECISION_CONTEXTS.join(', ')} — identifies an MCP request ` +
    `(BFF first-tool gate, gateway tool call, tool discovery, or session lifecycle) and routes it ` +
    `to the MCP Delegation policy. Generated — do not hand-edit.`;
  mcpCtxCond.condition = { or: { conditions: MCP_DECISION_CONTEXTS.map((ctx) => ({
    comparison: { left: { attribute: { id: ATTR.DecisionContext } }, op: 'Equals', right: { constant: { value: ctx } } },
  })) } };

  // 4) Generalize the MCP HITL rule wording (condition ref unchanged — 0010).
  const mcpHitlRule = byId.get(RULE.mcpHitl);
  mcpHitlRule.name = 'MCP Require HITL Consent for sensitive tools';
  mcpHitlRule.description =
    'PERMIT with HITL obligation when ToolName is a consent-gated tool and HitlApproved is not true ' +
    '(see RequiresHitlConsent, generated from scope-topology.json challengeType=consent). On a verified ' +
    'receipt retry the condition is false and the call proceeds via MCP Permit Valid. HitlApproved MUST NOT discharge step-up MFA.';

  // 5) Ensure MCP step-up rule.
  const mcpStepUpRule = {
    id: RULE.mcpStepUp, version: 'dddddddd-0010-4321-abcd-000000000010', type: 'Rule', targets: [],
    name: 'MCP Require Step-Up for sensitive tools',
    description: 'PERMIT with step-up obligation when ToolName is a step-up-gated tool and the user has not completed MFA ' +
      '(see RequiresMcpStepUp, generated from scope-topology.json challengeType=step_up). The BFF returns HTTP 428 (mcp_step_up_required).',
    shared: false, disabled: false, statements: [STMT.stepUp],
    effectSettings: { type: 'unconditionalPermit' },
    condition: { and: { conditions: [{ reference: { id: COND.RequiresMcpStepUp } }] } },
  };
  {
    const i = snap.findIndex((o) => o.id === RULE.mcpStepUp && o.type === 'Rule');
    if (i >= 0) snap[i] = mcpStepUpRule;
    else snap.splice(snap.findIndex((o) => o.id === RULE.mcpPermitValid && o.type === 'Rule'), 0, mcpStepUpRule);
  }

  // 6) Ensure transaction consent statement + rule.
  const txConsentStmt = {
    id: STMT.txConsent, version: 'cccccccc-0011-4321-abcd-000000000011', type: 'Statement',
    name: 'Transaction Consent Required', shared: false,
    description: "Returned when a transaction is at or above the $250 consent threshold and requires explicit human approval. " +
      "Code contains HITL_CONSENT so the BFF obligation classifier sets consentRequired (HTTP 428).",
    code: 'HITL_CONSENT', appliesTo: 'PERMIT', appliesIf: 'PATH_MATCHES',
    payload: `{"consentRequired": true, "message": "Transaction of $\{{${ATTR.Amount}}} requires explicit consent before proceeding.", "amount": "{{${ATTR.Amount}}}"}`,
    obligatory: false, attributes: [], services: [],
  };
  {
    const i = snap.findIndex((o) => o.id === STMT.txConsent && o.type === 'Statement');
    if (i >= 0) snap[i] = txConsentStmt;
    else snap.splice(snap.findIndex((o) => o.type === 'SnapshotPackageFile$PackageSeparator' && snap.indexOf(o) > sepIdx) >= 0
      ? snap.indexOf(byId.get(RULE.txPermitStandard))
      : snap.length, 0, txConsentStmt);
  }
  const txConsentRule = {
    id: RULE.txConsent, version: 'dddddddd-0011-4321-abcd-000000000011', type: 'Rule', targets: [],
    name: 'Require Consent for Mid-Value Transactions',
    description: 'PERMIT with consent obligation when Amount > $250. Step-up ($500 transfers/withdrawals) and Deny ($2,000) ' +
      'take precedence via DenyOverrides + the BFF obligation classifier (step-up dominates consent).',
    shared: false, disabled: false, statements: [STMT.txConsent],
    effectSettings: { type: 'unconditionalPermit' },
    condition: { and: { conditions: [{ reference: { id: COND.IsConsentTransaction } }] } },
  };
  {
    const i = snap.findIndex((o) => o.id === RULE.txConsent && o.type === 'Rule');
    if (i >= 0) snap[i] = txConsentRule;
    else snap.splice(snap.findIndex((o) => o.id === RULE.txPermitStandard && o.type === 'Rule'), 0, txConsentRule);
  }

  // 7) Ensure rule membership in the two policies (before the catch-all permit).
  const addChild = (policyId, ruleId, beforeRuleId) => {
    const pol = byId.get(policyId);
    if (pol.children.some((c) => c.id === ruleId)) return;
    const idx = pol.children.findIndex((c) => c.id === beforeRuleId);
    pol.children.splice(idx >= 0 ? idx : pol.children.length, 0, { id: ruleId, type: 'Rule' });
  };
  addChild(POLICY.mcp, RULE.mcpStepUp, RULE.mcpPermitValid);
  addChild(POLICY.transaction, RULE.txConsent, RULE.txPermitStandard);

  // 8) Fine-grained deny rules the cloud PDP was missing. Each mirrors a mock
  // rule in demo_authz_server/routes/decision.js; all live in the MCP
  // Delegation policy (DenyOverrides) before the catch-all permit.
  const upsert = (obj, insertIdx) => {
    const i = snap.findIndex((o) => o.id === obj.id && o.type === obj.type);
    if (i >= 0) snap[i] = obj;
    else snap.splice(insertIdx(), 0, obj);
  };
  const afterLastAttrIdx = () => {
    let last = -1;
    snap.forEach((o, i) => { if (o.objectType === 'AttributeDefinition') last = i; });
    return last + 1;
  };
  const beforeSepIdx = () => snap.findIndex((o) => o.type === 'SnapshotPackageFile$PackageSeparator');
  const beforeFirstPolicyIdx = () => snap.findIndex((o) => o.type === 'Policy');

  // 8a) D-05 anti-bypass (mock Rule 0b-2): the token's ACTUAL aud must not
  // target an upstream resource behind the gateway. LIMITATION: the cloud DSL
  // compares single strings, so only a single-aud token is caught here; a
  // space-joined multi-aud value is only caught at the PEP (gateway) and mock.
  upsert(requestAttr(ATTR.TokenAudActual, 'TokenAudActual', 'STRING', '',
    "The ACTUAL aud claim of the presented token, as introspected (single value; a multi-aud token is space-joined " +
    "and only caught at the PEP). Used by the D-05 anti-bypass deny. Default '' keeps the rule inert when absent."), afterLastAttrIdx);
  upsert(conditionDef(COND.TokenAudTargetsUpstream, 'TokenAudTargetsUpstream',
    `TokenAudActual equals one of the upstream/backend audiences behind the gateway (${upstreamAudiences.join(', ')}). ` +
    'A client must obtain a gateway-targeted token and let the gateway exchange it for the next hop (D-05, mock Rule 0b-2). ' +
    'Single-aud comparison only — space-joined multi-aud values are caught at the PEP. ' +
    'Generated from scope-topology.json resources — do not hand-edit.',
    { or: { conditions: upstreamAudiences.map((uri) => ({
      comparison: { left: { attribute: { id: ATTR.TokenAudActual } }, op: 'Equals', right: { constant: { value: uri } } },
    })) } }), beforeSepIdx);
  upsert(denyStatement(STMT.bypassAttempt, 'MCP Denied — Audience Targets Upstream', 'mcp-bypass-attempt',
    'D-05 (bypass_attempt): the token\'s actual aud targets an upstream resource behind the gateway — a confused-deputy bypass. Mirrors mock Rule 0b-2 and the Node gateway GatewayTokenPolicy.',
    `{"denied": true, "reason": "bypass_attempt", "message": "Token aud '{{${ATTR.TokenAudActual}}}' targets an upstream resource behind the gateway. Obtain a gateway-targeted token and let the gateway exchange it for the next hop (D-05).", "tokenAudActual": "{{${ATTR.TokenAudActual}}}"}`), beforeFirstPolicyIdx);
  upsert(denyRule(RULE.mcpDenyUpstreamAud, 'MCP Deny — Audience Targets Upstream',
    'DENY when TokenAudActual equals an upstream/backend audience (TokenAudTargetsUpstream). D-05 anti-bypass, mirroring mock Rule 0b-2. Single-aud only — multi-aud bypasses are caught at the PEP.',
    COND.TokenAudTargetsUpstream, STMT.bypassAttempt), beforeFirstPolicyIdx);

  // 8b) Resource-owner check (mock Rule 3.5a, NNP-3/UC10): when the caller
  // names the resource owner, it must be the requesting user.
  upsert(requestAttr(ATTR.ResourceOwnerId, 'ResourceOwnerId', 'STRING', '',
    "PingOne user id that OWNS the target resource, when the caller can name it. '' (default) means unknown/not applicable " +
    'and keeps the rule inert. Compared against UserId by the resource-owner deny (mock Rule 3.5a).'), afterLastAttrIdx);
  upsert(conditionDef(COND.ResourceOwnerMismatch, 'ResourceOwnerMismatch',
    'ResourceOwnerId is present AND does not equal UserId — the requester is not the owner of the target resource ' +
    '(account-takeover / Meta-chatbot pattern, mock Rule 3.5a). Attribute-to-attribute NotEquals is supported by the DSL.',
    { and: { conditions: [
      { comparison: { left: { attribute: { id: ATTR.ResourceOwnerId } }, op: 'NotEquals', right: { constant: { value: '' } } } },
      { comparison: { left: { attribute: { id: ATTR.ResourceOwnerId } }, op: 'NotEquals', right: { attribute: { id: ATTR.UserId } } } },
    ] } }), beforeSepIdx);
  upsert(denyStatement(STMT.resourceOwnerMismatch, 'MCP Denied — Resource Owner Mismatch', 'mcp-resource-owner-mismatch',
    'NNP-3/UC10 (resource_owner_mismatch): the target resource belongs to a different user than the requester. Mirrors mock Rule 3.5a.',
    `{"denied": true, "reason": "resource_owner_mismatch", "message": "Target resource belongs to '{{${ATTR.ResourceOwnerId}}}' but the request was made by '{{${ATTR.UserId}}}'. Possible cross-user resource access (account-takeover pattern).", "resourceOwnerId": "{{${ATTR.ResourceOwnerId}}}", "userId": "{{${ATTR.UserId}}}"}`), beforeFirstPolicyIdx);
  upsert(denyRule(RULE.mcpDenyResourceOwner, 'MCP Deny — Resource Owner Mismatch',
    'DENY when ResourceOwnerId is present and differs from UserId (ResourceOwnerMismatch). Mirrors mock Rule 3.5a; inert when the caller cannot name an owner.',
    COND.ResourceOwnerMismatch, STMT.resourceOwnerMismatch), beforeFirstPolicyIdx);

  // 8c) RAR amount ceiling — handled in step 9 (landed on main via #611/#612/#615
  // as RarAmountExceeded -> rar_amount_exceeded). The payee half of mock Rule 3c
  // needs array membership — PEP/mock only.

  // 8d) Intent-token binding (mock Rules 4a/4b). A PRESENT-and-TAMPERED intent
  // token fails closed; a benign 'expired' failure and an absent token ('') are
  // allowed through — intent binding is opt-in and the PDP cannot re-mint.
  upsert(requestAttr(ATTR.IntentTokenValid, 'IntentTokenValid', 'STRING', '',
    "'true' | 'false' | '' — whether the gateway validated a presented intent token. '' (default) means absent/disabled and keeps both intent rules inert."), afterLastAttrIdx);
  upsert(requestAttr(ATTR.IntentMatchesTool, 'IntentMatchesTool', 'STRING', '',
    "'true' | 'false' | '' — whether the invoked tool is in the validated intent token's permitted_tools. Only consulted when IntentTokenValid='true'."), afterLastAttrIdx);
  upsert(requestAttr(ATTR.IntentTokenError, 'IntentTokenError', 'STRING', '',
    "Why intent-token validation failed (malformed, invalid_signature, malformed_payload, expired, ...). Empty when valid/absent. Only tamper-class errors deny (mock INTENT_TAMPER_ERRORS)."), afterLastAttrIdx);
  upsert(conditionDef(COND.IntentTokenTampered, 'IntentTokenTampered',
    "IntentTokenValid = 'false' AND IntentTokenError is a tamper-class failure (malformed, invalid_signature, malformed_payload). " +
    "A tampered/forged intent token fails CLOSED (mock Rule 4a); a benign 'expired' failure or an absent token does not match.",
    { and: { conditions: [
      { comparison: { left: { attribute: { id: ATTR.IntentTokenValid } }, op: 'Equals', right: { constant: { value: 'false' } } } },
      { or: { conditions: ['malformed', 'invalid_signature', 'malformed_payload'].map((e) => ({
        comparison: { left: { attribute: { id: ATTR.IntentTokenError } }, op: 'Equals', right: { constant: { value: e } } },
      })) } },
    ] } }), beforeSepIdx);
  upsert(denyStatement(STMT.intentInvalid, 'MCP Denied — Intent Token Invalid', 'mcp-intent-invalid',
    'Intent binding (intent_token_invalid): a presented intent token failed validation with a tamper-class error. Mirrors mock Rule 4a.',
    `{"denied": true, "reason": "intent_token_invalid", "message": "Presented intent token failed validation ({{${ATTR.IntentTokenError}}}). Tampered or forged intent tokens fail closed.", "intentTokenError": "{{${ATTR.IntentTokenError}}}"}`), beforeFirstPolicyIdx);
  upsert(denyRule(RULE.mcpDenyIntentInvalid, 'MCP Deny — Intent Token Invalid',
    'DENY when a presented intent token is tampered (IntentTokenTampered — valid=false with a tamper-class error). Mirrors mock Rule 4a; expired/absent tokens are not denied here.',
    COND.IntentTokenTampered, STMT.intentInvalid), beforeFirstPolicyIdx);
  upsert(conditionDef(COND.IntentToolMismatch, 'IntentToolMismatch',
    "IntentTokenValid = 'true' AND IntentMatchesTool = 'false' — a VALID intent token was presented but the invoked tool is not in its permitted_tools (mock Rule 4b). Absent tokens ('') do not match.",
    { and: { conditions: [
      { comparison: { left: { attribute: { id: ATTR.IntentTokenValid } }, op: 'Equals', right: { constant: { value: 'true' } } } },
      { comparison: { left: { attribute: { id: ATTR.IntentMatchesTool } }, op: 'Equals', right: { constant: { value: 'false' } } } },
    ] } }), beforeSepIdx);
  upsert(denyStatement(STMT.intentMismatch, 'MCP Denied — Intent Tool Mismatch', 'mcp-intent-mismatch',
    'Intent binding (intent_mismatch): the tool is not permitted by the validated intent token. Mirrors mock Rule 4b.',
    `{"denied": true, "reason": "intent_mismatch", "message": "Tool '{{${ATTR.ToolName}}}' is not in the validated intent token's permitted_tools.", "toolName": "{{${ATTR.ToolName}}}"}`), beforeFirstPolicyIdx);
  upsert(denyRule(RULE.mcpDenyIntentMismatch, 'MCP Deny — Intent Tool Mismatch',
    'DENY when a valid intent token does not permit the invoked tool (IntentToolMismatch). Mirrors mock Rule 4b; inert when no intent token is presented.',
    COND.IntentToolMismatch, STMT.intentMismatch), beforeFirstPolicyIdx);

  // 8e) UserRole admin restriction (mock Rule 2.95). RESTRICTION direction
  // ONLY — admin may observe but not mutate customer state through the agent
  // (parity with middleware/auth.js requireNotAdmin, REGRESSION_PLAN §1).
  // Never add a permit-for-admin branch: that would reinstate F5.
  upsert(requestAttr(ATTR.UserRole, 'UserRole', 'STRING', 'none',
    "Caller role forwarded by the BFF ('admin' | 'customer'; lowercase). Default 'none' keeps the admin restriction inert. " +
    'A RESTRICTION input only — never a bypass (see mock Rule 2.95 / F5).'), afterLastAttrIdx);
  upsert(conditionDef(COND.AdminRoleOnWriteTool, 'AdminRoleOnWriteTool',
    `UserRole is 'admin' AND ToolName is one of the ${writeTools.length} customer write tools (requiredScopes includes ` +
    "'write' in scope-topology.json — same derivation as scopeTopology.isWriteTool). Mirrors mock Rule 2.95. Generated — do not hand-edit.",
    { and: { conditions: [
      { comparison: { left: { attribute: { id: ATTR.UserRole } }, op: 'Equals', right: { constant: { value: 'admin' } } } },
      toolOr(writeTools),
    ] } }), beforeSepIdx);
  upsert(denyStatement(STMT.adminRole, 'MCP Denied — Admin Role Not Permitted', 'mcp-admin-role-not-permitted',
    'Rule 2.95 (admin_role_not_permitted): an admin session may not drive customer write tools through the agent. Parity with requireNotAdmin; admin is a restriction, never a bypass.',
    `{"denied": true, "reason": "admin_role_not_permitted", "message": "Tool '{{${ATTR.ToolName}}}' mutates customer account state and is not available to an admin role. Switch to a customer session.", "toolName": "{{${ATTR.ToolName}}}", "userRole": "{{${ATTR.UserRole}}}"}`), beforeFirstPolicyIdx);
  upsert(denyRule(RULE.mcpDenyAdminRole, 'MCP Deny — Admin Role Not Permitted',
    'DENY when UserRole=admin invokes a customer write tool (AdminRoleOnWriteTool, generated from scope-topology.json). Mirrors mock Rule 2.95 / requireNotAdmin. Restriction only — no admin permit branch exists.',
    COND.AdminRoleOnWriteTool, STMT.adminRole), beforeFirstPolicyIdx);

  // 8f) Signing-key identity (mock deny_reason invalid_kid). The BFF resolves
  // the token header's kid against the live PingOne JWKS and forwards the
  // result as TokenKidKnown; this rule is what turns that input into a DENY.
  //
  // This is a key-IDENTITY check, NOT signature verification — it detects a
  // token whose header names a signing key the issuer does not publish. Do not
  // reword the payload to claim the signature was checked.
  //
  // Fail-open by construction: the BFF omits TokenKidKnown when membership is
  // unknown (no kid in the header, or the JWKS fetch failed), and the attribute
  // defaults TRUE, so the condition below is false and this rule stays inert.
  // Only an explicit false — a resolved, unpublished kid — denies. Same shape
  // as GroupMembershipFailed (InRequiredGroup Equals false on a BOOLEAN that
  // defaults true); no new operator/valueType combination is introduced (#1009).
  upsert(requestAttr(ATTR.TokenKidKnown, 'TokenKidKnown', 'BOOLEAN', true,
    'BFF-pre-resolved JWKS membership of the presented token header kid. true = the kid is published in the ' +
    "issuer's JWKS; false = it is not. The BFF OMITS this key when it cannot resolve membership, and the default " +
    'is TRUE so an absent value never denies — a JWKS outage degrades this check instead of denying every call. ' +
    'Pre-resolved BFF-side because this DSL cannot fetch a JWKS (same reason as InRequiredGroup).'), afterLastAttrIdx);
  upsert(requestAttr(ATTR.TokenKid, 'TokenKid', 'STRING', '',
    'The kid from the presented token header. Reportable input only — no rule branches on it; TokenKidUnpublished ' +
    "reads TokenKidKnown. Present so the deny payload and PingOne's recent-decisions log can name the key. " +
    "Default '' when the header carries no kid."), afterLastAttrIdx);
  upsert(conditionDef(COND.TokenKidUnpublished, 'TokenKidUnpublished',
    'TokenKidKnown = false — the token header names a signing key the issuer does not publish. Absent/unknown ' +
    '(attribute default true) does NOT match, so the rule is inert unless the BFF positively resolved the kid ' +
    'as unpublished. Key-identity check only; signature verification happens at authentication.',
    { comparison: { left: { attribute: { id: ATTR.TokenKidKnown } }, op: 'Equals', right: { constant: { value: false } } } }),
  beforeSepIdx);
  upsert(denyStatement(STMT.invalidKid, 'MCP Denied — Invalid Signing Key', 'mcp-invalid-kid',
    'Signing-key identity (invalid_kid): the token header names a kid that is not published in the issuer JWKS. ' +
    'Mirrors the simulated engine deny_reason invalid_kid. Not a signature-verification failure.',
    `{"denied": true, "reason": "invalid_kid", "message": "The token header names signing key '{{${ATTR.TokenKid}}}' which is not published in the issuer's JWKS. This is a key-identity check, not signature verification.", "kid": "{{${ATTR.TokenKid}}}", "toolName": "{{${ATTR.ToolName}}}"}`), beforeFirstPolicyIdx);
  upsert(denyRule(RULE.mcpDenyInvalidKid, 'MCP Deny — Invalid Signing Key',
    'DENY when the BFF resolved the token header kid as absent from the issuer JWKS (TokenKidUnpublished). ' +
    'Inert when TokenKidKnown is omitted — unknown is not "verified absent".',
    COND.TokenKidUnpublished, STMT.invalidKid), beforeFirstPolicyIdx);

  for (const ruleId of [
    RULE.mcpDenyUpstreamAud, RULE.mcpDenyResourceOwner,
    RULE.mcpDenyIntentInvalid, RULE.mcpDenyIntentMismatch, RULE.mcpDenyAdminRole,
    RULE.mcpDenyInvalidKid,
  ]) {
    addChild(POLICY.mcp, ruleId, RULE.mcpPermitValid);
  }
  // 9) RAR (RFC 9396) amount-cap enforcement — mirrors the simulated engine's
  // NNP-1 rar_amount_exceeded so PingOne Authorize (not just the gateway) denies
  // a tool call whose Amount exceeds the granted RarMaxAmount. The BFF/gateway
  // send RarMaxAmount (the azd.authorization_details[0].amount ceiling) on
  // delegated calls that carry a RAR grant; it is absent otherwise, so the guard
  // below keeps every non-RAR call unaffected.
  //
  // These four objects landed on main via #611/#612/#615 and are ALREADY
  // IMPORTED into the live environment. Keep them byte-exact — #615 bumped
  // their versions (id …-0020, version …-0021) so the defaultValue-0 fix
  // re-imports; do NOT reshape them through the round-3 helpers above (ver()
  // would silently revert the bumped versions and the live import would skip
  // the objects again).
  const rarUpsert = (obj, sameType) => {
    const i = snap.findIndex((o) => o.id === obj.id && (sameType ? o.objectType === obj.objectType : o.type === obj.type));
    if (i >= 0) snap[i] = obj;
    else snap.splice(snap.findIndex((o) => o.type === 'SnapshotPackageFile$PackageSeparator'), 0, obj);
  };

  // 9-pre) Amount defaultValue 0 — the SAME fix RarMaxAmount got below, applied to
  // the attribute that actually needed it first.
  //
  // Amount is a NUMBER with defaultValue null. An unresolved NUMBER makes every
  // comparison against it unresolvable, and P1AZ answers INDETERMINATE for the
  // WHOLE decision with no statements — see 9a's note, which describes this exact
  // mechanism for RarMaxAmount.
  //
  // ⚠️ READ TOOLS NEVER SEND Amount. mcpToolAuthorizationService only computes
  // toolAmount for tools in WRITE_TOOL_TYPE_MAP; for a read it is null and Amount
  // is omitted from the decision request entirely. So every read produced
  // INDETERMINATE. Probed live 2026-08-03 against env 01d89b06:
  //
  //     get_my_accounts, no Amount   -> INDETERMINATE (no statements)
  //     get_my_accounts, Amount 100  -> PERMIT [mcp-tool-authorized]
  //
  // and it aborted the control probe of BOTH verify:authorize-parity and
  // verifyA2aDelegationPolicy. Combined with the fail-closed normalisation in
  // #1310 (P1AZ INDETERMINATE -> DENY), pointing the Agent Gateway at the cloud
  // would have denied EVERY read.
  //
  // 0 is safe, not a loosening: the amount rules are all `Amount > ceiling`, and
  // 0 is greater than no ceiling, so no cap is bypassed. Writes are unaffected —
  // the PEP builds the request and always sends a real Amount for write tools, so
  // a caller cannot omit it to dodge a limit. The trade is "deny everything" for
  // "permit reads, still deny over-cap writes".
  //
  // Deliberately routed through requestAttr(): since #1311 its version is derived
  // from the object's CONTENT, so changing defaultValue moves the version and the
  // import actually lands. The RAR quartet below keeps its hand-pinned versions
  // for the reason stated at 877-880.
  rarUpsert(requestAttr(
    ATTR.Amount,
    'Amount',
    'NUMBER',
    0,
    'Transaction amount in US dollars. Sent by the Super Banking BFF on every '
    + 'transaction authorization request. defaultValue 0 (like RarMaxAmount) so an '
    + 'ABSENT amount — every READ tool call — resolves to 0 instead of leaving the '
    + 'comparison unresolved; an unresolved NUMBER makes the whole decision '
    + 'INDETERMINATE. 0 trips no ceiling, so reads PERMIT and caps still deny.',
  ), true);

  // 9a) RarMaxAmount request attribute (NUMBER) — same resolver shape as Amount.
  rarUpsert({
    objectType: 'AttributeDefinition', id: ATTR.RarMaxAmount,
    version: 'aaaaaaaa-0021-4321-abcd-000000000021', type: 'ATTRIBUTE',
    name: 'RarMaxAmount', fullName: 'RarMaxAmount',
    description: 'RFC 9396 RAR granted amount ceiling (azd.authorization_details[0].amount). ' +
      'Sent by the AI Demo BFF/gateway on delegated tool calls that carry a RAR grant; absent otherwise. ' +
      'defaultValue 0 (like HitlApproved=false) so an ABSENT grant resolves to 0 instead of leaving the ' +
      'comparison unresolved — an unresolved NUMBER makes the rule (and the whole MCP decision) INDETERMINATE.',
    parentId: null, numberOfChildren: null, valueProcessor: null,
    valueType: 'NUMBER',
    resolvers: [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }],
    // MUST be 0, not null: absent RarMaxAmount → 0 → the "RarMaxAmount > 0" guard
    // is false → the deny rule does not fire → ordinary (non-RAR) calls PERMIT.
    defaultValue: 0, repetitionSource: null, valueSchema: null,
  }, true);

  // 9b) RarAmountExceeded condition: a grant is present (RarMaxAmount > 0) AND the
  // requested Amount exceeds it. When no grant is attached (RarMaxAmount absent/0)
  // the guard is false, so ordinary calls never trip this.
  rarUpsert({
    objectType: 'ConditionDefinition', id: COND.RarAmountExceeded,
    version: 'bbbbbbbb-0021-4321-abcd-000000000021', type: 'CONDITION',
    name: 'RarAmountExceeded', fullName: 'RarAmountExceeded',
    description: 'RarMaxAmount > 0 (a RAR grant is present) AND Amount > RarMaxAmount. ' +
      'Absent grant → false → non-RAR calls unaffected. Mirrors simulatedAuthorizeService NNP-1.',
    parentId: null, numberOfChildren: null,
    condition: { and: { conditions: [
      { comparison: { left: { attribute: { id: ATTR.RarMaxAmount } }, op: 'GreaterThan', right: { constant: { value: '0' } } } },
      { comparison: { left: { attribute: { id: ATTR.Amount } }, op: 'GreaterThan', right: { attribute: { id: ATTR.RarMaxAmount } } } },
    ] } },
  }, true);

  // 9c) rar_amount_exceeded DENY statement (code matches the simulated deny_reason).
  rarUpsert({
    id: STMT.rarAmountExceeded, version: 'cccccccc-0021-4321-abcd-000000000021', type: 'Statement',
    name: 'RAR Amount Exceeded', shared: false,
    description: 'Returned when the requested amount exceeds the RFC 9396 RAR granted ceiling. ' +
      'code rar_amount_exceeded surfaces as the deny_reason in the BFF/Token Chain.',
    code: 'rar_amount_exceeded', appliesTo: 'DENY', appliesIf: 'PATH_MATCHES',
    payload: `RAR amount enforcement: requested $\{{${ATTR.Amount}}} exceeds the granted ceiling of $\{{${ATTR.RarMaxAmount}}} ` +
      `(RFC 9396 authorization_details). The agent cannot exceed the attested limit even with a valid token.`,
    obligatory: false, attributes: [], services: [],
  });

  // 9d) RAR deny rule — conditionalDenyElsePermit, same shape as "Deny Large
  // Transactions". DenyOverrides makes this win when it fires.
  rarUpsert({
    id: RULE.rarAmountExceeded, version: 'dddddddd-0021-4321-abcd-000000000021', type: 'Rule', targets: [],
    name: 'Deny RAR Amount Overage',
    description: 'DENY when Amount exceeds the RFC 9396 RAR granted ceiling (RarMaxAmount). ' +
      'No RAR grant → condition false → permit contribution only. PingOne-side twin of the gateway requireRarIntent check.',
    shared: false, disabled: false, statements: [STMT.rarAmountExceeded],
    effectSettings: { type: 'conditionalDenyElsePermit', condition: { and: { conditions: [{ reference: { id: COND.RarAmountExceeded } }] } } },
    condition: { and: { conditions: [{ reference: { id: COND.RarAmountExceeded } }] } },
  });

  // 9e) Membership: MCP first-tool policy (before the catch-all permit). DenyOverrides
  // means placement is not strictly required, but keep it ahead of mcpPermitValid for clarity.
  addChild(POLICY.mcp, RULE.rarAmountExceeded, RULE.mcpPermitValid);

  // 10) UC21 banking tier policy — "$2,000 Standard vs $50,000 PrivateBanking;
  // group membership expands capability", the demo's most concrete authz story.
  //
  // The three conditions below were ALREADY in the cloud policy and already
  // imported (live-probed: create_transfer $5,000 as Standard -> DENY
  // mcp-tier-amount-exceeded). What they were NOT is generated — they sat
  // outside this reconciler with their tool list and ceilings hand-typed, and
  // they had drifted from the banking manifest's `tiers` block, which is what
  // groupPolicy.getTierDefinitions() feeds to simulatedAuthorizeService. Two
  // engines, two numbers, no gate. Generating them here is the fix.
  //
  // What stays at the PEP and why: tiers.groupToTier maps a PingOne group ARRAY
  // to a tier name, and this DSL has no set/contains operator (same wall as
  // TokenScopes and the RAR payee list). So the BFF resolves membership and
  // sends the scalar UserTier — the InRequiredGroup / TokenKidKnown precedent.
  // The CEILINGS deliberately stay here as policy constants: forwarding a
  // pre-computed UserMaxAmountUsd would leave P1AZ evaluating
  // `Amount > <whatever the BFF said>` and move the actual policy back into
  // JavaScript, which is the thing this relocation exists to undo.
  //
  // The RULES that reference these conditions (45678901-0012 Tier Tool Not
  // Allowed, -0013 Tier Amount Exceeded) and their statements are unchanged —
  // only the data inside the conditions is now derived.
  const tierChanged = [];
  const putTierCond = (id, name, description, condition) => {
    const existing = byId.get(id);
    const next = {
      objectType: 'ConditionDefinition', id, version: tierVer(id), type: 'CONDITION',
      name, fullName: name, description, parentId: null, numberOfChildren: null, condition,
    };
    // Compare CONTENT, not version: a content change with a stale version is
    // precisely the import-skip trap TIER_VERSION_GROUP guards.
    if (existing && JSON.stringify(existing.condition) !== JSON.stringify(condition)) {
      tierChanged.push(name);
    }
    snap[snap.indexOf(existing)] = next;
  };

  // 10a) IsStandardTier — the capped (default) tier, from tiers.default.
  putTierCond(COND.IsStandardTier, 'IsStandardTier',
    `UC21: UserTier equals '${tiers.defaultTier}' — the default, capped tier (manifest tiers.default). ` +
    `The other tiers and the inert attribute default 'none' do not match, so every tier rule is dormant ` +
    `until the BFF sends UserTier (ff_authorize_group_policy on). ` +
    `Generated from the banking manifest tiers block — do not hand-edit.`,
    { and: { conditions: [
      { comparison: { left: { attribute: { id: ATTR.UserTier } }, op: 'Equals', right: { constant: { value: tiers.defaultTier } } } },
    ] } });

  // 10b) IsTierRestrictedTool — the default tier's restrictedTools.
  //
  // UNION with what the snapshot already carries, never replace — the same rule
  // HasValidActorChain (1d) follows, and for the same reason: a generation pass
  // must not be able to SHRINK an enforcement list. The committed snapshot gates
  // create_withdrawal AND withdraw; the manifest lists only create_withdrawal.
  // That drift is real and is reported by the drift test — but resolving it by
  // dropping `withdraw` would quietly widen what a Standard user may do, so the
  // union keeps the cloud where it is and lets a human close the gap in the
  // manifest (the widening direction) deliberately.
  const restrictedExisting = [];
  {
    const cur = byId.get(COND.IsTierRestrictedTool);
    const collect = (n) => {
      if (!n || typeof n !== 'object') return;
      const v = n.comparison && n.comparison.right && n.comparison.right.constant;
      if (v && typeof v.value === 'string') restrictedExisting.push(v.value);
      Object.values(n).forEach(collect);
    };
    collect(cur.condition);
  }
  const restrictedTools = [...new Set([...restrictedExisting, ...tiers.restrictedTools])].sort();
  putTierCond(COND.IsTierRestrictedTool, 'IsTierRestrictedTool',
    `UC21: ToolName is one of the ${restrictedTools.length} tool(s) a '${tiers.defaultTier}' user may not call ` +
    `(${restrictedTools.join(', ')}) — group membership EXPANDS capability. Union of the manifest's ` +
    `tiers.definitions.${tiers.defaultTier}.restrictedTools and the ids already imported; never shrinks. ` +
    `Generated — do not hand-edit the list.`,
    toolOr(restrictedTools));

  // 10c) ExceedsTierAmountCap — one branch per tier, ceiling from the manifest.
  // The default tier's branch reuses the IsStandardTier reference (it is exactly
  // that comparison) so the emitted shape matches what is already imported.
  putTierCond(COND.ExceedsTierAmountCap, 'ExceedsTierAmountCap',
    `UC21 deny (tier_amount_exceeded): Amount exceeds the caller's per-tier ceiling — ` +
    `${tiers.ceilings.map(([t, max]) => `${t} $${Number(max).toLocaleString('en-US')}`).join(', ')}. ` +
    `Applied to EVERY tier, not just the capped one. Ceilings are generated from the banking manifest ` +
    `tiers.definitions[*].maxAmountUsd — the same numbers groupPolicy.getTierDefinitions() gives the ` +
    `simulated engine — so the two engines cannot disagree. Do not hand-edit.`,
    { or: { conditions: tiers.ceilings.map(([tier, max]) => ({
      and: { conditions: [
        tier === tiers.defaultTier
          ? { reference: { id: COND.IsStandardTier } }
          : { comparison: { left: { attribute: { id: ATTR.UserTier } }, op: 'Equals', right: { constant: { value: tier } } } },
        { comparison: { left: { attribute: { id: ATTR.Amount } }, op: 'GreaterThan', right: { constant: { value: max } } } },
      ] },
    })) } });

  if (tierChanged.length) {
    console.warn(
      `⚠️  tier condition content changed (${tierChanged.join(', ')}). PingOne SKIPS an object whose ` +
      `version is unchanged, so bump TIER_VERSION_GROUP (currently ${TIER_VERSION_GROUP}) in this file ` +
      'and regenerate, or the import is a no-op and the cloud keeps the OLD ceiling.'
    );
  }

  return snap;
}

function main() {
  const check = process.argv.includes('--check');
  const original = fs.readFileSync(SNAP, 'utf8');
  const snap = JSON.parse(original);
  reconcile(snap, loadSot());
  // One compact JSON object per line (matches the original snapshot format).
  const out = '[\n  ' + snap.map((o) => JSON.stringify(o)).join(',\n  ') + '\n]\n';
  if (check) {
    if (out !== original) { console.error('Snapshot out of date — run: node snapshots/gen-authorize-snapshot.js'); process.exit(1); }
    console.log('Snapshot up to date.'); return;
  }
  fs.writeFileSync(SNAP, out);
  const sot = loadSot();
  const tiers = loadTiers();
  console.log(`Reconciled snapshot: ${sot.consent.length} consent tools, ${sot.stepUp.length} step-up tools.`);
  console.log('consent:', sot.consent.join(', '));
  console.log('step_up:', sot.stepUp.join(', '));
  console.log('tier ceilings:', tiers.ceilings.map(([t, m]) => `${t} $${m}`).join(', '));
}

// Run only as a CLI, so the reconciler can be require()'d by its test without
// rewriting the snapshot as an import side effect.
if (require.main === module) main();

module.exports = {
  reconcile, loadSot, deriveSot, loadTiers, deriveTiers,
  MCP_DECISION_CONTEXTS, TIER_VERSION_GROUP, ATTR, COND, STMT, RULE, SNAP, BANKING_MANIFEST,
};
