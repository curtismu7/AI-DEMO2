// P9, one primary button per view state. The page's one primary is the first RUNNABLE action in page order; every
// other action is a bordered secondary. Runnable does not depend on a run being in progress, so the lead does not
// jump while a call is busy. States:
//   status still loading                       : no primary (nothing is known to be runnable yet)
//   mock phone open                            : none on the page, the phone's Approve is the one primary
//   PingFederate token held (session or CIMD)  : third-party exchange, else RAR, else CIBA, else DCR, ...
//   PingOne-only session                       : RAR, else CIBA, else DCR, ... (the exchange would be refused)
//   signed out, DCR configured                 : "Register, use and delete a client" (it needs no session)
//   signed out, nothing configured / status failed : "Open a pi.flow at PingFederate" (reads a flow, sends no credential)
// The CIMD sign-in, the ID-JAG demo links and the tester are links or tools, so they are always secondary.
export function leadAction({ loading, phoneOpen, runnable }) {
  if (loading || phoneOpen) return null;
  const order = ["exchange", "rar", "ciba", "dcr", "delegation", "dpop"];
  return order.find((id) => runnable[id]) || "piflow";
}
