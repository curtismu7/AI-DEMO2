// /gateway-claims, parts 6 and 7: what gateway (mcpgw) v1.261029, v1.261030 and v1.261102 changed since v1.261028, and the
// features of the 2026-11-02 Agent Privilege release that we have NOT measured on our tenant.
// SOURCE (read-only, 2026-11-01 and 2026-11-02): the public ECR registry (tags, digests, build dates, layer sizes), a symbol and
// string diff of the mcpgw binary in each image, and an anonymous re-fetch of the console swagger. We found no Ping release notes
// for these tags and nothing was tried on them except starting v1.261102 on our SE gateway, so every "what it does" statement is
// OUR READING of a symbol or string (UNVERIFIED).
// Doc: privilege/PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md, section 17. No tenant ids, hosts or secrets belong in this file.

export const BASELINE_VERSION = 'v1.261028';
export const VERSION_MIDDLE = 'v1.261029';
export const VERSION_THIRD = 'v1.261030';
export const VERSION_LATEST = 'v1.261102';
// The version list quoted in the page title, nav label, search aliases, Learning Hub card and diagrams index. Keep them in step.
export const PAGE_VERSIONS = 'v1.261024, v1.261027, v1.261028, v1.261029, v1.261030 and v1.261102';
export const RELEASE_DATE = '2026-11-02';
export const CHECKED_ON = '2026-11-02';
// Registry index digests (public image repository, read anonymously on CHECKED_ON). Kept apart from the prose exports so the
// "no ids or secrets" test can still scan those.
export const IMAGE_DIGESTS = {
  [VERSION_THIRD]: 'sha256:62037874a437b4fb60c85f5f7f889909e9fdb66b9f27558002f331917ee98298',
  [VERSION_LATEST]: 'sha256:36d29c0a0ea0575706819f23f2783e4f3a6aeb5f604d6d1717de66333b8eae47',
};

// What we know for certain: registry facts and what the console API did. VERIFIED = seen on the real thing today.
export const LATEST_FACTS = [
  { evidence: 'verified', text: `The public image repository has the tags ${BASELINE_VERSION}, ${VERSION_MIDDLE}, ${VERSION_THIRD} and ${VERSION_LATEST}, and no tag newer than ${VERSION_LATEST}. ${VERSION_LATEST} is a new image dated ${RELEASE_DATE} (15:43 UTC). The tag latest is still the same image as ${VERSION_THIRD}, so latest is one tag behind (checked ${CHECKED_ON}).` },
  { evidence: 'verified', text: `Our SE gateway was rolled from ${VERSION_THIRD} to ${VERSION_LATEST} on ${RELEASE_DATE}: the gateway container only, with the explicit tag, not latest. ${VERSION_LATEST} ran on our SE gateway and the new pod became ready (10 of 10 containers, 0 restarts); its log tail was empty. We did not repeat tools/list through it (6 tools on ${VERSION_THIRD}, from the 2026-11-01 baseline check) and tried none of the release features.` },
  { evidence: 'verified', text: `The console API spec (swagger), fetched anonymously on ${CHECKED_ON}, is byte for byte identical to the 2026-10-31 baseline (and to our 2026-11-01 fetch): 447 operations and 644 definitions, nothing added, removed or changed.` },
  { evidence: 'inferred', text: `From that unchanged spec we read the changes below as not being in the console API. This is an inference: the gateway can change without the console spec changing.` },
  { evidence: 'verified', text: `We looked at Ping's public release notes (PingOne Privilege, docs.pingidentity.com) on ${CHECKED_ON} and found nothing for any of these tags. The last entry is 2026-07-13; there is none for ${RELEASE_DATE}. This is a "checked, not found" from one look, not a statement from Ping.` },
  { evidence: 'unverified', text: `What ${VERSION_MIDDLE}, ${VERSION_THIRD} and ${VERSION_LATEST} do on our tenant is not known. Apart from the ${VERSION_LATEST} pod starting (above) and one tools/list on ${VERSION_THIRD}, nothing was run against them. Every row in the tables below is a reading of the binary.` },
];

