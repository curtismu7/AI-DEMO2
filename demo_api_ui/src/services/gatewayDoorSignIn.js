// Sign in to the gateway findings door without leaving the page.
//
// The door (the Privilege OpenSearch profile of the MCP inspector) needs its
// own OAuth token. Getting one is a chain of redirects that needs no input
// when the person is already signed in, so it can run in a hidden frame. It
// can still fail there, for example when the browser withholds the identity
// provider's cookie from a frame; the caller then offers the visible link.

// A small static file to land on, so the frame's load event marks the end.
const LANDING_PATH = '/favicon-16.png';
const TIMEOUT_MS = 12_000;

let attempt = null;

/**
 * Run the door's sign-in once per page load. Resolves when the frame has
 * landed or timed out, whether or not it worked: the caller asks the door
 * again to find out.
 */
export function signInToGatewayDoorSilently(loginUrl) {
  if (!loginUrl || typeof document === 'undefined') return Promise.resolve();
  if (!attempt) {
    attempt = new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.hidden = true;
      frame.title = 'Gateway findings sign-in';
      frame.setAttribute('aria-hidden', 'true');
      const done = () => {
        clearTimeout(timer);
        frame.remove();
        resolve();
      };
      const timer = setTimeout(done, TIMEOUT_MS);
      frame.addEventListener('load', done, { once: true });
      frame.src = `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(LANDING_PATH)}`;
      document.body.appendChild(frame);
    });
  }
  return attempt;
}
