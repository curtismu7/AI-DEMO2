// Tips shown under a loading spinner. One list, shared by the sign-in loading
// screen (AuthLoadingScreen) and PingIdentitySpinner, so a spinner anywhere in
// the app reads the same as the first one a person sees.
export const LOADING_TIPS = [
  'Every agent call swaps the user token for a scoped one (RFC 8693) before it reaches a tool.',
  'The browser never holds a PingOne token. The BFF keeps it server-side and the page only sees a session cookie.',
  'High-value transfers pause for human approval before they run.',
  'Each tool call is checked against policy at the gateway, not just at sign-in.',
];
export const TIP_ROTATE_MS = 4000;
