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

/**
 * Base64url-decode a JWT payload. Returns {} for anything unparseable — callers
 * must already have validated the token; this only reads claims from it.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
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
 * @param claims        Decoded JWT claims of the presented token.
 * @param options.allowedActors  Permitted actor client-ids. Empty = unarmed.
 */
export function verifyActorChain(
  claims: Record<string, unknown> | null | undefined,
  options: { allowedActors?: string[] } = {},
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
