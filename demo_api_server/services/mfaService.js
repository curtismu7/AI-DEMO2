const axios = require("axios");
const configStore = require("./configStore");
const { getTokenEndpoint } = require("./oauthEndpointResolver");
const { sanitizeAxiosCause } = require("../utils/sanitizeAxiosCause");
const oauthService = require("./oauthService");

function _authBaseUrl() {
  // PingOne Device Authentications API lives at https://auth.pingone.{region}/{envId}
  // (NOT at the OIDC AS path /as).
  const region = configStore.getEffective("pingone_region") || "com";
  const envId = configStore.getEffective("pingone_environment_id");
  return `https://auth.pingone.${region}/${envId}`;
}

function _apiBaseUrl() {
  const region = configStore.getEffective("pingone_region") || "com";
  const envId = configStore.getEffective("pingone_environment_id");
  return `https://api.pingone.${region}/v1/environments/${envId}`;
}

async function _getWorkerToken() {
  const envId = configStore.getEffective("pingone_environment_id");
  // Use PINGONE_WORKER_TOKEN credentials, falling back to management credentials
  const clientId =
    process.env.PINGONE_WORKER_TOKEN_CLIENT_ID ||
    configStore.getEffective("pingone_worker_token_client_id") ||
    configStore.getEffective("pingone_mgmt_client_id") ||
    configStore.getEffective("PINGONE_MANAGEMENT_CLIENT_ID");
  const clientSecret =
    process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET ||
    configStore.getEffective("pingone_worker_token_client_secret") ||
    configStore.getEffective("pingone_mgmt_client_secret") ||
    configStore.getEffective("PINGONE_MANAGEMENT_CLIENT_SECRET");
  const authMethod = (
    process.env.PINGONE_WORKER_TOKEN_AUTH_METHOD || "basic"
  ).toLowerCase();
  if (!envId || !clientId || !clientSecret)
    throw new Error(
      "PingOne worker credentials not configured. Set PINGONE_WORKER_TOKEN_CLIENT_ID/SECRET or pingone_mgmt_client_id/secret via the Worker App tab at /config.",
    );
  const tokenUrl = getTokenEndpoint();
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const reqConfig = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000,
  };
  if (authMethod === "post") {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  } else {
    reqConfig.auth = { username: clientId, password: clientSecret };
  }
  const resp = await axios.post(tokenUrl, body.toString(), reqConfig);
  // Return the raw access-token string: every caller interpolates the result
  // directly as `Bearer ${token}`. Returning an object here yields
  // "Bearer [object Object]" and 401s every worker-token call.
  return resp.data.access_token;
}

let _cachedDefaultPolicyId = null;

async function _getDefaultMfaPolicy(workerToken) {
  if (_cachedDefaultPolicyId) return _cachedDefaultPolicyId;
  const token = workerToken || (await _getWorkerToken());
  // Use the modern deviceAuthenticationPolicies endpoint — the legacy
  // /mfaPolicies alias rejects the worker bearer (403) in this environment.
  const { data } = await axios.get(
    `${_apiBaseUrl()}/deviceAuthenticationPolicies`,
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    },
  );
  const policies = data._embedded?.deviceAuthenticationPolicies || [];
  const def = policies.find((p) => p.default === true) || policies[0];
  if (!def) throw new Error("No MFA policies found in PingOne environment");
  console.log("[MFA] resolved default policy id=%s name=%s", def.id, def.name);
  _cachedDefaultPolicyId = def.id;
  return def.id;
}

function _wrapError(fnName, err, opts = {}) {
  const pingErr = err.response?.data;
  console.error(`[MFA] ${fnName} failed:`, pingErr || err.message);
  const e = new Error(
    pingErr?.message || pingErr?.detail || "MFA operation failed",
  );
  e.status = err.response?.status || 500;
  e.pingError = pingErr;
  // Credential-safe cause (strips err.config Bearer/secret); preserves transport code + status.
  e.cause = sanitizeAxiosCause(err);
  if (err._debug) e._debug = err._debug;
  // Attach semantic code for challenge lifecycle errors
  const status = err.response?.status;
  if (status === 401) {
    // A 401 on a WORKER-token call is a service/credential failure, not a user
    // session expiry — refreshing the user's token won't help and only loops to
    // session_expired. Use a distinct code so the route surfaces it plainly.
    e.code = opts.workerToken ? "mfa_service_auth_failed" : "token_expired";
  } else if (status === 404 || status === 410) e.code = "challenge_expired";
  return e;
}

/** Build sanitized headers object for debug display. Bearer token is truncated for safety. */
function _debugHeaders(token, contentType) {
  const t = String(token || "");
  const authVal =
    t.length > 20
      ? `Bearer ${t.slice(0, 20)}...[truncated]`
      : "Bearer [REDACTED]";
  return { Authorization: authVal, "Content-Type": contentType };
}

/**
 * Exchange user access token for a Device Authentication scoped token via RFC 8693.
 *
 * Device Authentications API requires a token with audience scoped to the Device
 * Authentication resource. This function exchanges the user's general access token
 * for a narrowly-scoped token with the correct audience.
 *
 * Pattern reference: RFC 8693 token exchange used in agentMcpTokenService.js
 *
 * @param {string} userAccessToken - User's access token from session
 * @returns {Promise<string|null>} - Scoped token for Device Auth API, or null if exchange fails
 */
