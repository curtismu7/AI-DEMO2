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

export async function startEmbeddedSignIn(client) {
  const url = await client.authorize.url();
  if (typeof url !== "string") {
    throw new EmbeddedSignInError("start_failed", url?.error || "Could not build the authorization URL.");
  }
  const authorizeUrl = new URL(url);
  authorizeUrl.searchParams.set("response_mode", "pi.flow");

  const res = await fetch(authorizeUrl.toString(), { credentials: "include", headers: { Accept: "*/*" } });
  const flow = await readJson(res);
  if (!res.ok || !flow.id) {
    throw new EmbeddedSignInError("start_failed", flow.message || `PingOne did not start a flow (HTTP ${res.status}).`);
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

export async function submitPassword(flow, username, password) {
  const res = await fetch(flow.checkUrl, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": PASSWORD_CHECK_TYPE, Accept: "*/*" },
    body: JSON.stringify({ username, password }),
  });
  const body = await readJson(res);
  if (!res.ok || body.status === "USERNAME_PASSWORD_REQUIRED") {
    const message = body.details?.[0]?.message || body.message || "PingOne rejected the username or password.";
    throw new EmbeddedSignInError("invalid_credentials", message, body.code);
  }
  if (body.status !== "COMPLETED") {
    throw new EmbeddedSignInError("unsupported_step", `PingOne asked for ${body.status}, which this form does not handle.`, body.status);
  }

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
