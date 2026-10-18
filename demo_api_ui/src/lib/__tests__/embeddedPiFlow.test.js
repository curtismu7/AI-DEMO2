import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startEmbeddedSignIn,
  submitPassword,
  EmbeddedSignInError,
  PASSWORD_CHECK_TYPE,
  startPasswordlessSignIn,
  lookupUser,
  selectDevice,
  checkOtp,
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

  describe("passwordless (acr_values=mfa_only), same steps as piFlowDriver's PingOne branch", () => {
    const FLOW = { flowId: "flow-1", stepUrl: "https://auth.pingone.com/env-1/flows/flow-1", resumeBase: "https://auth.pingone.com/env-1" };
    const devices = [
      { id: "dev-email", type: "EMAIL", email: "d***@example.com", usableStatus: { status: "ENABLED" } },
      { id: "dev-sms", type: "SMS", phone: "+1*****1234" },
      { id: "dev-off", type: "SMS", usableStatus: { status: "DISABLED" } },
    ];
    const lastPost = () => {
      const [url, init] = global.fetch.mock.calls.at(-1);
      return { url, init, body: JSON.parse(init.body) };
    };

    it("starts the flow with acr_values=mfa_only and needs PingOne's user.lookup link", async () => {
      const c = client();
      global.fetch.mockResolvedValueOnce(jsonRes({
        id: "flow-1",
        status: "SIGN_ON_REQUIRED",
        _links: { "user.lookup": { href: "https://auth.pingone.com/env-1/flows/flow-1" } },
      }));

      const flow = await startPasswordlessSignIn(c);

      expect(c.authorize.url).toHaveBeenCalledWith({ query: { acr_values: "mfa_only" } });
      expect(new URL(global.fetch.mock.calls[0][0]).searchParams.get("response_mode")).toBe("pi.flow");
      expect(flow).toEqual(FLOW);
    });

    it("rejects a flow without user.lookup (policy not passwordless) as unsupported_step", async () => {
      global.fetch.mockResolvedValueOnce(jsonRes({ id: "flow-1", status: "USERNAME_PASSWORD_REQUIRED", _links: {} }));
      await expect(startPasswordlessSignIn(client())).rejects.toMatchObject({ code: "unsupported_step" });
    });

    it("user.lookup -> DEVICE_SELECTION_REQUIRED -> device.select -> OTP_REQUIRED -> otp.check -> COMPLETED -> resume", async () => {
      global.fetch.mockResolvedValueOnce(jsonRes({ id: "flow-1", status: "DEVICE_SELECTION_REQUIRED", _embedded: { devices } }));
      const lookup = await lookupUser(FLOW, " demouser ");
      let post = lastPost();
      expect(post.url).toBe(FLOW.stepUrl);
      expect(post.init.method).toBe("POST");
      expect(post.init.credentials).toBe("include");
      expect(post.init.headers["Content-Type"]).toBe("application/vnd.pingidentity.user.lookup+json");
      expect(post.init.headers.Accept).toBe("*/*");
      expect(post.body).toEqual({ username: "demouser" });
      expect(lookup).toEqual({
        step: "device",
        selectedDeviceId: null,
        devices: [
          { id: "dev-email", type: "EMAIL", nickname: null, email: "d***@example.com", phone: null },
          { id: "dev-sms", type: "SMS", nickname: null, email: null, phone: "+1*****1234" },
        ],
      });

      global.fetch.mockResolvedValueOnce(jsonRes({ id: "flow-1", status: "OTP_REQUIRED", selectedDevice: { id: "dev-sms" }, _embedded: { devices } }));
      const picked = await selectDevice(FLOW, "dev-sms");
      post = lastPost();
      expect(post.init.headers["Content-Type"]).toBe("application/vnd.pingidentity.device.select+json");
      expect(post.body).toEqual({ device: { id: "dev-sms" } });
      expect(picked).toMatchObject({ step: "otp", selectedDeviceId: "dev-sms" });

      global.fetch
        .mockResolvedValueOnce(jsonRes({ id: "flow-1", status: "COMPLETED" }))
        .mockResolvedValueOnce(jsonRes({ authorizeResponse: { code: "code-1", state: "s1" } }));
      const done = await checkOtp(FLOW, " 123456 ");
      const [checkUrl, checkInit] = global.fetch.mock.calls.at(-2);
      expect(checkUrl).toBe(FLOW.stepUrl);
      expect(checkInit.headers["Content-Type"]).toBe("application/vnd.pingidentity.otp.check+json");
      expect(JSON.parse(checkInit.body)).toEqual({ otp: "123456" });
      expect(global.fetch.mock.calls.at(-1)[0]).toBe("https://auth.pingone.com/env-1/as/resume?flowId=flow-1");
      expect(done).toEqual({ step: "done", code: "code-1", state: "s1" });
    });

    it("maps PingOne's OTP_VALIDATION_FAILED to invalid_otp", async () => {
      global.fetch.mockResolvedValueOnce(jsonRes({ code: "INVALID_DATA", details: [{ code: "OTP_VALIDATION_FAILED", message: "bad" }] }, 400));
      await expect(checkOtp(FLOW, "000000")).rejects.toMatchObject({ code: "invalid_otp" });
    });

    it("maps a passkey step (ASSERTION_REQUIRED) to unsupported_step with a clear message", async () => {
      global.fetch.mockResolvedValueOnce(jsonRes({ id: "flow-1", status: "ASSERTION_REQUIRED" }));
      const err = await lookupUser(FLOW, "demouser").catch((e) => e);
      expect(err.code).toBe("unsupported_step");
      expect(err.message).toMatch(/passkey/i);
    });

    it("maps a password-required answer to unsupported_step pointing at the password form", async () => {
      global.fetch.mockResolvedValueOnce(jsonRes({ id: "flow-1", status: "PASSWORD_REQUIRED" }));
      const err = await lookupUser(FLOW, "demouser").catch((e) => e);
      expect(err.code).toBe("unsupported_step");
      expect(err.message).toMatch(/password/i);
    });
  });
});