async function _exchangeTokenForDeviceAuth(userAccessToken) {
  try {
    const deviceAuthResourceUri =
      configStore.getEffective("pingone_resource_device_auth_uri") ||
      process.env.PINGONE_RESOURCE_DEVICE_AUTH_URI;

    if (!deviceAuthResourceUri) {
      console.warn(
        "[MFA] PINGONE_RESOURCE_DEVICE_AUTH_URI not configured — using user token directly",
      );
      return userAccessToken; // Fallback: use original token if resource URI not configured
    }

    const deviceAuthToken = await oauthService.performTokenExchange(
      userAccessToken,
      deviceAuthResourceUri,
      ["device-authentication"],
    );

    if (!deviceAuthToken) {
      console.warn(
        "[MFA] Token exchange for Device Auth failed — returning null",
      );
      return null;
    }

    console.log(
      "[MFA] ✓ Token exchange successful for Device Authentication resource",
    );
    return deviceAuthToken;
  } catch (err) {
    console.error("[MFA] Token exchange error:", err.message);
    return null; // Return null to signal exchange failure
  }
}

/**
 * Initiate PingOne deviceAuthentications for a user.
 * Uses a WORKER (client_credentials) token — PingOne's MFA deviceAuthentications
 * API rejects the user's custom-resource-audience token (aud=enduser.ping.demo)
 * with INVALID_TOKEN / "You do not have access to this resource". This mirrors
 * initiateOneTimeOtp, selectDevice, and submitOtp, which all use the worker token
 * against the same resource. The user-token arg is accepted for signature
 * compatibility but ignored.
 * Returns { id (daId), status, _embedded: { devices[] } }
 * Status: DEVICE_SELECTION_REQUIRED (multiple devices) or OTP_REQUIRED (single
 * device — PingOne auto-selects it and dispatches the OTP).
 */
