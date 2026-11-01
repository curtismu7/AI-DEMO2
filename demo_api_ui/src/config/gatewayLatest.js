// /gateway-claims, parts 6 and 7: what gateway (mcpgw) v1.261029 and v1.261030 changed since v1.261028, and the
// features of the 2026-11-02 Agent Privilege release that we have NOT measured on our tenant.
// SOURCE (read-only, 2026-11-01): the public ECR registry (tags, build dates, layer sizes), a symbol and string diff of the
// mcpgw binary in each image, and an anonymous re-fetch of the console swagger. Ping published no release notes for these tags
// and nothing was run against them, so every "what it does" statement is OUR READING of a symbol or string (UNVERIFIED).
// Doc: privilege/PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md, section 17. No tenant ids, hosts or secrets belong in this file.

export const BASELINE_VERSION = 'v1.261028';
export const VERSION_MIDDLE = 'v1.261029';
export const VERSION_LATEST = 'v1.261030';
// The version list quoted in the page title, nav label, search aliases, Learning Hub card and diagrams index. Keep them in step.
export const PAGE_VERSIONS = 'v1.261024, v1.261027, v1.261028, v1.261029 and v1.261030';
export const RELEASE_DATE = '2026-11-02';
export const CHECKED_ON = '2026-11-01';

// What we know for certain: registry facts and what the console API did. VERIFIED = seen on the real thing today.
export const LATEST_FACTS = [
  { evidence: 'verified', text: `The public image repository has the tags ${BASELINE_VERSION}, ${VERSION_MIDDLE} and ${VERSION_LATEST}, and no tag newer than ${VERSION_LATEST}. The tag latest is the same image as ${VERSION_LATEST} (checked ${CHECKED_ON}).` },
  { evidence: 'verified', text: `Our SE gateway runs ${VERSION_LATEST} (read ${CHECKED_ON}). One tools/list through the gateway returned 6 tools.` },
  { evidence: 'verified', text: `The console API spec (swagger), fetched anonymously on ${CHECKED_ON}, is identical to the 2026-10-31 baseline: 447 operations and 644 definitions, nothing added, removed or changed. So none of the changes below is in the console API.` },
  { evidence: 'verified', text: 'Ping\'s public release notes list nothing for either tag. Their last entry is 2026-07-13 and there is no entry for the 2026-11-02 release yet.' },
  { evidence: 'unverified', text: `What ${VERSION_MIDDLE} and ${VERSION_LATEST} do on our tenant is not known. Nothing was run against them except the one tools/list above. Every row in the tables below is a reading of the binary.` },
];

// Build facts per tag. Dates are the image build time (UTC); sizes are the uncompressed mcpgw binary. Symbol counts are raw
// and include compiler temporaries, so they show how big the step was, not how many features changed.
export const RELEASE_TABLE = [
  { tag: BASELINE_VERSION, built: '2026-10-28 17:30', binary: '244,454,104', symbols: 'base for this table' },
  { tag: VERSION_MIDDLE, built: '2026-10-29 09:15', binary: '244,558,704', symbols: '80 added, 26 removed' },
  { tag: VERSION_LATEST, built: '2026-10-30 16:01', binary: '244,570,600', symbols: '24 added, 22 removed' },
];

