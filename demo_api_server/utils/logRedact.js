// demo_api_server/utils/logRedact.js
/**
 * Redact secrets from structured log metadata / messages before persistence.
 */

const SECRET_KEY_RE =
  /^(authorization|access_token|refresh_token|id_token|client_secret|password|passwd|secret|api[_-]?key|cookie|set-cookie|bearer)$/i;

const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function redactValue(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.replace(JWT_RE, "[REDACTED_JWT]");
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (typeof value === "object") {
    return redactObject(value);
  }
  return value;
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {Record<string, unknown>}
 */
function redactObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactValue(v);
    }
  }
  return out;
}

/**
 * @param {string} message
 * @returns {string}
 */
function redactMessage(message) {
  if (typeof message !== "string") return String(message ?? "");
  return message.replace(JWT_RE, "[REDACTED_JWT]");
}

module.exports = {
  redactValue,
  redactObject,
  redactMessage,
  SECRET_KEY_RE,
};