async function initiateDeviceAuth(userId, _userAccessToken) {
  const workerToken = await _getWorkerToken();
  let policyId = configStore.getEffective("pingone_mfa_policy_id");
  if (!policyId) {
    console.log(
      "[MFA] PINGONE_MFA_POLICY_ID not set — resolving default policy from PingOne",
    );
    try {
      policyId = await _getDefaultMfaPolicy(workerToken);
    } catch (resolveErr) {
      const e = new Error(
        "PINGONE_MFA_POLICY_ID is not configured and default policy could not be resolved: " +
          resolveErr.message,
      );
      e.status = 503;
      e.code = "mfa_not_configured";
      throw e;
    }
  }
  const url = `${_authBaseUrl()}/deviceAuthentications?expand=embedded`;
  const reqBody = { user: { id: userId }, policy: { id: policyId } };
  const debugRequest = {
    method: "POST",
    url: url,
    body: reqBody,
    contentType: "application/json",
    headers: _debugHeaders(workerToken, "application/json"),
  };
  try {
    let data;
    try {
      const resp = await axios.post(url, reqBody, {
        headers: {
          Authorization: `Bearer ${workerToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });
      data = resp.data;
    } catch (err) {
      err._debug = {
        request: debugRequest,
        response: err.response?.data || null,
      };
      throw err;
    }
    console.log(
      "[MFA] ═══════════════════════════════════════════════════════════════",
    );
    console.log("[MFA] INITIATED DEVICE AUTHENTICATION");
    console.log(
      "[MFA] ═══════════════════════════════════════════════════════════════",
    );
    console.log("[MFA] daId: %s", data.id);
    console.log(
      "[MFA] status: %s (transitions to OTP_REQUIRED or ASSERTION_REQUIRED)",
      data.status,
    );
    console.log(
      "[MFA] devices available: %d",
      data._embedded?.devices?.length || 0,
    );
    if (data._embedded?.devices) {
      data._embedded.devices.forEach((d, i) => {
        console.log("[MFA]   Device %d: type=%s id=%s", i + 1, d.type, d.id);
        if (d.type === "EMAIL")
          console.log(
            "[MFA]        → Email OTP will be sent to registered email",
          );
        if (d.type === "SMS" || d.type === "MOBILE_PHONE")
          console.log(
            "[MFA]        → SMS OTP will be sent to registered phone",
          );
        if (d.type === "FIDO2")
          console.log("[MFA]        → Security key/passkey authentication");
        if (d.type === "TOTP")
          console.log("[MFA]        → Time-based OTP (authenticator app)");
      });
    }
    console.log(
      "[MFA] ═══════════════════════════════════════════════════════════════",
    );
    return { ...data, _debug: { request: debugRequest, response: data } };
  } catch (err) {
    // This call uses a worker token, so a 401 is a service/credential failure,
    // not a user-session expiry — flag it so the route doesn't pointlessly refresh.
    throw _wrapError("initiateDeviceAuth", err, { workerToken: true });
  }
}

/**
 * Select a device to use for authentication.
 * Body: { selectedDevice: { id: deviceId } }
 * Returns updated device authentication status.
 * Status transitions: DEVICE_SELECTION_REQUIRED → OTP_REQUIRED | ASSERTION_REQUIRED | PUSH_CONFIRMATION_REQUIRED
 */
async function selectDevice(daId, deviceId, _userAccessToken) {
  // PingOne MFA v1 API requires a worker (client_credentials) token for device selection.
  // User access tokens are rejected with INVALID_TOKEN by /deviceAuthentications/{daId}.
  const token = await _getWorkerToken();
  if (!token) {
    throw new Error(
      "selectDevice requires a worker token — PingOne worker credentials not configured",
    );
  }

  const url = `${_authBaseUrl()}/deviceAuthentications/${daId}`;

  // PingOne device selection requires POST with custom content-type and specific body format
  const reqBody = {
    device: { id: deviceId },
    compatibility: "FULL",
  };
  const contentType = "application/vnd.pingidentity.device.select+json";

  console.log(`[selectDevice] Full URL: ${url}`);
  console.log(`[selectDevice] Method: POST`);
  console.log(`[selectDevice] Content-Type: ${contentType}`);
  console.log(`[selectDevice] Request body: ${JSON.stringify(reqBody)}`);
  console.log(`[selectDevice] Using token (len=${token?.length || 0})`);

  const debugRequest = {
    method: "POST",
    url: url,
    body: reqBody,
    contentType: contentType,
    headers: _debugHeaders(token, contentType),
  };
  try {
    let data;
    try {
      const authHeader = `Bearer ${token}`;
      console.log(
        `[selectDevice] Authorization header ready (Bearer token present)`,
      );

      const resp = await axios.post(url, reqBody, {
        headers: {
          Authorization: authHeader,
          "Content-Type": contentType,
        },
        timeout: 10000,
      });
      data = resp.data;
    } catch (err) {
      const status = err.response?.status;
      const respData = err.response?.data || null;
      console.error(`[MFA selectDevice] PingOne returned ${status}:`, respData);
      err._debug = { request: debugRequest, response: respData };
      throw err;
    }
    console.log(
      "[MFA] ═══════════════════════════════════════════════════════════════",
    );
    console.log("[MFA] DEVICE SELECTED FOR AUTHENTICATION");
    console.log(
      "[MFA] ═══════════════════════════════════════════════════════════════",
    );
    console.log("[MFA] daId: %s", daId);
    console.log("[MFA] deviceId: %s", deviceId);
    console.log("[MFA] new status: %s", data.status);
    if (data.status === "OTP_REQUIRED") {
      console.log("[MFA] → Waiting for OTP (check email or SMS for code)");
      console.log("[MFA] → OTP should arrive within 30 seconds");
    } else if (data.status === "ASSERTION_REQUIRED") {
      console.log("[MFA] → Waiting for FIDO2/WebAuthn assertion");
      console.log(
        "[MFA] → User should be prompted to use security key or passkey",
      );
    } else if (data.status === "PUSH_CONFIRMATION_REQUIRED") {
      console.log("[MFA] → Waiting for push confirmation");
      console.log(
        "[MFA] → User should receive push notification on registered device",
      );
    }
    console.log(
      "[MFA] ═══════════════════════════════════════════════════════════════",
    );
    return { ...data, _debug: { request: debugRequest, response: data } };
  } catch (err) {
    // Worker-token call — a 401 is a service/credential failure, not user-session expiry.
    throw _wrapError("selectDevice", err, { workerToken: true });
  }
}

/**
 * Submit an OTP or TOTP code for verification.
 * Body: { selectedDevice: { id: deviceId, otp: "123456" } }
 * Status transitions: OTP_REQUIRED → COMPLETED | FAILED
 */
async function submitOtp(daId, deviceId, otp, _userAccessToken) {
  // PingOne otp.check requires a worker token — user tokens are rejected with INVALID_TOKEN.
  // Ref: pingone-mfa skill §3 token rules; device-authentications-api.md "Token rules (critical)"
  const token = await _getWorkerToken();

  // OTP check endpoint: POST to deviceAuthentications/{daId} with otp.check content-type.
  // Note: NOT a /otp sub-path — same root resource URL as device.select and assertion.check.
  const url = `${_authBaseUrl()}/deviceAuthentications/${daId}`;
  const reqBody = { otp: String(otp) };
  const contentType = "application/vnd.pingidentity.otp.check+json";

  console.log(
    "[MFA] ═══════════════════════════════════════════════════════════════",
  );
  console.log("[MFA] OTP SUBMISSION");
  console.log(
    "[MFA] ═══════════════════════════════════════════════════════════════",
  );
  console.log(`[submitOtp] daId: ${daId}`);
  console.log(`[submitOtp] deviceId: ${deviceId}`);
  console.log(
    `[submitOtp] OTP: ${String(otp).charAt(0)}${"*".repeat(Math.max(0, String(otp).length - 2))}${String(otp).charAt(String(otp).length - 1)} (masked for security)`,
  );
  console.log(`[submitOtp] Full URL: ${url}`);
  console.log(`[submitOtp] Method: POST`);
  console.log(`[submitOtp] Using worker token (len=${token?.length || 0})`);

  const debugRequest = {
    method: "POST",
    url: url,
    body: reqBody,
    contentType: contentType,
    headers: _debugHeaders(token, contentType),
  };
  try {
    let data;
    try {
      const resp = await axios.post(url, reqBody, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
        },
        timeout: 10000,
      });
      data = resp.data;
    } catch (err) {
      const status = err.response?.status;
      const respData = err.response?.data || null;
      console.error(`[MFA submitOtp] PingOne returned ${status}:`, respData);
      err._debug = { request: debugRequest, response: respData };
      throw err;
    }
    return { ...data, _debug: { request: debugRequest, response: data } };
  } catch (err) {
    // Worker-token call — a 401 is a service/credential failure, not user-session expiry.
    throw _wrapError("submitOtp", err, { workerToken: true });
  }
}

/**
 * Poll or fetch the current device authentication status.
 * Used for:
 *   - Push: poll until COMPLETED or PUSH_CONFIRMATION_TIMED_OUT
 *   - FIDO2: retrieve publicKeyCredentialRequestOptions (status: ASSERTION_REQUIRED)
 */
async function getDeviceAuthStatus(daId, _userAccessToken) {
  try {
    // PingOne MFA v1 API requires a worker token for device authentication status reads.
    const token = await _getWorkerToken();
    if (!token) {
      throw new Error(
        "getDeviceAuthStatus requires a worker token — PingOne worker credentials not configured",
      );
    }

    const url = `${_authBaseUrl()}/deviceAuthentications/${daId}`;
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    return data;
  } catch (err) {
    // Worker-token call — a 401 is a service/credential failure, not user-session expiry.
    throw _wrapError("getDeviceAuthStatus", err, { workerToken: true });
  }
}

/**
 * Submit a FIDO2/WebAuthn assertion.
 * Body: { assertion: { ... } } — base64-encoded fields from navigator.credentials.get()
 * Status transitions: ASSERTION_REQUIRED → COMPLETED | FAILED
 */
async function submitFido2Assertion(daId, assertion, userAccessToken, origin) {
  try {
    const url = `${_authBaseUrl()}/deviceAuthentications/${daId}`;
    // PingOne requires the assertion field to be a JSON string (not an object).
    // Ref: PingOne docs "Check Assertion (FIDO Device)" — assertion type: String
    const assertionStr =
      typeof assertion === "string" ? assertion : JSON.stringify(assertion);
    const body = {
      origin: origin || "",
      assertion: assertionStr,
      compatibility: "FULL",
    };
    const debugUrl = url;
    const debugRequest = {
      method: "POST",
      url: debugUrl,
      body: { ...body, assertion: "<base64-encoded WebAuthn assertion>" },
      contentType: "application/vnd.pingidentity.assertion.check+json",
      headers: _debugHeaders(
        userAccessToken,
        "application/vnd.pingidentity.assertion.check+json",
      ),
    };
    console.log(
      "[MFA] ═══════════════════════════════════════════════════════════════",
    );
    console.log("[MFA] FIDO2/SECURITY KEY ASSERTION SUBMISSION");
    console.log(
      "[MFA] ═══════════════════════════════════════════════════════════════",
    );
    console.log("[MFA] daId: %s", daId);
    console.log("[MFA] origin: %s", body.origin || "(none)");
    console.log("[MFA] POST %s", url);
    console.log("[MFA] → User touched security key or used biometric");
    console.log("[MFA] → Assertion received and being verified by PingOne");
    console.log(
      "[MFA] ═══════════════════════════════════════════════════════════════",
    );
    let data;
    try {
      const resp = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          "Content-Type": "application/vnd.pingidentity.assertion.check+json",
        },
        timeout: 45000,
      });
      data = resp.data;
    } catch (err) {
      err._debug = {
        request: debugRequest,
        response: err.response?.data || null,
      };
      throw err;
    }
    return {
      ...data,
      _debug: { request: debugRequest, response: data },
    };
  } catch (err) {
    throw _wrapError("submitFido2Assertion", err);
  }
}

/**
 * List active MFA devices for a user via Management API (worker token).
 * Used for device management UI — NOT required for the step-up challenge flow
 * (deviceAuthentications already returns devices at DEVICE_SELECTION_REQUIRED).
 */
async function listMfaDevices(userId) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices?filter=(status eq "ACTIVE")`;
    const debugRequest = {
      method: "GET",
      endpoint: url,
      headers: _debugHeaders(workerToken, "application/json"),
    };
    const { data } = await axios
      .get(url, {
        headers: { Authorization: `Bearer ${workerToken}` },
        timeout: 10000,
      })
      .catch((err) => {
        err._debug = {
          request: debugRequest,
          response: err.response?.data || null,
        };
        throw err;
      });
    return {
      devices: data._embedded?.devices || [],
      _debug: { request: debugRequest, response: data },
    };
  } catch (err) {
    throw _wrapError("listMfaDevices", err);
  }
}

/**
 * Enroll an email OTP device for a user via Management API (worker token).
 * @param {string} userId
 * @param {string} email   - User's email address to enroll
 * Returns { id, type, email, status }
 */
async function enrollEmailDevice(userId, email) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices`;
    const reqBody = { type: "EMAIL", email };
    const debugRequest = {
      method: "POST",
      url: url,
      body: reqBody,
      contentType: "application/json",
      headers: _debugHeaders(workerToken, "application/json"),
    };
    let data;
    try {
      const resp = await axios.post(url, reqBody, {
        headers: {
          Authorization: `Bearer ${workerToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });
      data = resp.data;
    } catch (err) {
      err._debug = {
        request: debugRequest,
        response: err.response?.data || null,
      };
      throw err;
    }
    console.log(
      "[MFA] enrolled email device userId=%s deviceId=%s",
      userId,
      data.id,
    );
    return { ...data, _debug: { request: debugRequest, response: data } };
  } catch (err) {
    throw _wrapError("enrollEmailDevice", err);
  }
}