// Meaningful changes, from the symbol lists with compiler noise filtered out. All UNVERIFIED readings.
export const SINCE_ROWS = [
  { id: 'rejected-hold', version: VERSION_MIDDLE, change: 'A rejected approval is not held again',
    symbols: 'aipolicy.(*PendingIndex).RememberRejected, LookupRejected, rejectedEntry; watcher.rejectionHorizon; message "the same request will not be held again"',
    reading: 'A rejected human-approval hold is remembered, so the same agent request is refused instead of being held a second time. Builds on the approval action first seen in the v1.261027 diff (section 3). The name rejectionHorizon is a symbol in v1.261029 and gone as a symbol in v1.261030; we do not know why.' },
  { id: 'aliases', version: VERSION_MIDDLE, change: 'Alias handling in the AI policy engine',
    symbols: 'aipolicy.(*Registry).Canonicalize, ResolveIdentities, aliasIndex, groupAliasIndex, rewriteAliasUIDs; watcher unprojectUser, unprojectGroup, unprojectIdentity, scheduleIdentityRecompile',
    reading: 'Looks like user and group names in a policy are mapped to one canonical identity, and policies are recompiled when identities change.' },
  { id: 'login-refusal', version: VERSION_MIDDLE, change: 'A login refusal path',
    symbols: 'mcpgw.(*Server).refuseLogin; mcpgw.(*McpRestAPIService).aiPolicyPrincipal',
    reading: 'The gateway can refuse a sign-in itself, and the REST service can name the principal an AI policy sees. We do not know when either triggers.' },
  { id: 'copilot', version: VERSION_MIDDLE, change: 'GitHub Copilot as a managed coding agent',
    symbols: 'codingagent.copilotArgs, copilotEvent, copilotResult, copilotTool; file path /etc/github-copilot/policy.d/privilege.json',
    reading: 'Reads like the gateway can write a policy file for the Copilot coding agent. Not run.' },
  { id: 'agentcore-inventory', version: VERSION_MIDDLE, change: 'More AgentCore inventory and rate-limit helpers',
    symbols: 'aws.MergeAgentCoreInventoryJSON, RegionFromARN, RegionsFromInventoryARNs, listGatewayRateLimits, updateGatewayRateLimit; PolicyEngineARN on the policy-engine record',
    reading: 'Builds on section 5: merging AgentCore inventory across regions, and listing and updating gateway rate limits.' },
  { id: 'pinning', version: VERSION_MIDDLE, change: 'Workload pinning steered to the runtime',
    symbols: 'message: runtime-level pinning (runtime authorizer hostingEnvironments) is the supported control',
    reading: 'When a workload is not pinned, the gateway now points at the runtime authorizer instead of pinning it itself. Read from one message; not run.' },
  { id: 'rate-limit-delete', version: VERSION_LATEST, change: 'AgentCore rate-limit delete, resource-policy grading, rule listing',
    symbols: 'aws.DeleteAgentCoreGatewayRateLimit, gradeResourcePolicy, listOneGatewayRules; message "ActionTargetID must be <gatewayID>/<rateLimitID>" (v1.261029 says <ruleID>)',
    reading: 'Rate limits on an AgentCore gateway are now addressed by a rate-limit id, and can be deleted. The grading helper looks like part of the section 5 posture checks.' },
  { id: 'cyctl', version: VERSION_LATEST, change: 'The second binary in the image (cyctl) follows mcpgw',
    symbols: 'the same AgentCore helper functions as above; none removed',
    reading: 'Explains the size of the v1.261030 rebuild. We do not have a confirmed reason for the rebuild itself.' },
  { id: 'release-features', version: `${VERSION_MIDDLE} and ${VERSION_LATEST}`, change: `Anything named in the ${RELEASE_DATE} release`,
    symbols: 'none',
    reading: 'No symbol or message matches entitlement-aware discovery, aggregate cap, OBO redeem or scope layers. The only hold-related change is the rejected-approval memory above.' },
];

// The 2026-11-02 release features, as relayed to us. None is measured on our tenant: UNVERIFIED. "Our reading" is from the
// name only. "A test needs" says what we would have to set up; some of that is a tenant write that needs the owner's go-ahead.
export const NOT_MEASURED = [
  { id: 'discovery', feature: 'Entitlement-aware discovery',
    reading: 'tools/list shows a caller only the tools its entitlements allow (our reading of the name).',
    test: 'Two agent keys with different entitlements, the same tools/list through the gateway with each, and a comparison of the two lists. Today one key returns 6 tools on v1.261030. Creating the second, lower-entitled key is a tenant write.' },
  { id: 'cap', feature: 'Aggregate cap',
    reading: 'A cap counted across calls together, not per key (our reading of the name).',
    test: 'A low-cap test key and a small burst of calls until the first refusal, with the refusal and the gateway log recorded. Keep the burst small; do not load the live gateway.' },
  { id: 'obo', feature: 'OBO redeem',
    reading: 'An agent redeems a delegated (on-behalf-of) token for a call made for a user (our reading of the name).',
    test: 'A PingFederate token that acts for a user and an agent app set up to accept it. Then redeem it and compare the sub and act claims the backend sees against the section 1 token.' },
  { id: 'layers', feature: 'Scope layers',
    reading: 'Tools layered by token scope. We already measured scope tiers with RequiredClaims on v1.261024 (section 3); whether this is the same thing or something new is unknown.',
    test: 'Repeat the section 3 tier run (admin, read, none) on the new release and compare the tool counts: 9, 3 and 403 are the baseline.' },
  { id: 'hold', feature: 'Hold',
    reading: 'A tool call waits for a human to approve it. The v1.261027 diff already shows an approval action and v1.261029 remembers rejections.',
    test: 'An AI policy that returns the approval action, a call that gets held, then one approve and one reject, and a retry of the rejected call to see whether it is held again or refused.' },
];

// Re-check list for when the release lands. The same three comparisons the baseline note was taken for.
export const RECHECK_STEPS = [
  `Look for an image tag newer than ${VERSION_LATEST} in the public repository.`,
  'Fetch the console swagger again and diff it against the 2026-10-31 baseline.',
  'Repeat tools/list with the same key and a second, lower-entitled key.',
];
