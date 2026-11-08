// Which control on /agent-lifecycle is the page's one primary button.
//
// The page is a four-step walk, so the primary is the next action of the walk, not a fixed button:
//   start                      -> "Call list_orders as agent"   (step 2)
//   after list_orders succeeds -> "Checkout $600 headphones"    (step 3)
//   after checkout completes   -> "Revoke agent access"         (step 4)
//   after a full-scope revoke  -> "Re-enable agent apps"        (the only thing left to do)
//   after an instance revoke   -> "Revoked" (disabled): the walk is over, the label states it
//   while the kill-switch dialog is open -> none on the page; the dialog's Confirm is the primary then
// A step that fails stays the primary, so the retry is the obvious next click. Step 1 has no button
// (it is a recording plus links), so it never takes the primary.
export function pickPrimary({ orders, checkout, revoked, scopeFull, modalOpen }) {
  if (modalOpen) return null;
  if (revoked) return scopeFull ? 'reenable' : 'revoke';
  if (!orders) return 'orders';
  if (!checkout) return 'checkout';
  return 'revoke';
}

// What the CIBA initiate response says about who answers the approval request.
export function approvalWaitMessage(engine, authReqId) {
  const head = `Waiting for approval (auth_req_id: ${authReqId})…`;
  if (engine === 'pingone') {
    return `${head} approve the request PingOne sent to you; this page continues once you do.`;
  }
  if (engine === 'simulated') {
    return `${head} this is a local simulation that auto-approves within a minute — no action needed.`;
  }
  return `${head} the server did not say who answers the request.`;
}
