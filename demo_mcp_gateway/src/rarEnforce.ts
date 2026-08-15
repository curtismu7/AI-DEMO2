/**
 * RAR (RFC 9396) intent-subset enforcement.
 *
 * The BFF builds `authorization_details` from the tool + parameters and carries them
 * in the TraT envelope (azd.authorization_details). This enforces that the ACTUAL
 * tool-call parameters are a subset of what was authorized: the action matches, the
 * amount does not exceed the granted amount, and the payee matches the granted payee.
 * A mismatch means the agent is attempting something other than the authorized intent.
 *
 * Note (demo scope): in simulated mode the grant is built by the BFF from the same
 * request, so this proves the call wasn't mutated between authorization and execution.
 * The grant becomes independently trustworthy when minted by PingAuthorize / native RAR.
 */

export interface RarDetail {
  type?: string;
  tool?: string;
  actions?: string[];
  amount?: number;
  currency?: string;
  payee?: string;
  from?: string;
}

export interface RarToolArgs {
  amount?: unknown;
  to_account_id?: unknown;
  from_account_id?: unknown;
  [key: string]: unknown;
}

export interface RarResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify tool-call params ⊆ granted authorization_details.
 * Returns ok:true when there is nothing to constrain (no details) — absence of a grant
 * is not a RAR violation; the absence/presence decision belongs to the caller's flag.
 */
export function enforceRarSubset(
  toolName: string,
  toolArgs: RarToolArgs | undefined,
  details: RarDetail[] | undefined,
): RarResult {
  if (!details || details.length === 0) return { ok: true };

  // Select the granted detail for this tool (by action list or tool name). No match
  // means the tool was never granted — deny immediately rather than falling back to
  // an unrelated grant (which would run amount/payee checks against the wrong intent).
  const grant = details.find((d) => (d.actions ?? []).includes(toolName) || d.tool === toolName);

  if (!grant) {
    return { ok: false, reason: `tool "${toolName}" is not in the granted authorization_details` };
  }

  const args = toolArgs ?? {};

  if (grant.amount !== undefined) {
    const actual = Number(args.amount);
    // Fail closed: when the grant caps amount, an absent/non-numeric amount is REJECTED.
    if (Number.isNaN(actual) || actual > grant.amount) {
      return { ok: false, reason: `amount ${Number.isNaN(actual) ? '(missing/invalid)' : actual} exceeds granted ${grant.amount}` };
    }
  }

  if (grant.payee) {
    const actualPayee = String(args.to_account_id ?? args.payee ?? '');
    // Fail closed: when the grant restricts payee, an absent/empty payee is REJECTED.
    if (!actualPayee || actualPayee !== grant.payee) {
      return { ok: false, reason: `payee "${actualPayee || '(missing)'}" is not the granted payee "${grant.payee}"` };
    }
  }

  return { ok: true };
}

/** Safely pull authorization_details out of a parsed TraT envelope's azd field. */
export function rarDetailsFromEnvelope(envelope: unknown): RarDetail[] | undefined {
  const azd = (envelope as { azd?: { authorization_details?: unknown } } | undefined)?.azd;
  const details = azd?.authorization_details;
  return Array.isArray(details) ? (details as RarDetail[]) : undefined;
}
