// Embedded sign-in for /sdk-login: PingOne's native flow (response_mode=pi.flow)
// driven from the browser, so the page can show its own username/password form.
//
//   1. GET  <SDK authorize URL>&response_mode=pi.flow  -> USERNAME_PASSWORD_REQUIRED
//   2. POST _links["usernamePassword.check"]            -> COMPLETED (sets PingOne's ST cookie)
//   3. GET  /as/resume?flowId=                          -> authorizeResponse { code, state }
//
// The SDK built the authorize URL, so it already holds state + the PKCE verifier;
// the caller finishes with client.token.exchange(code, state). No Authorization
// header anywhere: these endpoints are served by auth.pingone.com.
//
// Requires (measured 2026-09-14): explicit CORS origins on the PingOne app —
// without them /as/resume's 200 carries no Access-Control-Allow-Origin — and a
// browser that keeps PingOne's third-party ST cookie (Safari/Firefox do not).

export const PASSWORD_CHECK_TYPE = "application/vnd.pingidentity.usernamePassword.check+json";

export class EmbeddedSignInError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "EmbeddedSignInError";
    this.code = code;
    this.detail = detail;
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// /as/resume after COMPLETED: PingOne's ST cookie (set by the last step) yields the code.
async function resumeFlow(flow, body) {
  const resumeUrl = body.resumeUrl || `${flow.resumeBase}/as/resume?flowId=${encodeURIComponent(body.id || flow.flowId)}`;
  let resume;
  try {
    const r = await fetch(resumeUrl, { credentials: "include", headers: { Accept: "*/*" } });
    resume = await readJson(r);
  } catch {
    throw new EmbeddedSignInError(
      "resume_blocked",
      "The browser could not finish the sign-in. It did not send PingOne's session cookie, which usually means third-party cookies are blocked here.",
    );
  }
  const code = resume.authorizeResponse?.code;
  const state = resume.authorizeResponse?.state;
  if (!code || !state) {
    throw new EmbeddedSignInError(
      "resume_blocked",
      "PingOne did not return an authorization code. The browser probably did not send PingOne's session cookie (third-party cookies blocked).",
    );
  }
  return { code, state };
}

export async function startEmbeddedSignInFromUrl(url, { allowImmediateCompletion = false } = {}) {
  if (typeof url !== "string") {
    throw new EmbeddedSignInError("start_failed", "Could not build the authorization URL.");
  }
  const authorizeUrl = new URL(url);
  authorizeUrl.searchParams.set("response_mode", "pi.flow");

  const res = await fetch(authorizeUrl.toString(), { credentials: "include", headers: { Accept: "*/*" } });
  const flow = await readJson(res);
  if (!res.ok || !flow.id) {
    throw new EmbeddedSignInError("start_failed", flow.message || `PingOne did not start a flow (HTTP ${res.status}).`);
  }
  if (flow.status === "COMPLETED" && flow.authorizeResponse?.code && flow.authorizeResponse?.state) {
    if (!allowImmediateCompletion) {
      throw new EmbeddedSignInError("unsupported_step", "PingOne completed sign-in without a username and password step.", flow.status);
    }
    return {
      code: flow.authorizeResponse.code,
      state: flow.authorizeResponse.state,
    };
  }
  if (flow.status !== "USERNAME_PASSWORD_REQUIRED") {
    throw new EmbeddedSignInError("unsupported_step", `PingOne asked for ${flow.status}, which this form does not handle.`, flow.status);
  }
  const checkUrl = flow._links?.["usernamePassword.check"]?.href;
  if (!checkUrl) {
    throw new EmbeddedSignInError("start_failed", "PingOne did not offer a username and password check.");
  }
  return {
    flowId: flow.id,
    checkUrl,
    resumeBase: `${authorizeUrl.origin}${authorizeUrl.pathname.replace(/\/as\/authorize$/, "")}`,
  };
}

export async function startEmbeddedSignIn(client) {
  const url = await client.authorize.url();
  if (typeof url !== "string") {
    throw new EmbeddedSignInError("start_failed", url?.error || "Could not build the authorization URL.");
  }
  return startEmbeddedSignInFromUrl(url);
}

