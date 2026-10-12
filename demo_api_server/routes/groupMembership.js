'use strict';

/**
 * groupMembership.js — vertical-scoped PingOne group membership for the demo UI.
 * Live directory lookup when worker creds exist; manifest fallback otherwise.
 */

const express = require('express');
const configStore = require('../services/configStore');
const groupPolicy = require('../services/groupPolicy');
const pingOneGroupMembershipService = require('../services/pingOneGroupMembershipService');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
const agentMcpTokenService = require('../services/agentMcpTokenService');
const a2aDelegationService = require('../services/a2aDelegationService');
const scopeTopology = require('../services/scopeTopology');
const { verticalManifest } = require('../services/verticalManifest');
const { requireSession } = require('../middleware/auth');
const { provisionVerticalGroups } = require('../services/pingOneGroupProvisionService');
const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');

const router = express.Router();

// Decision-board pacing. The board asks PingOne Authorize once per gated
// vertical (~13). Issued as one parallel burst, PingOne rate-limited it and all
// but the first two came back 429, so the board rendered UNKNOWN rows and the
// demo could not be shown. Serial + spaced + retried on 429 keeps every row
// real; the page is human-loaded, so the extra seconds cost nothing.
const DECISION_SPACING_MS = Number(process.env.GROUP_BOARD_SPACING_MS || 120);
const RATE_LIMIT_RETRIES = Number(process.env.GROUP_BOARD_RETRIES || 3);
const RATE_LIMIT_BACKOFF_MS = Number(process.env.GROUP_BOARD_BACKOFF_MS || 400);

/** Admin-only gate for group provisioning. */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin_required' });
  }
  return next();
}

/**
 * The PingOne user behind the session: { pingOneUserId, pingOneUsername }.
 *
 * A PingOne session's subject is that user (PingOne sub, not legacy numeric id).
 * A PingFederate session's subject is a PingFederate username, so the PingOne
 * account with the same username is used — its id for the directory calls, and
 * its own spelling of the username, which is what the toggle allowlist holds.
 * No such account means no live lookup, never the PingFederate subject.
 */
// ponytail: one PingOne user search per request under PingFederate; cache the
// id on the session if this panel is ever polled.
async function resolvePingOneUser(session) {
  const user = session?.user;
  if (!user) return { pingOneUserId: null, pingOneUsername: null };
  if (session.oauthProvider !== 'pingfederate') {
    return { pingOneUserId: user.oauthId || user.sub || null, pingOneUsername: user.username || null };
  }
  const { user: linked } = await fetchPingOneUserByUsername(user.username);
  return { pingOneUserId: linked?.id || null, pingOneUsername: linked?.username || null };
}

function resolveVerticalId(req) {
  const requested = req.query?.verticalId || req.body?.verticalId;
  if (typeof requested === 'string' && requested.trim()) return requested.trim();
  return verticalManifest.resolver.activeIdFor(req) || 'banking';
}

/**
 * GET /api/groups/membership
 * Returns the active vertical's group categories, the user's resolved membership,
 * and whether data came from PingOne directory or manifest fallback.
 */
router.get('/membership', requireSession, async (req, res) => {
  try {
    await configStore.ensureInitialized();
    verticalManifest.init();

    const verticalId = resolveVerticalId(req);
    const username = req.session?.user?.username || null;
    const { pingOneUserId } = await resolvePingOneUser(req.session);
    const manifest = verticalManifest.resolver.resolve(verticalId);
    if (!manifest) {
      return res.status(404).json({ error: 'unknown_vertical', verticalId });
    }
    const groupsConfig = manifest?.groups || null;

    let source = 'manifest';
    let groups = groupPolicy.groupsForUserSync(username, verticalId);

    if (pingOneUserId && pingOneGroupMembershipService.isReady()) {
      const live = await pingOneGroupMembershipService.listUserGroupNamesForVertical(
        pingOneUserId,
        verticalId,
      );
      if (Array.isArray(live)) {
        groups = live;
        source = 'pingone';
      }
    }

    const restrictedTools = {};
    if (groupsConfig?.restrictedTools) {
      for (const [tool, category] of Object.entries(groupsConfig.restrictedTools)) {
        restrictedTools[tool] = groupPolicy.groupNameForCategory(verticalId, category);
      }
    }

    res.json({
      verticalId,
      displayName: manifest?.identity?.displayName || verticalId,
      policyEnabled: groupPolicy.isEnabled(configStore),
      username,
      pingOneUserId,
      source,
      groups,
      userTier: groupPolicy.resolveUserTier(groups, verticalId),
      categories: groupsConfig?.categories || {},
      restrictedTools,
      liveLookupReady: pingOneGroupMembershipService.isReady(),
    });
  } catch (err) {
    console.error('[groupMembership] membership lookup failed:', err.message);
    res.status(500).json({
      error: 'group_membership_failed',
      message: err.message,
    });
  }
});

