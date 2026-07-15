// demo_api_server/src/__tests__/logRedact.test.js
const {
  redactMessage,
  redactObject,
} = require("../../utils/logRedact");

describe("logRedact", () => {
  it("redacts JWT-shaped substrings in messages", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnopqrstuvwxyz012345";
    expect(redactMessage(`token=${jwt}`)).toContain("[REDACTED_JWT]");
    expect(redactMessage(`token=${jwt}`)).not.toContain("eyJhbGci");
  });

  it("redacts secret-named keys in objects", () => {
    const out = redactObject({
      access_token: "secret",
      client_secret: "s",
      ok: "visible",
      nested: { password: "x", n: 1 },
    });
    expect(out.access_token).toBe("[REDACTED]");
    expect(out.client_secret).toBe("[REDACTED]");
    expect(out.ok).toBe("visible");
    expect(out.nested.password).toBe("[REDACTED]");
    expect(out.nested.n).toBe(1);
  });
});
