import { useEffect } from "react";
import { navigateToCustomerOAuthLogin } from "../utils/authUi";

/**
 * Signed-out visitor on a user-level route: send them into the BFF sign-in
 * flow with return_to back to this page. Never silently dump them on home —
 * that reads as a broken link. (Query strings are dropped: the BFF's
 * sanitizePostLoginReturnPath only accepts bare paths.)
 */
export default function RedirectToLogin() {
  useEffect(() => {
    navigateToCustomerOAuthLogin(window.location.pathname);
  }, []);
  return null;
}