/**
 * Enroll an SMS OTP device for a user.
 * When called with the user's own access token, PingOne uses the user-facing enrollment
 * flow which sends an OTP and returns ACTIVATION_REQUIRED (phone verification required).
 * When called with a worker token only, PingOne creates the device as ACTIVE immediately.
 * @param {string} userId
 * @param {string} phone  - E.164 format e.g. +15551234567
 * @param {string} [userAccessToken] - user's OIDC access token; if provided, forces OTP flow
 * Returns { id, type, phone, status }
 */
async function enrollSmsDevice(userId, phone, userAccessToken) {
  try {
    // Prefer user token — PingOne will send OTP and return ACTIVATION_REQUIRED.
    // Fall back to worker token only when no session token is available.
    const token = userAccessToken || (await _getWorkerToken());
    const url = `${_apiBaseUrl()}/users/${userId}/devices`;
    const reqBody = { type: "SMS", phone };
    const debugRequest = {
      method: "POST",
      url: url,
      body: reqBody,
      contentType: "application/json",
      headers: _debugHeaders(token, "application/json"),
    };
    let data;
    try {
      const resp = await axios.post(url, reqBody, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });
      data = resp.data;
    } catch (err) {
      err._debug = {
        request: debugRequest,
        response: err.response?.data || null,
      };
      throw err;
    }
    console.log(
      "[MFA] enrolled SMS device userId=%s deviceId=%s status=%s (token-source=%s)",
      userId,
      data.id,
      data.status,
      userAccessToken ? "user" : "worker",
    );
    return { ...data, _debug: { request: debugRequest, response: data } };
  } catch (err) {
    // If user token cannot access device enrollment, retry with worker token.
    // PingOne may return 401 or 403 for this path depending on app/resource setup.
    const status = err.response?.status;
    const pingMsg = String(
      err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "",
    ).toLowerCase();
    const accessDenied =
      status === 401 ||
      status === 403 ||
      pingMsg.includes("do not have access") ||
      pingMsg.includes("insufficient") ||
      pingMsg.includes("scope");
    if (userAccessToken && accessDenied) {
      console.warn(
        "[MFA] enrollSmsDevice: user token denied (status=%s), retrying with worker token",
        status,
      );
      return enrollSmsDevice(userId, phone);
    }
    throw _wrapError("enrollSmsDevice", err);
  }
}

