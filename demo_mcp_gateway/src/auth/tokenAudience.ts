/**
 * Canonical TokenAudience formatting — the ONE place that decides how a
 * decoded token's `aud` claim reaches PingOne Authorize.
 *
 * History (why this is a helper and not an inline expression):
 *  - Both PEPs (PingOneAuthorizeClient tools/call, pingAuthorizeGuard
 *    tools/list) originally joined a multi-aud array with ', '. 447a11c9a
 *    changed the client to a space-join; ecd6e569c then changed the guard to
 *    a comma-join — the two PEPs briefly disagreed on the same attribute.
 *  - 478bdecad (#319) settled on the SPACE join for both, and that is the
 *    invariant this helper pins: the policy's HasValidMcpAudience /
 *    D-05 anti-bypass splits the list on WHITESPACE, so a comma-join makes a
 *    multi-aud [gateway, upstream] token unsplittable and defeats the control.
 *    (Known tension: an aud VALUE containing a space — the PingOne drift where
 *    the A2A gateway resource's aud was its NAME — is ambiguous under
 *    space-join. If that class returns, the fix belongs HERE and in the
 *    policy's splitting rule, decided once, not re-litigated per call site.)
 *
 * Rules:
 *  - array aud  → space-joined
 *  - string aud → verbatim
 *  - absent aud → '' (callers OMIT the parameter rather than fabricate one —
 *    a fabricated match re-creates the HasValidMcpAudience tautology)
 */
export function formatTokenAudience(aud: string | string[] | undefined): string {
  return Array.isArray(aud) ? aud.join(' ') : (aud ?? '');
}