export async function submitPassword(flow, username, password) {
  const res = await fetch(flow.checkUrl, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": PASSWORD_CHECK_TYPE, Accept: "*/*" },
    body: JSON.stringify({ username, password }),
  });
  const body = await readJson(res);
  if (!res.ok || body.status === "USERNAME_PASSWORD_REQUIRED") {
    if (res.status === 400 || body.status === "USERNAME_PASSWORD_REQUIRED") {
      const message = body.details?.[0]?.message || body.message || "PingOne rejected the username or password.";
      throw new EmbeddedSignInError("invalid_credentials", message, body.code);
    }
    const message = body.details?.[0]?.message || body.message || `PingOne could not check the password (HTTP ${res.status}).`;
    throw new EmbeddedSignInError("start_failed", message, body.code);
  }
  if (body.status !== "COMPLETED") {
    throw new EmbeddedSignInError("unsupported_step", `PingOne asked for ${body.status}, which this form does not handle.`, body.status);
  }

  return resumeFlow(flow, body);
}

// Passwordless (device-first): the same PingOne steps demo_api_server/services/piFlowDriver.js
// drives for the main sign-in modal, from the browser. acr_values=mfa_only selects the
// identifier-first policy; user.lookup -> [DEVICE_SELECTION_REQUIRED -> device.select] ->
// OTP_REQUIRED -> otp.check -> COMPLETED -> /as/resume. Passkeys (ASSERTION_REQUIRED) are
// not driven here.
const USER_LOOKUP_TYPE = "application/vnd.pingidentity.user.lookup+json";
const DEVICE_SELECT_TYPE = "application/vnd.pingidentity.device.select+json";
const OTP_CHECK_TYPE = "application/vnd.pingidentity.otp.check+json";

export async function startPasswordlessSignIn(client) {
  const url = await client.authorize.url({ query: { acr_values: "mfa_only" } });
  if (typeof url !== "string") {
    throw new EmbeddedSignInError("start_failed", url?.error || "Could not build the authorization URL.");
  }
  const authorizeUrl = new URL(url);
  authorizeUrl.searchParams.set("response_mode", "pi.flow");
  const res = await fetch(authorizeUrl.toString(), { credentials: "include", headers: { Accept: "*/*" } });
  const flow = await readJson(res);
  if (!res.ok || !flow.id) {
    throw new EmbeddedSignInError("start_failed", flow.details?.[0]?.message || flow.message || `PingOne did not start a flow (HTTP ${res.status}).`);
  }
  if (!flow._links?.["user.lookup"]) {
    throw new EmbeddedSignInError("unsupported_step", "PingOne did not offer a device sign-in for this app. Use your password instead.", flow.status);
  }
  const resumeBase = `${authorizeUrl.origin}${authorizeUrl.pathname.replace(/\/as\/authorize$/, "")}`;
  return { flowId: flow.id, stepUrl: `${resumeBase}/flows/${flow.id}`, resumeBase };
}

async function postStep(flow, contentType, payload) {
  const res = await fetch(flow.stepUrl, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": contentType, Accept: "*/*" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (res.status === 400 && body.details?.some((d) => d.code === "OTP_VALIDATION_FAILED")) {
    throw new EmbeddedSignInError("invalid_otp", "That code is not valid. Check it and try again.");
  }
  if (!res.ok) {
    throw new EmbeddedSignInError("start_failed", body.details?.[0]?.message || body.message || `PingOne rejected the step (HTTP ${res.status}).`, body.code);
  }
  if (body.status === "COMPLETED") return { step: "done", ...(await resumeFlow(flow, body)) };
  if (body.status === "OTP_REQUIRED" || body.status === "DEVICE_SELECTION_REQUIRED") {
    const devices = (body._embedded?.devices || body.devices || [])
      .filter((d) => (d.usableStatus?.status || "ENABLED") === "ENABLED")
      .map((d) => ({ id: d.id, type: d.type, nickname: d.nickname || null, email: d.email || null, phone: d.phone || null }));
    return { step: body.status === "OTP_REQUIRED" ? "otp" : "device", devices, selectedDeviceId: body.selectedDevice?.id || null };
  }
  if (body.status === "ASSERTION_REQUIRED") {
    throw new EmbeddedSignInError("unsupported_step", "PingOne asked for a passkey, which this form does not handle. Use the pop-out or the redirect.", body.status);
  }
  throw new EmbeddedSignInError("unsupported_step", "This account needs a password. Use your password instead.", body.status);
}

export const lookupUser = (flow, username) => postStep(flow, USER_LOOKUP_TYPE, { username: username.trim() });
export const selectDevice = (flow, deviceId) => postStep(flow, DEVICE_SELECT_TYPE, { device: { id: deviceId } });
export const checkOtp = (flow, otp) => postStep(flow, OTP_CHECK_TYPE, { otp: otp.trim() });
