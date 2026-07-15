import { describe, it, expect } from "vitest";
import {
  b64ToBytes,
  bytesToB64,
  formatPublicKeyCredentialAssertion,
  normalizePublicKeyRequestOptions,
} from "../passkeyCeremony";

describe("b64ToBytes", () => {
  it("decodes standard base64", () => {
    const bytes = b64ToBytes(btoa("hello"));
    expect(String.fromCharCode(...bytes)).toBe("hello");
  });

  it("decodes base64url without padding (PingOne challenge shape)", () => {
    // "hello" as base64url: aGVsbG8 (no padding; +/ would be -_)
    const bytes = b64ToBytes("aGVsbG8");
    expect(String.fromCharCode(...bytes)).toBe("hello");
  });

  it("decodes base64url with - and _ alphabet", () => {
    // bytes [0xfb, 0xff] → standard base64 "+/8=" → base64url "-_8"
    const bytes = b64ToBytes("-_8");
    expect(Array.from(bytes)).toEqual([0xfb, 0xff]);
  });

  it("accepts signed byte arrays from PingOne/Jackson", () => {
    expect(Array.from(b64ToBytes([-1, 2, 3]))).toEqual([255, 2, 3]);
  });
});

describe("normalizePublicKeyRequestOptions", () => {
  it("decodes challenge + allowCredentials from a JSON string", () => {
    const raw = JSON.stringify({
      challenge: "aGVsbG8",
      rpId: "ai-demo.ping-devops.com",
      allowCredentials: [{ type: "public-key", id: "aGVsbG8" }],
    });
    const opts = normalizePublicKeyRequestOptions(raw);
    expect(opts.rpId).toBe("ai-demo.ping-devops.com");
    expect(opts.challenge).toBeInstanceOf(Uint8Array);
    expect(String.fromCharCode(...opts.challenge)).toBe("hello");
    expect(opts.allowCredentials[0].id).toBeInstanceOf(Uint8Array);
  });

  it("accepts an already-parsed object (BFF pre-parse path)", () => {
    const opts = normalizePublicKeyRequestOptions({
      challenge: "aGVsbG8",
      timeout: 60000,
    });
    expect(opts.timeout).toBe(60000);
    expect(String.fromCharCode(...opts.challenge)).toBe("hello");
  });

  it("keeps only WebAuthn request fields (PingOne Authenticate sample)", () => {
    const opts = normalizePublicKeyRequestOptions({
      challenge: [1, 2, 3],
      rpId: "example.com",
      timeout: 30000,
      userVerification: "preferred",
      allowCredentials: [
        { type: "public-key", id: [9, 8], transports: ["internal"] },
      ],
      status: "ASSERTION_REQUIRED",
      extraJunk: true,
    });
    expect(opts.challenge).toBeInstanceOf(Uint8Array);
    expect(Array.from(opts.challenge)).toEqual([1, 2, 3]);
    expect(opts.rpId).toBe("example.com");
    expect(opts.allowCredentials[0].transports).toEqual(["internal"]);
    expect(opts).not.toHaveProperty("status");
    expect(opts).not.toHaveProperty("extraJunk");
  });
});

describe("formatPublicKeyCredentialAssertion", () => {
  it("base64-encodes binary assertion fields for PingOne", () => {
    const buf = (arr) => new Uint8Array(arr).buffer;
    const cred = {
      id: "cred-id",
      rawId: buf([1, 2]),
      type: "public-key",
      response: {
        clientDataJSON: buf([3]),
        authenticatorData: buf([4]),
        signature: buf([5]),
        userHandle: buf([6]),
      },
    };
    const formatted = formatPublicKeyCredentialAssertion(cred);
    expect(formatted.id).toBe("cred-id");
    expect(formatted.rawId).toBe(bytesToB64(buf([1, 2])));
    expect(formatted.response.userHandle).toBe(bytesToB64(buf([6])));
  });
});

describe("bytesToB64", () => {
  it("round-trips with b64ToBytes", () => {
    const original = new Uint8Array([1, 2, 3, 250]);
    const encoded = bytesToB64(original);
    expect(Array.from(b64ToBytes(encoded))).toEqual([1, 2, 3, 250]);
  });
});
