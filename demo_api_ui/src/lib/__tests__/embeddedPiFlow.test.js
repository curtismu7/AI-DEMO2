import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startEmbeddedSignIn,
  submitPassword,
  EmbeddedSignInError,
  PASSWORD_CHECK_TYPE,
} from "../embeddedPiFlow";

const AUTHZ = "https://auth.pingone.com/env-1/as/authorize?client_id=c&state=s1&code_challenge=x";
const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const client = () => ({ authorize: { url: vi.fn().mockResolvedValue(AUTHZ) } });

describe("embeddedPiFlow", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  beforeEach(() => { global.fetch = vi.fn(); });

  it("starts the flow with response_mode=pi.flow and credentials, and returns the password check link", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes({
      id: "flow-1",
      status: "USERNAME_PASSWORD_REQUIRED",
      _links: { "usernamePassword.check": { href: "https://auth.pingone.com/env-1/flows/flow-1" } },
    }));

    const flow = await startEmbeddedSignIn(client());

    const [url, init] = global.fetch.mock.calls[0];
    expect(new URL(url).searchParams.get("response_mode")).toBe("pi.flow");
    expect(new URL(url).searchParams.get("state")).toBe("s1");
    expect(init.credentials).toBe("include");
    expect(flow).toEqual({
      flowId: "flow-1",
      checkUrl: "https://auth.pingone.com/env-1/flows/flow-1",
      resumeBase: "https://auth.pingone.com/env-1",
    });
  });

  it("rejects a flow that does not start at the password step as unsupported_step", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes({ id: "flow-1", status: "MFA_REQUIRED", _links: {} }));
    await expect(startEmbeddedSignIn(client())).rejects.toMatchObject({ code: "unsupported_step", detail: "MFA_REQUIRED" });
  });

  it("submits the password with the vendor content type and no Authorization, resumes, and returns code and state", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonRes({ id: "flow-1", status: "COMPLETED" }))
      .mockResolvedValueOnce(jsonRes({ authorizeResponse: { code: "code-1", state: "s1" } }));

    const result = await submitPassword(
      { flowId: "flow-1", checkUrl: "https://auth.pingone.com/env-1/flows/flow-1", resumeBase: "https://auth.pingone.com/env-1" },
      "demoUser",
      "pw",
    );

    const [checkUrl, checkInit] = global.fetch.mock.calls[0];
    expect(checkUrl).toBe("https://auth.pingone.com/env-1/flows/flow-1");
    expect(checkInit.method).toBe("POST");
    expect(checkInit.credentials).toBe("include");
    expect(checkInit.headers["Content-Type"]).toBe(PASSWORD_CHECK_TYPE);
    expect(checkInit.headers.Authorization).toBeUndefined();
    expect(JSON.parse(checkInit.body)).toEqual({ username: "demoUser", password: "pw" });

    const [resumeUrl, resumeInit] = global.fetch.mock.calls[1];
    expect(resumeUrl).toBe("https://auth.pingone.com/env-1/as/resume?flowId=flow-1");
    expect(resumeInit.credentials).toBe("include");
    expect(result).toEqual({ code: "code-1", state: "s1" });
  });

  it("maps a rejected password to invalid_credentials with PingOne's message", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes({ code: "INVALID_DATA", details: [{ message: "Invalid username or password" }] }, 400));
    const err = await submitPassword({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "u", "bad").catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddedSignInError);
    expect(err.code).toBe("invalid_credentials");
    expect(err.message).toBe("Invalid username or password");
  });

  it("maps a non-400 failure (500) to start_failed, not invalid_credentials", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes({ message: "Internal error" }, 500));
    const err = await submitPassword({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "u", "pw").catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddedSignInError);
    expect(err.code).toBe("start_failed");
    expect(err.message).toBe("Internal error");
  });

  it("maps a 500 with no PingOne message to a generic start_failed message naming the status", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes({}, 500));
    const err = await submitPassword({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "u", "pw").catch((e) => e);
    expect(err.code).toBe("start_failed");
    expect(err.message).toBe("PingOne could not check the password (HTTP 500).");
  });

  it("maps a second step after the password to unsupported_step", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes({ id: "f", status: "PASSWORD_EXPIRED" }));
    await expect(submitPassword({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "u", "p"))
      .rejects.toMatchObject({ code: "unsupported_step", detail: "PASSWORD_EXPIRED" });
  });

  it("maps a resume the browser cannot read to resume_blocked", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonRes({ id: "f", status: "COMPLETED" }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(submitPassword({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "u", "p"))
      .rejects.toMatchObject({ code: "resume_blocked" });
  });

  it("maps a resume with no code to resume_blocked", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonRes({ id: "f", status: "COMPLETED" }))
      .mockResolvedValueOnce(jsonRes({}));
    await expect(submitPassword({ flowId: "f", checkUrl: "u", resumeBase: "b" }, "u", "p"))
      .rejects.toMatchObject({ code: "resume_blocked" });
  });
});
