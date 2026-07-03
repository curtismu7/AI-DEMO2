// Regression: the completed exchanged-token event must carry an
// exchangeRequest teaching payload WITHOUT any raw token material.
const { buildTokenEvent } = require("../services/agentMcpTokenService");

describe("exchanged-token event exchangeRequest extra", () => {
  test("buildTokenEvent passes exchangeRequest through extra and never a token string", () => {
    const evt = buildTokenEvent(
      "exchanged-token", "Delegated Access Token", "active",
      { header: { alg: "RS256" }, claims: { sub: "u1", scope: "write" } },
      "explanation",
      { exchangeRequest: {
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
          actor_token_present: true,
          requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
          scope: "write", audience: "https://mcp-gw.ping.demo" } }
    );
    expect(evt.exchangeRequest.grant_type).toContain("token-exchange");
    expect(evt.exchangeRequest.actor_token_present).toBe(true);
    expect(JSON.stringify(evt)).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});
