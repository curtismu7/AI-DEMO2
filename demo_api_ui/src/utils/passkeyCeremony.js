/**
 * passkeyCeremony — WebAuthn passkey (FIDO2) registration helper for the agent
 * step-up flow.
 *
 * When a user has no enrolled passkey but chooses passkey verification, we run a
 * real PingOne registration ceremony (init -> navigator.credentials.create ->
 * complete) so the device exists, then the caller re-initiates the MFA challenge
 * and authenticates with the freshly registered passkey.
 *
 * Encoding helpers mirror MFATestPage.tsx — PingOne returns challenge/user.id as
 * base64url strings (occasionally signed byte arrays), and pubKeyCredParams alg
 * as strings that WebAuthn requires as integers.
 */

const apiBase = process.env.REACT_APP_API_URL || "";

/** Convert base64url / signed-byte-array (PingOne) -> Uint8Array. */
export function b64ToBytes(val) {
  if (!val) throw new Error("Expected base64url value but got empty");
  if (val instanceof Uint8Array) return val;
  if (val instanceof ArrayBuffer) return new Uint8Array(val);
  if (Array.isArray(val)) return new Uint8Array(val.map((b) => b & 0xff));
  // PingOne / Jackson sometimes wrap buffers as { type: 'Buffer', data: [...] }
  if (typeof val === "object" && Array.isArray(val.data)) {
    return new Uint8Array(val.data.map((b) => b & 0xff));
  }
  const stripped = String(val)
    .replace(/\s/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/=+$/, "");
  const padded = stripped + "=".repeat((4 - (stripped.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch (e) {
    throw new Error(
      `base64url decode failed (first 20: "${padded.slice(0, 20)}"): ${e.message}`,
    );
  }
}

/** Convert an ArrayBuffer -> standard base64 (with padding). */
export function bytesToB64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Normalize PingOne `publicKeyCredentialRequestOptions` for navigator.credentials.get.
 *
 * PingOne returns this as a JSON string (ASSERTION_REQUIRED). Fields use base64url
 * (or Jackson byte arrays). Official sample uses `new Uint8Array(options.challenge)`,
 * which only works for numeric arrays — base64url strings must be decoded first.
 *
 * @see https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/check-assertion-device-authentication.html
 * @param {object|string} raw
 * @returns {PublicKeyCredentialRequestOptions}
 */
export function normalizePublicKeyRequestOptions(raw) {
  const opts = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!opts || typeof opts !== "object") {
    throw new Error("Missing publicKeyCredentialRequestOptions");
  }
  // Mirror PingOne's Authenticate() sample: only pass WebAuthn-known fields.
  const publicKey = {
    challenge: b64ToBytes(opts.challenge),
  };
  if ("rpId" in opts) publicKey.rpId = opts.rpId;
  if ("timeout" in opts) publicKey.timeout = opts.timeout;
  if ("userVerification" in opts) publicKey.userVerification = opts.userVerification;
  if ("extensions" in opts) publicKey.extensions = opts.extensions;
  if (Array.isArray(opts.allowCredentials)) {
    publicKey.allowCredentials = opts.allowCredentials.map((c) => {
      const cred = { type: c.type || "public-key", id: b64ToBytes(c.id) };
      if (c.transports) cred.transports = c.transports;
      return cred;
    });
  }
  return publicKey;
}

/**
 * Format a WebAuthn assertion for PingOne assertion.check.
 * Binary fields are standard base64 (toBase64Str in PingOne's sample). The BFF
 * JSON.stringifies this object into the required `assertion` String property,
 * with required `origin` + optional `compatibility`.
 *
 * @param {PublicKeyCredential} credential
 * @returns {object}
 */
export function formatPublicKeyCredentialAssertion(credential) {
  return {
    id: credential.id,
    rawId: bytesToB64(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bytesToB64(credential.response.clientDataJSON),
      authenticatorData: bytesToB64(credential.response.authenticatorData),
      signature: bytesToB64(credential.response.signature),
      userHandle: credential.response.userHandle
        ? bytesToB64(credential.response.userHandle)
        : null,
    },
  };
}

async function postJson(path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Surface the underlying PingOne error so origin/policy failures are
    // diagnosable instead of a generic "Request failed".
    const detail =
      data.pingError?.details?.[0]?.message ||
      data.pingError?.message ||
      data.message ||
      data.error ||
      `Request failed (${res.status})`;
    throw new Error(detail);
  }
  return data;
}

/**
 * Register a new passkey for the current session user via PingOne.
 * Runs the full WebAuthn create() ceremony.
 * @returns {Promise<{ deviceId: string, status: string }>}
 */
export async function registerPasskey() {
  if (!navigator.credentials) {
    throw new Error("WebAuthn is not supported in this browser");
  }

  // 1. Init — PingOne returns publicKeyCredentialCreationOptions + deviceId
  const init = await postJson("/api/auth/mfa/enroll/fido2-init");
  const rawOpts = init.publicKeyCredentialCreationOptions;
  if (!rawOpts || !init.deviceId) {
    throw new Error("Passkey registration could not be started");
  }
  const creationOpts = typeof rawOpts === "string" ? JSON.parse(rawOpts) : rawOpts;

  // 2. Normalise options for the browser WebAuthn API
  const publicKey = {
    ...creationOpts,
    challenge: b64ToBytes(creationOpts.challenge),
    user: { ...creationOpts.user, id: b64ToBytes(creationOpts.user?.id) },
  };
  if (Array.isArray(publicKey.pubKeyCredParams)) {
    publicKey.pubKeyCredParams = publicKey.pubKeyCredParams.map((p) => ({
      ...p,
      alg: typeof p.alg === "string" ? parseInt(p.alg, 10) : p.alg,
    }));
  }
  if (Array.isArray(publicKey.excludeCredentials)) {
    publicKey.excludeCredentials = publicKey.excludeCredentials.map((c) => ({
      ...c,
      id: b64ToBytes(c.id),
    }));
  }

  // 3. Create the credential — private key stays in the device secure enclave
  const credential = await navigator.credentials.create({ publicKey });
  if (!credential) throw new Error("No passkey credential was created");

  const attestation = {
    id: credential.id,
    rawId: bytesToB64(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bytesToB64(credential.response.clientDataJSON),
      attestationObject: bytesToB64(credential.response.attestationObject),
    },
    ...(credential.authenticatorAttachment
      ? { authenticatorAttachment: credential.authenticatorAttachment }
      : {}),
  };

  // 4. Complete — PingOne stores the public key and activates the device.
  // origin MUST match the browser origin the ceremony ran at (the value signed
  // into clientDataJSON) or PingOne rejects with an origin mismatch — the most
  // common FIDO2 failure. The working MFA test page sends this; the agent flow
  // previously omitted it.
  const done = await postJson("/api/auth/mfa/enroll/fido2-complete", {
    deviceId: init.deviceId,
    attestation,
    origin: window.location.origin,
  });
  return { deviceId: done.deviceId || init.deviceId, status: done.status };
}
