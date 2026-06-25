import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { notifyInfo } from "../utils/appToast";
import {
  showEndUserOAuthErrorToast,
  stripEndUserOAuthErrorParamsFromUrl,
} from "../utils/endUserOAuthErrorToast";

export function useOAuthUrlCleanup() {
  const [searchParams] = useSearchParams();

  // End-user OAuth BFF error toast
  useEffect(() => {
    if (showEndUserOAuthErrorToast(searchParams)) {
      stripEndUserOAuthErrorParamsFromUrl();
    }
  }, [searchParams]);

  // SSO silent sign-in: strip sso_silent param + show toast
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("sso_silent") !== "1") return;
    params.delete("sso_silent");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : "");
    window.history.replaceState(null, "", newUrl);
    notifyInfo(
      "✅ Signed in automatically — you had an active PingOne session.",
      { autoClose: 6000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount only
  }, []);

  // OAuth success landing: strip ?oauth= param
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search || "");
    if (!params.has("oauth")) return;
    params.delete("oauth");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : "");
    window.history.replaceState(null, "", newUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount only
  }, []);
}