/**
 * GET /api/groups/decision-board
 *
 * One live PingOne Authorize decision per vertical, for that vertical's
 * group-gated tool, using the signed-in user's REAL directory membership.
 *
 * This is the page the group demo is for: flipping one membership and watching
 * every vertical move together is something no single chip can show. Each row is
 * a real decision from the same endpoint the PEP calls — not a simulation and not
 * a re-statement of the manifest, because the point being demonstrated is that
 * the POLICY decides.
 *
 * ⚠️ Costs one decision call per gated vertical (11 today). Fine for a demo page
 * a human loads; do not put it behind anything that polls.
 */
router.get('/decision-board', requireSession, async (req, res) => {
  try {
    await configStore.ensureInitialized();
    verticalManifest.init();

    const username = req.session?.user?.username || null;
    const { pingOneUserId } = await resolvePingOneUser(req.session);

    // Optional ?verticalId= narrows the board to one vertical's decision. The
    // board page now picks a vertical instead of firing one decision per gated
    // vertical on every load (~13 live Authorize calls + membership reads for a
    // single page view). Absent = every vertical, unchanged.
    const requestedVerticalId = typeof req.query?.verticalId === 'string'
      ? req.query.verticalId.trim()
      : '';

    // Every vertical that declares a group-gated tool, straight from the
    // manifests — so a vertical added later appears here with no code change.
    const targets = [];
    for (const def of groupPolicy.listAllVerticalGroupDefinitions()) {
      if (requestedVerticalId && def.verticalId !== requestedVerticalId) continue;
      for (const [tool, category] of Object.entries(def.restrictedTools || {})) {
        const manifest = verticalManifest.resolver.resolve(def.verticalId);
        targets.push({
          verticalId: def.verticalId,
          displayName: manifest?.identity?.displayName || def.verticalId,
          tool,
          requiredGroup: groupPolicy.groupNameForCategory(def.verticalId, category),
        });
      }
    }
    if (requestedVerticalId && targets.length === 0) {
      const manifest = verticalManifest.resolver.resolve(requestedVerticalId);
      if (!manifest) {
        return res.status(404).json({ error: 'unknown_vertical', verticalId: requestedVerticalId });
      }
      return res.json({
        username,
        pingOneUserId,
        liveLookupReady: pingOneGroupMembershipService.isReady(),
        policyEnabled: groupPolicy.isEnabled(configStore),
        rows: [],
      });
    }

    /**
     * Mint the two-hop token an a2aDelegated tool is actually called with.
     *
     * Returns the SAME envelope resolveMcpAccessTokenWithEvents does — { token }
     * on success, { token: null, blockCode, blockMessage } on refusal — so the
     * row's reporting below is identical for both mint paths and a delegation
     * refusal reads as a refusal, not as a policy verdict on the user's groups.
     *
     * Delegation can still fail (missing Agent 2 credentials, exchange error).
     * When it does, the row says so rather than presenting a one-hop token that
     * would deny for a reason the operator cannot see.
     */
    const mintDelegated = async (t) => {
      const d = await a2aDelegationService.delegateToSpecialist(req, {
        vertical: t.verticalId,
        tool: t.tool,
        subtask: `group-policy decision board probe for ${t.tool}`,
      });
      if (d && d.token) { return { token: d.token }; }
      // Falling back to the one-hop mint rather than presenting nothing.
      // Presenting no token at all makes the PDP answer
      // mcp-invalid-audience — strictly less informative than the
      // mcp-invalid-a2a-generalist ("delegation required") it returns when it can
      // see a real one-hop chain. The row keeps the better verdict AND says why it
      // could not be probed as delegated.
      return {
        token: null,
        fallback: await agentMcpTokenService.resolveMcpAccessTokenWithEvents(req, t.tool),
        note: `a2a delegation unavailable (${(d && d.error) || 'no token returned'}) — probed with a one-hop token, which this tool denies by design`,
      };
    };

    // One decision at a time, NOT Promise.all. Firing all ~13 in parallel made
    // PingOne Authorize rate-limit the burst: the first two returned real
    // decisions and every later one came back 429, so the board rendered
    // 11 UNKNOWN rows and the demo it exists for could not be shown. A human
    // loads this page once; a few seconds of serial calls is the right trade.
    const evaluateRow = async (t) => {
      // Membership is per-vertical because listGroupNamesForVertical filters to
      // that vertical's declared groups — even though one generic group now
      // serves them all, this keeps working if that is ever split again.
      let groups = groupPolicy.groupsForUserSync(username, t.verticalId);
      let source = 'manifest';
      if (pingOneUserId && pingOneGroupMembershipService.isReady()) {
        const live = await pingOneGroupMembershipService
          .listUserGroupNamesForVertical(pingOneUserId, t.verticalId);
        if (Array.isArray(live)) { groups = live; source = 'pingone'; }
      }
      const inRequiredGroup = Boolean(t.requiredGroup && groups.includes(t.requiredGroup));

      // Mint the SAME token the PEP would present for this tool, and read the
      // audience and act chain off it.
      //
      // Without this the board sent no TokenAudience at all. That is the honest
      // encoding for a caller that never read a token (see the C1 preamble in
      // pingOneAuthorizeService: absent values are omitted, never fabricated) —
      // but it also meant the PDP fail-closed on mcp-invalid-audience before the
      // group rule was ever reached, so EVERY row denied for the same reason no
      // matter who was in which group. The page claims "change the membership
      // and every row moves with it"; it could not move.
      //
      // Fabricating the expected URI would have been a one-line fix and is
      // exactly what C1 rule 1 forbids. Presenting a real token is the honest
      // way to get a real answer: the decision below is now the same question
      // the PEP asks, with the same evidence.
      let tokenClaims = null;
      let a2aNote = null;
      let tokenError = null;
      try {
        // WithEvents, not resolveMcpAccessToken: the plain wrapper returns just
        // the token, so a refusal arrived as a silent null and the row reported
        // tokenPresented:false with no reason at all — "it didn't work" and
        // nothing more. The blocked path sets need_auth / blockedReason on the
        // result rather than throwing, so the only way to say WHY is to read it.
        // An a2aDelegated tool is reachable ONLY through a specialist delegated by
        // the generalist — Authorize's DenyA2aDelegationRequired rule denies
        // ActChainDepth < 2 for exactly these tools. A directly-minted token is
        // therefore the wrong evidence: the row denied on the delegation shape and
        // never reached the group rule, so membership could not move it. That is the
        // same failure the audience bug had (#2016), one rule later.
        //
        // The SoT is scope-topology's `a2aDelegated` flag, NOT the tool-name list in
        // pac/policies/mcp-delegation.yaml — the two agree today (verified: the 10
        // flagged tools are exactly the ones that denied), and reading the flag keeps
        // them from drifting apart silently.
        let minted = scopeTopology.isA2aDelegatedTool(t.tool)
          ? await mintDelegated(t)
          : await agentMcpTokenService.resolveMcpAccessTokenWithEvents(req, t.tool);
        if (minted && minted.note) { a2aNote = minted.note; minted = minted.fallback; }
        if (minted && minted.token) {
          // decodeJwtClaims returns { header, claims } — NOT the claims. Reading
          // .aud straight off it is always undefined, which made every row report
          // "no aud claim" against a perfectly good token. Every other caller in
          // routes/ already unwraps .claims; this was the one that did not.
          tokenClaims = agentMcpTokenService.decodeJwtClaims(minted.token)?.claims || null;
          // A token that mints fine but carries no readable `aud` is its own
          // failure, and it used to be the ONE case with no explanation: the
          // refusal branches below all set tokenError, so a row reading
          // tokenPresented:false with tokenError:null could only mean this —
          // which required deducing the state from the ABSENCE of an error.
          // That is the same silence this instrumentation exists to remove.
          if (!tokenClaims) {
            tokenError = 'minted token is not a readable JWT — no claims could be decoded';
          } else if (tokenClaims.aud == null) {
            tokenError = 'minted token carries no aud claim, so no audience can be presented';
          }
        } else if (minted) {
          // Keep this a STRING. describeBlockedToken() returns an HTTP envelope
          // ({ httpStatus, body }) meant for a route to send, not a message —
          // dropping that object into the row would nest a whole response inside
          // a field the UI renders as text.
          tokenError = minted.blockCode
            ? `${minted.blockCode}: ${minted.blockMessage || 'token minting blocked'}`
            : minted.need_auth
              ? 'need_auth: no usable user token in session for this tool'
              : 'mint returned no token';
        } else {
          tokenError = 'mint returned no result';
        }
      } catch (err) {
        // Keep going with no audience rather than dropping the row: a row that
        // says DENY/mcp-invalid-audience with tokenError set is still true, and
        // more useful than a blank.
        tokenError = err.message;
      }
      // A real mint failure outranks the note — the note explains why the probe is
      // one-hop, not why there is no token.
      if (a2aNote && !tokenError) { tokenError = a2aNote; }
      const tokenAudience = tokenClaims && tokenClaims.aud != null
        ? (Array.isArray(tokenClaims.aud) ? tokenClaims.aud.join(' ') : String(tokenClaims.aud))
        : null;
      const act = (tokenClaims && tokenClaims.act) || null;

      try {
        const r = await pingOneAuthorizeService.evaluateMcpToolDelegation({
          userId: pingOneUserId,
          clientId: pingOneUserId,
          toolName: t.tool,
          verticalId: t.verticalId,
          requiredGroup: t.requiredGroup,
          userGroups: groups,
          inRequiredGroup,
          // Omitted (not '') when the mint failed — same contract as the PEP.
          ...(tokenAudience != null ? { tokenAudience } : {}),
          ...(act ? {
            actClientId: act.client_id || act.sub || '',
            nestedActClientId: (act.act && (act.act.client_id || act.act.sub)) || '',
            actChainDepth: act.act ? 2 : 1,
          } : {}),
          userTier: groupPolicy.resolveUserTier(groups, t.verticalId),
        });
        const codes = ((r.raw && r.raw.statements) || []).map((s) => s.code).filter(Boolean);
        return {
          ...t, inRequiredGroup, source, decision: r.decision, codes,
          // Say whether a real token backed this decision. A row that denied
          // because no token could be minted must not be read as a policy
          // verdict on the user's membership.
          tokenPresented: tokenAudience != null,
          ...(tokenError ? { tokenError } : {}),
        };
      } catch (err) {
        // A failed probe must read as UNKNOWN, never as PERMIT. A board that
        // shows green when it could not ask is worse than one that shows nothing.
        return {
          ...t, inRequiredGroup, source, decision: 'UNKNOWN', codes: [], error: err.message,
          tokenPresented: tokenAudience != null,
          ...(tokenError ? { tokenError } : {}),
        };
      }
    };

    /** True when the failure is PingOne throttling us, which is worth retrying. */
    const isRateLimited = (row) =>
      row && row.decision === 'UNKNOWN' && /\(429\)|429\b|rate.?limit/i.test(row.error || '');

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const rows = [];
    for (const t of targets) {
      let row = await evaluateRow(t);
      // Backoff on 429 only. Anything else is a real error and stays UNKNOWN
      // immediately — retrying a policy_not_found just delays the same answer.
      for (let attempt = 0; attempt < RATE_LIMIT_RETRIES && isRateLimited(row); attempt += 1) {
        await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
        row = await evaluateRow(t);
      }
      rows.push(row);
      await sleep(DECISION_SPACING_MS);
    }

    rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return res.json({
      username,
      pingOneUserId,
      liveLookupReady: pingOneGroupMembershipService.isReady(),
      policyEnabled: groupPolicy.isEnabled(configStore),
      rows,
    });
  } catch (err) {
    console.error('[groupMembership] decision board failed:', err.message);
    return res.status(500).json({ error: 'decision_board_failed', message: err.message });
  }
});

