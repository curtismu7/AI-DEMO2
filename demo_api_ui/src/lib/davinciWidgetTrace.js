// Records the DaVinci widget's own API calls while it runs, for the Call
// Inspector and the run summary on /davinci-login-guide.
//
// davinci.js makes every flow call with fetch — on the run captured 2026-09-13,
// POST /davinci/policy/{policyId}/start and each /capabilities/... POST were
// resource type "fetch" — so only fetch is wrapped.
//
// Recorded per call: method, host, path, HTTP status and, from JSON responses,
// capabilityName, connectorId and success. Never recorded: request or response
// bodies, interactionId, interactiontoken, tokens, nonce, form values, cookies.
// The body is read from a clone after the response is handed back, so the
// widget's own read is untouched and never delayed.

const WATCHED = [/\/davinci\//, /\/as\//, /\/api\/davinci-login\//];

const pick = (data) => ({
  capabilityName: typeof data?.capabilityName === "string" ? data.capabilityName : null,
  connectorId: typeof data?.connectorId === "string" ? data.connectorId : null,
  success: data?.success === true ? true : null,
});

/**
 * Wrap target.fetch until the returned function is called.
 * @param {(call: object) => void} onCall
 * @param {Window} [target]
 * @returns {() => void} uninstall
 */
export function installWidgetTrace(onCall, target = window) {
  const original = target.fetch;

  target.fetch = async function tracedFetch(input, init) {
    const response = await original.call(this, input, init);
    let url = null;
    try {
      url = new URL(String(input?.url ?? input), target.location?.origin);
    } catch {
      return response;
    }
    if (!WATCHED.some((re) => re.test(url.pathname))) return response;

    const record = {
      method: String(init?.method || input?.method || "GET").toUpperCase(),
      host: url.host,
      path: url.pathname,
      status: response.status,
      ...pick(null),
    };
    const type = response.headers?.get?.("content-type") || "";
    if (type.includes("json")) {
      response
        .clone()
        .json()
        .then((data) => onCall({ ...record, ...pick(data) }), () => onCall(record));
    } else {
      onCall(record);
    }
    return response;
  };

  return () => {
    target.fetch = original;
  };
}

/** What the Call Inspector's summary and the run summary report. */
export function summarizeWidgetTrace(calls = []) {
  const list = (calls || []).filter(Boolean);
  const flow = list.filter((c) => c.path.includes("/davinci/"));
  const final = [...flow].reverse().find((c) => c.capabilityName) || null;
  return {
    calls: list,
    started: flow.some((c) => /\/davinci\/policy\/[^/]+\/start$/.test(c.path)),
    capabilityPosts: flow.filter((c) => c.path.includes("/capabilities/")).length,
    finalCapability: final?.capabilityName || null,
    tokensReturned: flow.some((c) => c.capabilityName === "returnSuccessResponseWidget" && c.success === true),
    session: list.find((c) => c.path.endsWith("/api/davinci-login/widget-session")) || null,
    authorizeCalls: list.filter((c) => c.path.endsWith("/as/authorize")).length,
  };
}