/**
 * Complete SMS device enrollment by submitting the OTP sent to the phone.
 * @param {string} userId
 * @param {string} deviceId - from enrollSmsDevice
 * @param {string} otp      - 6-digit code texted to the phone
 * Returns { id, status }
 */
async function completeSmsEnrollment(userId, deviceId, otp) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices/${deviceId}`;
    const reqBody = { otp };
    const debugRequest = {
      method: "PUT",
      url: url,
      body: reqBody,
      contentType: "application/vnd.pingidentity.device.activate+json",
      headers: _debugHeaders(
        workerToken,
        "application/vnd.pingidentity.device.activate+json",
      ),
    };
    let data;
    try {
      const resp = await axios.put(url, reqBody, {
        headers: {
          Authorization: `Bearer ${workerToken}`,
          "Content-Type": "application/vnd.pingidentity.device.activate+json",
        },
        timeout: 10000,
      });
      data = resp.data;
    } catch (err) {
      err._debug = {
        request: debugRequest,
        response: err.response?.data || null,
      };
      throw err;
    }
    console.log(
      "[MFA] completed SMS enrollment userId=%s deviceId=%s status=%s",
      userId,
      data.id,
      data.status,
    );
    return { ...data, _debug: { request: debugRequest, response: data } };
  } catch (err) {
    throw _wrapError("completeSmsEnrollment", err);
  }
}

/**
 * Complete email OTP device enrollment by submitting the OTP sent to the address.
 * @param {string} userId
 * @param {string} deviceId - from enrollEmailDevice
 * @param {string} otp      - 6-digit code emailed to the user
 * Returns { id, type, status }
 */
async function completeEmailEnrollment(userId, deviceId, otp) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices/${deviceId}`;
    const reqBody = { otp };
    const debugRequest = {
      method: "PUT",
      url,
      body: reqBody,
      contentType: "application/vnd.pingidentity.device.activate+json",
      headers: _debugHeaders(
        workerToken,
        "application/vnd.pingidentity.device.activate+json",
      ),
    };
    let data;
    try {
      const resp = await axios.put(url, reqBody, {
        headers: {
          Authorization: `Bearer ${workerToken}`,
          "Content-Type": "application/vnd.pingidentity.device.activate+json",
        },
        timeout: 10000,
      });
      data = resp.data;
    } catch (err) {
      err._debug = {
        request: debugRequest,
        response: err.response?.data || null,
      };
      throw err;
    }
    console.log(
      "[MFA] completed email enrollment userId=%s deviceId=%s status=%s",
      userId,
      data.id,
      data.status,
    );
    return { ...data, _debug: { request: debugRequest, response: data } };
  } catch (err) {
    throw _wrapError("completeEmailEnrollment", err);
  }
}

