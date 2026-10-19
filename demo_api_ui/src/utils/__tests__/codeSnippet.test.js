import { codeSnippet } from "../codeSnippet";

// The issue request exactly as the server shows it (tokens already redacted to [...] labels).
const ISSUE = {
  endpoint: "POST https://pf.test/as/token.oauth2",
  body: {
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: "urn:ietf:params:oauth:token-type:id-jag",
    subject_token: "[your session token, never sent to the browser]",
    subject_token_type: "urn:ietf:params:oauth:token-type:refresh_token",
    audience: "https://as.test",
    resource: "https://as.test/mcp",
    scope: "mcp:invoke",
    client_id: "id-jag-kit",
  },
};

describe("codeSnippet", () => {
  it("turns a token exchange into fetch with placeholders", () => {
    const code = codeSnippet(ISSUE);
    expect(code).toContain('fetch("https://pf.test/as/token.oauth2"');
    expect(code).toContain("new URLSearchParams({");
    expect(code).toContain("subject_token: SUBJECT_TOKEN");
    expect(code).toContain('Authorization: "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)');
    expect(code).not.toContain("[");
  });

  it("never prints a secret", () => {
    const code = codeSnippet({ endpoint: "POST https://as.test/token", authorization: "Bearer eyJabc", body: { grant_type: "x", client_secret: "s3cr3t" } });
    expect(code).toContain("CLIENT_SECRET");
    expect(code).toContain("ACCESS_TOKEN");
    expect(code).not.toContain("s3cr3t");
    expect(code).not.toContain("eyJabc");
  });

  it("sends JSON-RPC as JSON", () => {
    const code = codeSnippet({ endpoint: "POST https://mcp.test/mcp", authorization: "Bearer [access token]", body: { jsonrpc: "2.0", method: "tools/list" } });
    expect(code).toContain('"Content-Type": "application/json"');
    expect(code).toContain('Accept: "application/json, text/event-stream"');
    expect(code).toContain("body: JSON.stringify(");
    expect(code).toContain("`Bearer ${ACCESS_TOKEN}`");
  });

  it("shows a plain GET with the token the page used", () => {
    expect(codeSnippet({ method: "GET", url: "https://mcp.test/protected/profile", authorization: "Bearer [the ID-JAG]" }))
      .toContain("`Bearer ${ID_JAG}`");
    expect(codeSnippet({ method: "GET", url: "https://mcp.test/protected/profile", authorization: "none" })).not.toContain("Authorization");
  });

  it("redacts any token, secret, assertion or verifier field by name", () => {
    const code = codeSnippet({ endpoint: "POST https://as.test/token", body: { grant_type: "x", refresh_token: "rt-live", client_assertion: "ca-live", actor_token: "at-live", code_verifier: "cv-live", subject_token_type: "urn:x" } });
    for (const v of ["rt-live", "ca-live", "at-live", "cv-live"]) expect(code).not.toContain(v);
    expect(code).toContain('subject_token_type: "urn:x"');
  });

  it("redacts nested JSON tokens and JWT-looking values, and keeps the JSON-RPC id", () => {
    const code = codeSnippet({ endpoint: "POST https://mcp.test/mcp", authorization: "Bearer [access token]",
      body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { arguments: { access_token: "nested-live", note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig" } } } });
    expect(code).not.toContain("nested-live");
    expect(code).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(code).toContain('"id": 1');
  });

  it("drops a query string from the URL", () => {
    expect(codeSnippet({ method: "GET", url: "https://x.test/p?access_token=live-value", authorization: "none" })).not.toContain("live-value");
  });
});