/**
 * GET /api/groups/check?username=&verticalId=
 *
 * One live Authorize decision for one picked user against one vertical's
 * group-gated tool — the single-check counterpart of the decision board, which
 * can only ask about the signed-in user. The group-check panel uses it to answer
 * "is demoDelegate in Banking_Privileged, and what does policy say?" live,
 * mid-demo, without signing in as anyone else.
 *
 * The decision is the same evaluate call the PEP makes, fed the picked user's
 * REAL directory groups — the evidence chain is identical to the board's.
 */
router.get('/check', requireSession, async (req, res) => {
  try {
    await configStore.ensureInitialized();
    verticalManifest.init();

    const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
    const verticalId = resolveVerticalId(req);
    if (!username) {
      return res.status(400).json({ error: 'username_required' });
    }
    const manifest = verticalManifest.resolver.resolve(verticalId);
    if (!manifest) {
      return res.status(404).json({ error: 'unknown_vertical', verticalId });
    }

    const { user: picked, error: lookupError } = await fetchPingOneUserByUsername(username);
    if (!picked) {
      return res.status(404).json({ error: 'user_not_found', message: lookupError || undefined });
    }

    // The vertical's group-gated tool — the first entry in the manifest's
    // restrictedTools, the same source the decision board iterates. The gate
    // group is THAT tool's category (premiumTier on every vertical today),
    // not the generic `privileged` group nothing reads — the demo's claim is
    // that the group the PEP consults decides, so the panel must ask about it.
    const def = groupPolicy.listAllVerticalGroupDefinitions()
      .find((d) => d.verticalId === verticalId);
    const gatedTool = def && def.restrictedTools
      ? Object.keys(def.restrictedTools)[0]
      : null;
    const gatedCategory = def && def.restrictedTools && gatedTool
      ? def.restrictedTools[gatedTool]
      : 'privileged';
    const requiredGroup = groupPolicy.groupNameForCategory(verticalId, gatedCategory);
    if (!requiredGroup) {
      return res.status(400).json({
        error: 'unknown_group_category',
        message: `vertical '${verticalId}' declares no '${gatedCategory}' group`,
      });
    }

    let groups = [];
    let source = 'manifest';
    if (pingOneGroupMembershipService.isReady()) {
      const live = await pingOneGroupMembershipService.listUserGroupNamesForVertical(
        picked.id, verticalId,
      );
      if (Array.isArray(live)) { groups = live; source = 'pingone'; }
    }
    const inRequiredGroup = groups.includes(requiredGroup);

    try {
      const r = await pingOneAuthorizeService.evaluateMcpToolDelegation({
        userId: picked.id,
        clientId: picked.id,
        toolName: gatedTool || undefined,
        verticalId,
        requiredGroup,
        userGroups: groups,
        inRequiredGroup,
        userTier: groupPolicy.resolveUserTier(groups, verticalId),
      });
      const codes = ((r.raw && r.raw.statements) || []).map((s) => s.code).filter(Boolean);
      return res.json({
        username: picked.username || username,
        verticalId,
        displayName: manifest?.identity?.displayName || verticalId,
        requiredGroup,
        gatedTool,
        userGroups: groups,
        inRequiredGroup,
        source,
        access: manifest?.groups?.access || null,
        decision: r.decision,
        denyReason: (r.raw && r.raw.deny_reason) || null,
        codes,
        policyEnabled: groupPolicy.isEnabled(configStore),
        liveLookupReady: pingOneGroupMembershipService.isReady(),
        raw: r.raw || null,
      });
    } catch (err) {
      // A failed probe must read as UNKNOWN, never as PERMIT — same rule as the
      // decision board: a page that shows green when it could not ask proves
      // nothing.
      return res.json({
        username: picked.username || username,
        verticalId,
        displayName: manifest?.identity?.displayName || verticalId,
        requiredGroup,
        gatedTool,
        userGroups: groups,
        inRequiredGroup,
        source,
        access: manifest?.groups?.access || null,
        decision: 'UNKNOWN',
        denyReason: null,
        codes: [],
        policyEnabled: groupPolicy.isEnabled(configStore),
        liveLookupReady: pingOneGroupMembershipService.isReady(),
        error: err.message,
      });
    }
  } catch (err) {
    console.error('[groupMembership] check failed:', err.message);
    return res.status(500).json({ error: 'group_check_failed', message: err.message });
  }
});

