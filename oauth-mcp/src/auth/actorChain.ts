/**
 * Actor-chain (RFC 8693 `act`) verification at the MCP server boundary.
 *
 * Closes F10 (docs/authorization-decision-split.md §6.1): the gateway verifies
 * the delegation chain and then the fact is dropped — nothing at the final hop
 * re-checks who is acting for the user.
 *
 * Contract (planning/authz-fix-contract.md C4 — "omission is not permission"):
 * when no allow-list is configured the gate is NOT silently skipped; it returns
 * `ran: false` plus a `skipReason` so the caller can log an inspectable marker
 * that is distinguishable from a PERMIT.
 *
 * Once armed the check is fail-closed: a token with no `act` claim is a token
 * with no provable delegation chain and is rejected.
 *
 * The allow-list is an AUTHORIZATION decision read out of the token's own `act`
 * claim, so it is only as trustworthy as the signature over that claim. There is
 * deliberately no JWT-decode helper in this module: claims must arrive from
 * TokenIntrospector.validateAgentToken (which verifies the signature against
 * PingOne's JWKS and returns `verifiedClaims` only when that succeeded). A bare
 * base64 decode would let a caller mint an `alg:none` token naming a whitelisted
 * actor and satisfy the gate — the allow-list would be writable by the attacker
 * it exists to exclude.
 */

export interface ActorChainResult {
  /** false = gate did not run (unarmed). Never means "permitted". */
  ran: boolean;
  valid: boolean;
  errors: string[];
  /** Present only when ran === false. */
  skipReason?: string;
  /** The actor identifier that was matched, when the check passed. */
  actor?: string;
}

/** Parse a comma-separated allow-list env value into trimmed, non-empty ids. */
export function parseAllowedActors(raw?: string): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Verify the delegation chain on a token presented to the MCP server.
 *
 * @param claims        Claims of the presented token. MUST come from a token
 *                      whose signature was verified — pass the `verifiedClaims`
 *                      of AgentTokenInfo, which is undefined when verification
 *                      did not happen.
 * @param options.allowedActors      Permitted actor client-ids. Empty = unarmed.
 * @param options.signatureVerified  Whether the signature over `claims` was
 *                      cryptographically verified. Defaults to FALSE so a caller
 *                      that forgets to pass it fails closed rather than trusting
 *                      an unverified decode.
 */
export function verifyActorChain(
  claims: Record<string, unknown> | null | undefined,
  options: { allowedActors?: string[]; signatureVerified?: boolean } = {},
): ActorChainResult {
  const allowedActors = options.allowedActors ?? [];

  if (allowedActors.length === 0) {
    return {
      ran: false,
      valid: true,
      errors: [],
      skipReason: 'no actor allow-list configured (MCP_ALLOWED_ACTORS unset)',
    };
  }

  // Armed. From here the `act` claim decides access, so it must be a claim the
  // issuer actually signed. An unverified token is attacker-authored: it can name
  // any actor in the allow-list. Fail closed — the alternative is an allow-list
  // that admits whoever asks.
  if (options.signatureVerified !== true) {
    return {
      ran: true,
      valid: false,
      errors: [
        'F10: the token signature was not verified, so its act claim cannot be trusted. ' +
        'Configure JWKS (PINGONE_JWKS_URI / PINGONE_ISSUER / PINGONE_BASE_URL) — an ' +
        'actor allow-list over unverified claims is forgeable by any caller.',
      ],
    };
  }

  const act = claims?.act;

  // RFC 8693 §4.1 — `act` is a JSON object describing the current actor.
  if (act === undefined || act === null) {
    return {
      ran: true,
      valid: false,
      errors: [
        'F10: token carries no act claim — the delegation chain cannot be verified. ' +
        'The gateway must send actor_token on the RFC 8693 exchange so the issued ' +
        'token records who is acting for the user.',
      ],
    };
  }

  if (typeof act !== 'object' || Array.isArray(act)) {
    return {
      ran: true,
      valid: false,
      errors: ['F10: act claim is not a JSON object (RFC 8693 §4.1)'],
    };
  }

  const actor = act as { sub?: unknown; client_id?: unknown };
  const actorId =
    (typeof actor.client_id === 'string' && actor.client_id.trim()) ||
    (typeof actor.sub === 'string' && actor.sub.trim()) ||
    '';

  if (!actorId) {
    return {
      ran: true,
      valid: false,
      errors: ['F10: act claim carries no client_id or sub identifying the actor'],
    };
  }

  if (!allowedActors.includes(actorId)) {
    return {
      ran: true,
      valid: false,
      errors: [`F10: actor "${actorId}" is not in the MCP server actor allow-list`],
      actor: actorId,
    };
  }

  return { ran: true, valid: true, errors: [], actor: actorId };
}