// The two newest images side by side, from the registry manifests (linux/amd64 and linux/arm64, read anonymously on CHECKED_ON).
// REGISTRY FACTS only: nothing here says what the gateway does.
export const IMAGE_COMPARE = [
  { id: 'digest', item: 'Image index digest', a: IMAGE_DIGESTS[VERSION_THIRD], b: IMAGE_DIGESTS[VERSION_LATEST] },
  { id: 'built', item: 'Image built (UTC)', a: '2026-10-30 16:01', b: '2026-11-02 15:43' },
  { id: 'layers', item: 'Layers (each of linux/amd64 and linux/arm64)', a: '10', b: '10, of which 6 are byte-identical to the tag before (the Ubuntu base and the empty working-directory layer). The 4 that differ are the time-zone data install, the directory setup, mcpgw and cyctl' },
  { id: 'size', item: 'Compressed layers, linux/amd64 and linux/arm64 (bytes)', a: '286,802,980 and 262,394,144', b: '286,812,214 and 262,402,758' },
  { id: 'binaries', item: 'Uncompressed linux/amd64 binaries mcpgw and cyctl (bytes)', a: '244,570,600 and 239,959,232', b: '244,584,504 and 239,959,016' },
  { id: 'config', item: 'Start command, environment variable names, labels', a: 'Cmd /procyon/bin/mcpgw, no entrypoint; 7 variable names; 3 labels', b: 'identical (checked on both platforms)' },
];

// Build facts per tag. Dates are the image build time (UTC); sizes are the uncompressed mcpgw binary. Symbol counts are raw
// and include compiler temporaries, so they show how big the step was, not how many features changed. The v1.261102 row was
// counted on 2026-11-02 with llvm-nm on the linux/amd64 binary; the same method on v1.261029 to v1.261030 gives 25 added, 22
// removed against the 24 and 22 above (one symbol of difference between the two ways of counting).
export const RELEASE_TABLE = [
  { tag: BASELINE_VERSION, built: '2026-10-28 17:30', binary: '244,454,104', symbols: 'base for this table' },
  { tag: VERSION_MIDDLE, built: '2026-10-29 09:15', binary: '244,558,704', symbols: '80 added, 26 removed' },
  { tag: VERSION_THIRD, built: '2026-10-30 16:01', binary: '244,570,600', symbols: '24 added, 22 removed' },
  { tag: VERSION_LATEST, built: '2026-11-02 15:43', binary: '244,584,504', symbols: '32 added, 25 removed (25 of each are compiler temporaries, so 7 named added, 0 named removed)' },
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
  { id: 'rate-limit-delete', version: VERSION_THIRD, change: 'AgentCore rate-limit delete, resource-policy grading, rule listing',
    symbols: 'aws.DeleteAgentCoreGatewayRateLimit, gradeResourcePolicy, listOneGatewayRules; message "ActionTargetID must be <gatewayID>/<rateLimitID>" (v1.261029 says <ruleID>)',
    reading: 'Rate limits on an AgentCore gateway are now addressed by a rate-limit id, and can be deleted. The grading helper looks like part of the section 5 posture checks.' },
  { id: 'cyctl', version: VERSION_THIRD, change: 'The second binary in the image (cyctl) follows mcpgw',
    symbols: 'the same AgentCore helper functions as above; none removed',
    reading: 'Explains the size of the v1.261030 rebuild. We do not have a confirmed reason for the rebuild itself.' },
  { id: 'release-features', version: `${VERSION_MIDDLE} and ${VERSION_THIRD}`, change: `Anything named in the ${RELEASE_DATE} release`,
    symbols: 'none',
    reading: 'No symbol or message matches entitlement-aware discovery, aggregate cap, OBO redeem or scope layers. The only hold-related change is the rejected-approval memory above.' },
  { id: 'idp-claims', version: VERSION_LATEST, change: 'Claims read from the sign-in token, and a warning when there are none',
    symbols: 'mcpgw.withIDPClaims, (*AccessToken).EndUserResolved, (*AccessToken).KeyType; workloadid.SessionClaims, readClaims, ErrNotJWT; llmgw.endUserOf; message "[mcpgw] login token for app %s carries no usable claims, so claim-conditioned rules will not match"',
    reading: 'Looks like the gateway reads claims from the token a person signs in with, to work out the end user, and logs a warning when that token carries none, because a rule that matches on a claim (section 1) would then never match. We do not know when it triggers, what KeyType returns, or whether it changes any answer.' },
  { id: 'unplaced', version: VERSION_LATEST, change: 'Two new names we cannot place',
    symbols: 'RequesterResolved (a member name), routingError (a protobuf field name); neither is in v1.261030',
    reading: 'Names only. We cannot tell what they belong to or what they do.' },
  { id: 'rebuild-1102', version: VERSION_LATEST, change: 'Little else beyond build metadata',
    symbols: 'embedded version string and build time (Built on 2026-11-02 15:37 against 2026-10-30 15:55) and the source revision; the time-zone layer is installed again; cyctl gains the one symbol workloadid.ErrNotJWT',
    reading: 'Apart from the rows above, the two binaries show no meaningful difference. The other 25 added and 25 removed symbols are compiler temporaries.' },
  { id: 'release-features-1102', version: VERSION_LATEST, change: `Anything named in the ${RELEASE_DATE} release`,
    symbols: 'none',
    reading: 'No added symbol, and no new message we could pick out, mentions entitlements, an aggregate cap, OBO redeem, scope layers or hold. The nearest are the claim and end-user names above, and we cannot tie them to any of the five.' },
];