/**
 * POST /api/groups/check/toggle
 *
 * Move the PICKED demo user in or out of a vertical's privileged group, live in
 * PingOne. The check panel's demo is the transition: take demoDelegate out, the
 * next check denies; add them back, it permits. The signed-in toggle
 * (/membership/toggle) can only move the session user, so the panel needs this.
 *
 * Same rules as that toggle: a real directory write (a simulated toggle would
 * move the UI and not the decision), the response is the post-write re-read
 * from PingOne rather than what was requested, and the service allowlists the
 * three seeded demo usernames so this cannot reassign a real user.
 *
 * Body: { inGroup: boolean, username: string, verticalId?: string }
 */
router.post('/check/toggle', requireSession, async (req, res) => {
  try {
    await configStore.ensureInitialized();
    verticalManifest.init();

    const { inGroup, username } = req.body || {};
    if (typeof inGroup !== 'boolean') {
      return res.status(400).json({ error: 'inGroup must be a boolean' });
    }
    if (typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ error: 'username_required' });
    }
    const verticalId = resolveVerticalId(req);
    const manifest = verticalManifest.resolver.resolve(verticalId);
    if (!manifest) {
      return res.status(404).json({ error: 'unknown_vertical', verticalId });
    }
    // The group the TOOL requires — the restrictedTools category, same as
    // /check — so the panel's toggle moves the group the demo decision reads.
    const def = groupPolicy.listAllVerticalGroupDefinitions()
      .find((d) => d.verticalId === verticalId);
    const gatedTool = def && def.restrictedTools
      ? Object.keys(def.restrictedTools)[0]
      : null;
    const gatedCategory = def && def.restrictedTools && gatedTool
      ? def.restrictedTools[gatedTool]
      : 'privileged';
    const groupName = groupPolicy.groupNameForCategory(verticalId, gatedCategory);
    if (!groupName) {
      return res.status(400).json({
        error: 'unknown_group_category',
        message: `vertical '${verticalId}' declares no '${gatedCategory}' group`,
      });
    }

    const { user: picked, error: lookupError } = await fetchPingOneUserByUsername(username.trim());
    if (!picked) {
      return res.status(404).json({ error: 'user_not_found', message: lookupError || undefined });
    }

    // The service enforces the demo-username allowlist (user_not_toggleable)
    // — the same guard the signed-in toggle relies on.
    await pingOneGroupMembershipService.setUserGroupMembership({
      username: picked.username || username.trim(),
      pingOneUserId: picked.id,
      groupName,
      inGroup,
    });

    // Read back from PingOne rather than echoing the request, exactly like the
    // signed-in toggle: a write that silently no-ops must show as unchanged.
    const groups = await pingOneGroupMembershipService.listUserGroupNamesForVertical(
      picked.id, verticalId,
    );
    return res.json({
      verticalId,
      username: picked.username || username.trim(),
      displayName: manifest?.identity?.displayName || verticalId,
      groupName,
      access: manifest?.groups?.access || null,
      requested: inGroup,
      inGroup: Array.isArray(groups) ? groups.includes(groupName) : inGroup,
      groups: groups || [],
      userTier: groupPolicy.resolveUserTier(groups || [], verticalId),
      verified: Array.isArray(groups),
    });
  } catch (err) {
    const code = err.code === 'user_not_toggleable' ? 403
      : err.code === 'group_not_found' ? 404
        : 500;
    console.error('[groupMembership] check toggle failed:', err.message);
    return res.status(code).json({
      error: err.code || 'group_check_toggle_failed',
      message: err.message,
    });
  }
});

