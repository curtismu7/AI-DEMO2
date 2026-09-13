// signOutOfPingOne builds PingOne's end-session URL from discovery and sends the
// browser there. Measured live: /as/signoff honours post_logout_redirect_uri
// without an id_token_hint once the URI is registered on the app, so the URL
// must carry the page's own redirectUri and the client_id — and nothing else is
// needed.
import { describe, it, expect, vi, afterEach } from "vitest";
import { signOutOfPingOne } from "../davinciSdkClient";

const CFG = {
  clientId: "client-1",
  redirectUri: "https://local.ping-devops.com:4000/davinci-sdk-login",
  wellknown: "https://auth.pingone.com/env-1/as/.well-known/openid-configuration",
};

describe("signOutOfPingOne", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the browser to end_session_endpoint with the return URL and client_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ end_session_endpoint: "https://auth.pingone.com/env-1/as/signoff" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const go = vi.fn();

    const url = await signOutOfPingOne(CFG, go);

    expect(fetchMock).toHaveBeenCalledWith(CFG.wellknown);
    const sent = new URL(go.mock.calls[0][0]);
    expect(`${sent.origin}${sent.pathname}`).toBe("https://auth.pingone.com/env-1/as/signoff");
    expect(sent.searchParams.get("post_logout_redirect_uri")).toBe(CFG.redirectUri);
    expect(sent.searchParams.get("client_id")).toBe("client-1");
    // The ID token lives on the BFF and must not be required here.
    expect(sent.searchParams.has("id_token_hint")).toBe(false);
    expect(url).toBe(go.mock.calls[0][0]);
  });

  it("refuses rather than navigating nowhere when discovery has no end_session_endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({}) }));
    const go = vi.fn();

    await expect(signOutOfPingOne(CFG, go)).rejects.toThrow(/end_session_endpoint/);
    expect(go).not.toHaveBeenCalled();
  });
});
