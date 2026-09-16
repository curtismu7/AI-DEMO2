// The /sdk-login pop-out sign-in: the page opens PingOne's hosted login in a
// window with this name, and /sdk-login/callback, seeing it is that window, hands
// {code, state} back instead of exchanging. The exchange stays in the opener tab,
// which owns the SDK's sessionStorage state + PKCE verifier.
export const POPUP_WINDOW_NAME = "sdk-login-popup";
export const POPUP_RESULT_TYPE = "sdk-login-popup-result";

export function isSdkLoginPopup(win = window) {
  if (win.name !== POPUP_WINDOW_NAME || !win.opener) return false;
  try {
    return win.opener.location.origin === win.location.origin;
  } catch {
    return false; // a cross-origin opener's location is not readable
  }
}