/**
 * POST /api/groups/membership/toggle
 * Move the SIGNED-IN demo user in or out of the active vertical's group for a
 * category (default `privileged`), live in PingOne.
 *
 * Body: { inGroup: boolean, category?: string }
 *
 * Why a real directory write: groupPolicy.groupsForUser() prefers a live lookup,
 * so a simulated toggle would change the UI and not the decision. The demo's
 * whole claim is that the policy decides — a toggle that only moves a local flag
 * would prove nothing while looking identical.
 *
 * Deliberately NOT admin-gated: the point is that the person running the demo
 * flips their own membership without leaving the app. The service allowlists the
 * three seeded demo usernames, so this cannot reassign a real user.
 */
router.post('/membership/toggle', requireSession, async (req, res) => {
  try {
    await configStore.ensureInitialized();
    verticalManifest.init();

    const { inGroup, category = 'privileged' } = req.body || {};
    if (typeof inGroup !== 'boolean') {
      return res.status(400).json({ error: 'inGroup must be a boolean' });
    }

    const verticalId = resolveVerticalId(req);
    const username = req.session?.user?.username || null;
    const { pingOneUserId, pingOneUsername } = await resolvePingOneUser(req.session);
    if (!verticalManifest.resolver.resolve(verticalId)) {
      return res.status(404).json({ error: 'unknown_vertical', verticalId });
    }
    const groupName = groupPolicy.groupNameForCategory(verticalId, category);

    if (!groupName) {
      return res.status(400).json({
        error: 'unknown_group_category',
        message: `vertical '${verticalId}' declares no '${category}' group`,
      });
    }
    if (!pingOneGroupMembershipService.isReady()) {
      return res.status(503).json({
        error: 'live_lookup_unavailable',
        message: 'PingOne worker credentials are not configured, so membership cannot be changed.',
      });
    }

    const result = await pingOneGroupMembershipService.setUserGroupMembership({
      username: pingOneUsername, pingOneUserId, groupName, inGroup,
    });

    // Read back from PingOne rather than echoing the request. A toggle that
    // reports success from its own input would hide a write that silently did
    // nothing — the failure mode this whole feature already hit once.
    const groups = await pingOneGroupMembershipService.listUserGroupNamesForVertical(
      pingOneUserId, verticalId,
    );

    return res.json({
      verticalId,
      username,
      groupName,
      category,
      requested: inGroup,
      changed: result.changed,
      inGroup: Array.isArray(groups) ? groups.includes(groupName) : inGroup,
      groups: groups || [],
      userTier: groupPolicy.resolveUserTier(groups || [], verticalId),
      verified: Array.isArray(groups),
    });
  } catch (err) {
    const code = err.code === 'user_not_toggleable' ? 403
      : err.code === 'group_not_found' ? 404
        : 500;
    console.error('[groupMembership] toggle failed:', err.message);
    return res.status(code).json({
      error: err.code || 'group_toggle_failed',
      message: err.message,
    });
  }
});

/**
 * POST /api/groups/provision
 * Create vertical-scoped PingOne groups via Management API (no full bootstrap).
 * Body: { verticalId?: string } — omit to provision all verticals with groups config.
 */
router.post('/provision', requireSession, requireAdmin, async (req, res) => {
  try {
    const verticalId = req.body?.verticalId || null;
    const result = await provisionVerticalGroups({ verticalId });
    res.json(result);
  } catch (err) {
    console.error('[groupMembership] provision failed:', err.message);
    res.status(500).json({
      error: 'group_provision_failed',
      message: err.message,
    });
  }
});

module.exports = router;
