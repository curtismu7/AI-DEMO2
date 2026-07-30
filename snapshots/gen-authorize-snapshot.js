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
 *
 * Usage:  node snapshots/gen-authorize-snapshot.js          (writes in place)
 *         node snapshots/gen-authorize-snapshot.js --check  (fail if out of date)
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const SOT = path.join(REPO, 'scope-topology.json');
const SNAP = path.join(__dirname, 'Super_Banking_Transaction_Authorization_P1AZ.snapshot.json');

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

function toolOr(tools) {
  return { or: { conditions: tools.map((t) => ({
    comparison: { left: { attribute: { id: ATTR.ToolName } }, op: 'Equals', right: { constant: { value: t } } },
  })) } };
}

/** Version uuid follows the house pattern: same digits as the id, prefixed group swapped. */
const ver = (prefix, id) => prefix + id.slice(8);

/** A STRING/NUMBER/BOOLEAN attribute resolved from the decision request. */
function requestAttr(id, name, valueType, defaultValue, description) {
  return {
    objectType: 'AttributeDefinition', id, version: ver('aaaaaaaa', id), type: 'ATTRIBUTE',
    name, fullName: name, description, parentId: null, numberOfChildren: null,
    valueProcessor: null, valueType,
    resolvers: [{ attributeResolverType: 'request', condition: { empty: {} }, valueProcessor: null, name: null }],
    defaultValue, repetitionSource: null, valueSchema: null,
  };
}

function conditionDef(id, name, description, condition) {
  return {
    objectType: 'ConditionDefinition', id, version: ver('bbbbbbbb', id), type: 'CONDITION',
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
    id, version: ver('cccccccc', id), type: 'Statement', name, shared: false, description,
    code, appliesTo: 'DENY', appliesIf: 'PATH_MATCHES', payload,
    obligatory: false, attributes: [], services: [],
  };
}

/** A conditional-deny rule carrying [specific statement, shared mcp-authorization-denied]. */
function denyRule(id, name, description, condId, stmtId) {
  return {
    id, version: ver('dddddddd', id), type: 'Rule', targets: [], name, description,
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

function reconcile(snap, { consent, stepUp, writeTools, a2aDelegated, acceptedGatewayAudiences, upstreamAudiences }) {
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
  console.log(`Reconciled snapshot: ${sot.consent.length} consent tools, ${sot.stepUp.length} step-up tools.`);
  console.log('consent:', sot.consent.join(', '));
  console.log('step_up:', sot.stepUp.join(', '));
}

// Run only as a CLI, so the reconciler can be require()'d by its test without
// rewriting the snapshot as an import side effect.
if (require.main === module) main();

module.exports = { reconcile, loadSot, deriveSot, MCP_DECISION_CONTEXTS, ATTR, COND, STMT, RULE, SNAP };