/**
 * Initiate FIDO2/passkey device registration for a user via Management API.
 * Returns { deviceId, publicKeyCredentialCreationOptions, _debug }
 */
async function initFido2Registration(userId, allowCleanupRetry = true) {
  const workerToken = await _getWorkerToken();
  try {
    const url = `${_apiBaseUrl()}/users/${userId}/devices`;
    const reqBody = { type: "FIDO2", nickname: "My Passkey" };
    const { data } = await axios.post(url, reqBody, {
      headers: {
        Authorization: `Bearer ${workerToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
    const rawCreationOpts = data.publicKeyCredentialCreationOptions;
    const parsedOpts =
      typeof rawCreationOpts === "string"
        ? JSON.parse(rawCreationOpts)
        : rawCreationOpts;
    const challengeVal = parsedOpts?.challenge;
    const userIdVal = parsedOpts?.user?.id;
    console.log(
      "[MFA] initiated FIDO2 registration userId=%s deviceId=%s",
      userId,
      data.id,
    );
    console.log(
      "[FIDO2-INIT-DIAG] challenge type=%s isArray=%s value_start=%s",
      typeof challengeVal,
      Array.isArray(challengeVal),
      Array.isArray(challengeVal)
        ? JSON.stringify(challengeVal.slice(0, 5))
        : String(challengeVal).slice(0, 40),
    );
    console.log(
      "[FIDO2-INIT-DIAG] user.id type=%s value_start=%s",
      typeof userIdVal,
      Array.isArray(userIdVal)
        ? JSON.stringify(userIdVal.slice(0, 5))
        : String(userIdVal).slice(0, 40),
    );
    console.log(
      "[FIDO2-INIT-DIAG] attestation=%s authenticatorSelection=%j",
      parsedOpts?.attestation,
      parsedOpts?.authenticatorSelection,
    );
    return {
      deviceId: data.id,
      publicKeyCredentialCreationOptions:
        data.publicKeyCredentialCreationOptions,
      _debug: {
        request: {
          method: "POST",
          url: url,
          body: reqBody,
          contentType: "application/json",
          headers: _debugHeaders(workerToken, "application/json"),
        },
        response: data,
      },
    };
  } catch (err) {
    const pingErr = err.response?.data;
    const limitReached =
      pingErr?.code === "REQUEST_LIMITED" ||
      (pingErr?.details || []).some((d) => d?.code === "LIMIT_EXCEEDED");
    if (allowCleanupRetry && limitReached) {
      try {
        const active = await listMfaDevices(userId);
        const fidoDevices = active.filter((d) =>
          String(d?.type || "")
            .toUpperCase()
            .startsWith("FIDO2"),
        );
        if (fidoDevices.length > 0) {
          const deviceToRemove = fidoDevices[0];
          const delUrl = `${_apiBaseUrl()}/users/${userId}/devices/${deviceToRemove.id}`;
          await axios.delete(delUrl, {
            headers: { Authorization: `Bearer ${workerToken}` },
            timeout: 10000,
          });
          console.warn(
            "[MFA] initFido2Registration: removed deviceId=%s due to LIMIT_EXCEEDED, retrying",
            deviceToRemove.id,
          );
          return initFido2Registration(userId, false);
        }
      } catch (cleanupErr) {
        console.error(
          "[MFA] initFido2Registration cleanup retry failed:",
          cleanupErr.response?.data || cleanupErr.message,
        );
      }
    }
    throw _wrapError("initFido2Registration", err);
  }
}

/**
 * Complete FIDO2/passkey device registration by sending the WebAuthn attestation.
 * @param {string} userId
 * @param {string} deviceId  - from initFido2Registration
 * @param {object} attestation - base64-encoded fields from navigator.credentials.create()
 *   Must include: id, rawId, type, response.attestationObject, response.clientDataJSON
 *   Origin is appended server-side from PINGONE_FIDO2_ORIGIN env or auth base URL.
 * Returns { id, status }
 */
async function completeFido2Registration(
  userId,
  deviceId,
  attestation,
  requestOrigin,
) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices/${deviceId}`;

    // Origin must match the RP origin where navigator.credentials.create() ran (browser origin).
    // requestOrigin comes from the client (window.location.origin) and takes precedence.
    const origin =
      requestOrigin ||
      configStore.getEffective("pingone_fido2_origin") ||
      process.env.PINGONE_FIDO2_ORIGIN ||
      process.env.REACT_APP_CLIENT_URL ||
      "https://demo-api-server:3001";

    // PingOne device activate: fido2 is an object (not a string).
    // The base64 fields inside (clientDataJSON, attestationObject, etc.) are standard base64.
    // Diagnostic: decode clientDataJSON to log what origin the browser actually signed
    try {
      const cdjRaw = attestation?.response?.clientDataJSON;
      if (cdjRaw) {
        // clientDataJSON may be standard base64 or base64url — normalise before decode
        const b64 = String(cdjRaw).replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        const cdj = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
        console.log(
          "[FIDO2-DIAG] clientDataJSON decoded: type=%s origin=%s challenge_len=%s",
          cdj.type,
          cdj.origin,
          (cdj.challenge || "").length,
        );
        console.log("[FIDO2-DIAG] request body origin=%s", origin);
        console.log(
          "[FIDO2-DIAG] fido2.id=%s fido2.rawId=%s (same=%s)",
          attestation?.id,
          attestation?.rawId,
          attestation?.id === attestation?.rawId,
        );
        if (cdj.origin !== origin) {
          console.warn(
            "[FIDO2-DIAG] ORIGIN MISMATCH: browser signed with origin=%s but body sends origin=%s",
            cdj.origin,
            origin,
          );
        }
      }
    } catch (diagErr) {
      console.warn(
        "[FIDO2-DIAG] could not decode clientDataJSON:",
        diagErr.message,
      );
    }
    // PingOne device activate: "attestation" must be a JSON string (not object).
    // Ref: PingOne API docs "Activate a FIDO2 device" — attestation type: String
    const attestationStr =
      typeof attestation === "string"
        ? attestation
        : JSON.stringify(attestation);
    const body = {
      attestation: attestationStr,
      origin,
    };

    const debugUrl = url;
    const debugRequest = {
      method: "POST",
      url: debugUrl,
      body: { attestation: "<JSON string of WebAuthn attestation>", origin },
      contentType: "application/vnd.pingidentity.device.activate+json",
      headers: _debugHeaders(
        workerToken,
        "application/vnd.pingidentity.device.activate+json",
      ),
    };
    let data;
    try {
      const resp = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${workerToken}`,
          "Content-Type": "application/vnd.pingidentity.device.activate+json",
        },
        timeout: 15000,
      });
      data = resp.data;
    } catch (err) {
      const pingErr = err.response?.data;
      console.error(
        "[MFA] completeFido2Registration failed: status=%s code=%s details=%j",
        err.response?.status,
        pingErr?.code,
        pingErr?.details || pingErr?.message,
      );
      // Attach debug so the route can surface request/response even on failure
      err._debug = { request: debugRequest, response: pingErr || null };
      throw err;
    }

    console.log(
      "[MFA] completed FIDO2 registration userId=%s deviceId=%s status=%s",
      userId,
      deviceId,
      data.status,
    );
    return {
      ...data,
      _debug: {
        request: debugRequest,
        response: data,
      },
    };
  } catch (err) {
    throw _wrapError("completeFido2Registration", err);
  }
}

// initiateOneTimeOtp — WORKER token to POST /deviceAuthentications.
// The user's access token has a custom resource-server audience (e.g.
// enduser.ping.demo); PingOne's MFA Device Authentications API is a *platform*
// endpoint and rejects that token with ACCESS_FAILED / INVALID_TOKEN regardless
// of freshness. The one-time body already names the user + inline contact, so no
// user context is needed — a worker (client_credentials, platform-audience) token
// is accepted, and it matches the verify leg (verifyOneTimeOtp), which already
// uses a worker token. Verified e2e: 201 OTP_REQUIRED → otp.check 200 COMPLETED.
// The `_userAccessToken` arg is retained for call-site compatibility but unused.
async function initiateOneTimeOtp(
  userId,
  deliveryType,
  contact,
  _userAccessToken,
) {
  const authBase = _authBaseUrl();
  const workerToken = await _getWorkerToken();
  const oneTime =
    deliveryType === "EMAIL"
      ? { type: "EMAIL", email: contact }
      : { type: "SMS", phone: contact };
  const url = `${authBase}/deviceAuthentications`;
  const reqBody = { user: { id: userId }, selectedDevice: { oneTime } };
  const _debug = {
    request: {
      method: "POST",
      url,
      body: reqBody,
      contentType: "application/json",
      headers: _debugHeaders(workerToken, "application/json"),
    },
  };
  try {
    const resp = await axios.post(url, reqBody, {
      headers: {
        Authorization: `Bearer ${workerToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
    _debug.response = { status: resp.status, data: resp.data };
    console.log(
      "[MFA] initiateOneTimeOtp daId=%s status=%s",
      resp.data.id,
      resp.data.status,
    );
    return { ...resp.data, _debug };
  } catch (err) {
    err._debug = _debug;
    throw _wrapError("initiateOneTimeOtp", err);
  }
}

// verifyOneTimeOtp — worker token required (PingOne rejects user tokens with INVALID_TOKEN on verify)
async function verifyOneTimeOtp(daId, otp) {
  const authBase = _authBaseUrl();
  const workerToken = await _getWorkerToken();
  const url = `${authBase}/deviceAuthentications/${daId}`;
  const contentType = "application/vnd.pingidentity.otp.check+json";
  const _debug = {
    request: {
      method: "POST",
      url,
      body: { otp: "[REDACTED]" },
      contentType,
      headers: _debugHeaders(workerToken, contentType),
    },
  };
  try {
    const resp = await axios.post(
      url,
      { otp: String(otp) },
      {
        headers: {
          Authorization: `Bearer ${workerToken}`,
          "Content-Type": contentType,
        },
        timeout: 10000,
      },
    );
    _debug.response = { status: resp.status, data: resp.data };
    console.log(
      "[MFA] verifyOneTimeOtp daId=%s status=%s",
      daId,
      resp.data.status,
    );
    return { ...resp.data, _debug };
  } catch (err) {
    err._debug = _debug;
    throw _wrapError("verifyOneTimeOtp", err);
  }
}

async function getPingOneUserContact(userId) {
  const workerToken = await _getWorkerToken();
  const url = `${_apiBaseUrl()}/users/${userId}`;
  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${workerToken}` },
      timeout: 8000,
    });
    return { email: data.email || null, mobilePhone: data.mobilePhone || null };
  } catch (err) {
    throw _wrapError("getPingOneUserContact", err);
  }
}

/**
 * Delete an MFA device for a user via Management API (worker token).
 * @param {string} userId
 * @param {string} deviceId
 */
async function deleteDevice(userId, deviceId) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices/${deviceId}`;
    await axios.delete(url, {
      headers: { Authorization: `Bearer ${workerToken}` },
      timeout: 10000,
    });
    console.log("[MFA] deleted device userId=%s deviceId=%s", userId, deviceId);
  } catch (err) {
    throw _wrapError("deleteDevice", err);
  }
}

/**
 * Update the nickname for a registered MFA device via Management API.
 * @param {string} userId
 * @param {string} deviceId
 * @param {string} nickname
 * @returns {Promise<{id: string, nickname: string}>}
 */
async function updateDeviceNickname(userId, deviceId, nickname) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices/${deviceId}`;
    const { data } = await axios.patch(
      url,
      { nickname },
      {
        headers: {
          Authorization: `Bearer ${workerToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      },
    );
    console.log(
      "[MFA] updated nickname userId=%s deviceId=%s nickname=%s",
      userId,
      deviceId,
      nickname,
    );
    return { id: data.id, nickname: data.nickname };
  } catch (err) {
    throw _wrapError("updateDeviceNickname", err);
  }
}

/**
 * Ensure the environment's FIDO2 policies use a relying-party id that matches
 * the app's serving origin. PingOne defaults the FIDO2 rp.id to its own domain
 * (e.g. pingone.com); a browser rejects that when the app is served from a
 * different host ("'rp.id' cannot be used with the current origin"), so passkey
 * registration fails before anything reaches the server. Reads the FIDO2
 * policies via the Management API and, when the relying-party id differs,
 * PUTs the policy back with the corrected value. Idempotent; safe at boot.
 *
 * @param {string} rpId - relying-party id (origin hostname, e.g. "api.ping.demo")
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<object>} summary incl. before/after + the raw policies (dryRun)
 */
async function ensureFido2RelyingParty(rpId, opts = {}) {
  if (!rpId) throw new Error("ensureFido2RelyingParty: rpId is required");
  const workerToken = await _getWorkerToken();
  const base = _apiBaseUrl();
  const headers = { Authorization: `Bearer ${workerToken}` };
  const { data } = await axios.get(`${base}/fido2Policies`, {
    headers,
    timeout: 10000,
  });
  const policies = data?._embedded?.fido2Policies || [];
  const summary = {
    rpId,
    count: policies.length,
    changed: false,
    policies: [],
  };
  for (const p of policies) {
    const current = p.relyingPartyId ?? p.rpId ?? null;
    const needs = current !== rpId;
    const entry = {
      id: p.id,
      name: p.name,
      default: p.default,
      previous: current,
      needsChange: needs,
    };
    if (needs && !opts.dryRun) {
      // Read-first PUT: strip read-only fields, set the corrected rp.id.
      const { id, _links, environment, createdAt, updatedAt, ...body } = p;
      if ("relyingPartyId" in p || !("rpId" in p)) body.relyingPartyId = rpId;
      else body.rpId = rpId;
      try {
        await axios.put(`${base}/fido2Policies/${p.id}`, body, {
          headers: { ...headers, "Content-Type": "application/json" },
          timeout: 10000,
        });
        entry.updated = true;
        summary.changed = true;
        console.log(
          `[MFA] FIDO2 policy ${p.id} relyingPartyId ${current} → ${rpId}`,
        );
      } catch (err) {
        entry.updated = false;
        entry.error = err.response?.data || err.message;
        // PingOne rejects non-ICANN TLDs (e.g. .demo, .local) as rpId —
        // expected in local dev; not a real failure.
        const isInvalidTld = err.response?.data?.details?.some?.(
          (d) =>
            d.code === "CONSTRAINT_VIOLATION" && d.target === "relyingPartyId",
        );
        if (isInvalidTld) {
          console.info(
            `[MFA] FIDO2 policy ${p.id}: rpId "${rpId}" rejected by PingOne (non-ICANN TLD — expected in local dev)`,
          );
        } else {
          console.warn(
            `[MFA] FIDO2 policy ${p.id} update failed:`,
            JSON.stringify(entry.error),
          );
        }
      }
    }
    summary.policies.push(entry);
  }
  return summary;
}

module.exports = {
  ensureFido2RelyingParty,
  initiateDeviceAuth,
  selectDevice,
  submitOtp,
  getDeviceAuthStatus,
  submitFido2Assertion,
  initiateOneTimeOtp,
  verifyOneTimeOtp,
  getPingOneUserContact,
  listMfaDevices,
  enrollEmailDevice,
  enrollSmsDevice,
  completeSmsEnrollment,
  completeEmailEnrollment,
  initFido2Registration,
  completeFido2Registration,
  deleteDevice,
  updateDeviceNickname,
  getWorkerToken: _getWorkerToken,
  // Test helper — resets the cached default policy ID (used in unit tests)
  _resetDefaultPolicyCache() {
    _cachedDefaultPolicyId = null;
  },
};
