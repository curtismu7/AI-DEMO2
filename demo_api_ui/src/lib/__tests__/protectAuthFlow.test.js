import { afterEach, describe, expect, it } from "vitest";
import { PROTECT_AUTH_FLOW_KEY, protectIdentityMatches, readProtectAuthFlow } from "../protectAuthFlow";

const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const idToken = (claims) => `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;

describe("Protect authentication flow marker", () => {
  afterEach(() => sessionStorage.clear());

  it("reads a fresh flow marker with the evaluated identifier", () => {
    sessionStorage.setItem(PROTECT_AUTH_FLOW_KEY, JSON.stringify({
      version: 1,
      flowId: "opaque-flow",
      returnTo: "product",
      userId: "demo@example.com",
      issuedAt: Date.now(),
    }));

    expect(readProtectAuthFlow()).toMatchObject({ flowId: "opaque-flow", returnTo: "product", userId: "demo@example.com" });
  });

  it("clears an expired flow marker instead of treating a later OIDC callback as its completion", () => {
    sessionStorage.setItem(PROTECT_AUTH_FLOW_KEY, JSON.stringify({
      version: 1,
      flowId: "expired-flow",
      userId: "demo@example.com",
      issuedAt: Date.now() - 11 * 60 * 1000,
    }));

    expect(readProtectAuthFlow()).toBeNull();
    expect(sessionStorage.getItem(PROTECT_AUTH_FLOW_KEY)).toBeNull();
  });
});

describe("Protect evaluated identity matching", () => {
  it("matches username and email claims case-insensitively", () => {
    expect(protectIdentityMatches("Demo@Example.com", idToken({ email: "demo@example.com" }))).toBe(true);
    expect(protectIdentityMatches("demo-user", idToken({ preferred_username: "DEMO-USER" }))).toBe(true);
  });

  it("rejects a different or unidentifiable authenticated account", () => {
    expect(protectIdentityMatches("demo@example.com", idToken({ email: "other@example.com" }))).toBe(false);
    expect(protectIdentityMatches("demo@example.com", idToken({ sub: "user-guid" }))).toBe(false);
    expect(protectIdentityMatches("demo@example.com", "not-a-jwt")).toBe(false);
  });
});