// The 2026-11-02 release features, as relayed to us (we cannot tell whether v1.261102 is that release). None is measured on our tenant: UNVERIFIED. "Our reading" is from the
// name only. "A test needs" says what we would have to set up; some of that is a tenant write that needs the owner's go-ahead.
export const NOT_MEASURED = [
  { id: 'discovery', feature: 'Entitlement-aware discovery',
    reading: 'tools/list shows a caller only the tools its entitlements allow (our reading of the name).',
    test: 'Two agent keys with different entitlements, the same tools/list through the gateway with each, and a comparison of the two lists. The baseline is one key returning 6 tools on v1.261030 (2026-11-01); it has not been repeated on v1.261102. Creating the second, lower-entitled key is a tenant write.' },
  { id: 'cap', feature: 'Aggregate cap',
    reading: 'A cap counted across calls together, not per key (our reading of the name).',
    test: 'A low-cap test key and a small burst of calls until the first refusal, with the refusal and the gateway log recorded. Keep the burst small; do not load the live gateway.' },
  { id: 'obo', feature: 'OBO redeem',
    reading: 'An agent redeems a delegated (on-behalf-of) token for a call made for a user (our reading of the name).',
    test: 'A PingFederate token that acts for a user and an agent app set up to accept it. Then redeem it and compare the sub and act claims the backend sees against the section 1 token.' },
  { id: 'layers', feature: 'Scope layers',
    reading: 'Tools layered by token scope. We already measured scope tiers with RequiredClaims on v1.261024 (section 3); whether this is the same thing or something new is unknown.',
    test: 'Repeat the section 3 tier run on the new release and compare the tool counts. The baseline is a token with opensearch:admin: 9 tools; a token with opensearch:read: 3 tools; a token with neither (openid alone): 403.' },
  { id: 'hold', feature: 'Hold',
    reading: 'A tool call waits for a human to approve it. The v1.261027 diff already shows an approval action and v1.261029 remembers rejections; v1.261102 adds no symbol or message about hold.',
    test: 'An AI policy that returns the approval action, a call that gets held, then one approve and one reject, and a retry of the rejected call to see whether it is held again or refused.' },
];

// Re-check list for when the release is confirmed. The same three comparisons the baseline note was taken for.
export const RECHECK_STEPS = [
  `Look for an image tag newer than ${VERSION_LATEST} in the public repository, and whether latest has moved off ${VERSION_THIRD}.`,
  'Fetch the console swagger again and diff it against the 2026-10-31 baseline.',
  `Repeat tools/list with the same key (6 tools on ${VERSION_THIRD}) and a second, lower-entitled key, on ${VERSION_LATEST}.`,
];
