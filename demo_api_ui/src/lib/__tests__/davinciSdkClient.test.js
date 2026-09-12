// Two things here that a pure-fixture test cannot cover:
//
//  1. That the ESM-only @forgerock/davinci-client (with its `effect` and
//     @reduxjs/toolkit transitives) actually RESOLVES under this project's
//     build tooling. It is the first ESM-only dependency in this bundle.
//
//  2. The PKCE hand-off contract. The SDK writes the verifier to sessionStorage
//     and never reads it back, so our helper reads a key that belongs to
//     another package. Asserting our own hardcoded string would keep passing
//     through exactly the upgrade that breaks this — so the live contract test
//     drives the REAL sdk-oidc code and asserts we recover what it wrote.
//     (That one is in the live harness; here we pin shape + single-use.)
import { describe, it, expect, beforeEach, vi } from "vitest";
import { takePkceVerifier, isSdkError } from "../davinciSdkClient";

describe("davinciSdkClient", () => {
  it("resolves the ESM-only SDK under the build tooling", async () => {
        const mod = await import("@forgerock/davinci-client");
    expect(typeof mod.davinci).toBe("function");
  });

  describe("takePkceVerifier", () => {
    const clientId = "4e122cbf-defe-4c39-a5b5-c6b7da2b63f1";
    const key = `FR-SDK-authflow-${clientId}`;

    beforeEach(() => {
      sessionStorage.clear();
    });

    it("reads the verifier from the key the SDK actually writes", () => {
      sessionStorage.setItem(key, JSON.stringify({ state: "s", verifier: "v-123" }));
      expect(takePkceVerifier(clientId)).toBe("v-123");
    });

    it("is single-use — it clears the record it read", () => {
      // Mirrors the SDK's own read-and-delete. A code is single-use, so leaving
      // the verifier behind would let a stale one be spent on a second attempt.
      sessionStorage.setItem(key, JSON.stringify({ verifier: "v-123" }));
      takePkceVerifier(clientId);
      expect(sessionStorage.getItem(key)).toBeNull();
    });

    it("throws a restart-able message when nothing was stored", () => {
      expect(() => takePkceVerifier(clientId)).toThrow(/did not store its PKCE verifier/);
    });

    it("throws when the record exists but carries no verifier", () => {
      sessionStorage.setItem(key, JSON.stringify({ state: "s" }));
      expect(() => takePkceVerifier(clientId)).toThrow(/no PKCE verifier/);
    });

    it("throws a readable error when session storage itself is unavailable", () => {
      // Private windows and blocked site-data throw on ACCESS rather than
      // returning null. Injected rather than spied: jsdom's sessionStorage does
      // not dispatch through Storage.prototype, so a spy never fires and the
      // assertion silently passes on the "nothing stored" branch instead —
      // which is what happened on the first attempt at this test.
      const throwing = {
        getItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {},
      };
      expect(() => takePkceVerifier(clientId, throwing)).toThrow(/session storage/);
    });
  });

  describe("isSdkError", () => {
    it("treats an SDK internal error object as an error", () => {
      expect(isSdkError({ error: { message: "x" }, type: "internal_error" })).toBe(true);
    });

    it("does not treat a normal node as an error", () => {
      expect(isSdkError({ status: "continue" })).toBe(false);
    });

    it("treats a missing result as an error", () => {
      expect(isSdkError(undefined)).toBe(true);
    });
  });
});
