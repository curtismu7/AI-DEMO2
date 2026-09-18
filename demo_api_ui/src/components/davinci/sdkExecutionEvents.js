const MASK = "…";

const maskedValue = (value) => (value === "" ? "" : MASK);

function maskedFormData(formData) {
  if (!formData || typeof formData !== "object" || Array.isArray(formData)) return null;
  return Object.fromEntries(Object.keys(formData).map((key) => [key, maskedValue(formData[key])]));
}

function maskedStepBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const parameters = body.parameters && typeof body.parameters === "object" ? body.parameters : {};
  const data = parameters.data && typeof parameters.data === "object" ? parameters.data : {};
  const formData = maskedFormData(data.formData);
  return {
    ...(body.id ? { id: MASK } : {}),
    ...(body.eventName ? { eventName: String(body.eventName) } : {}),
    ...(body.interactionId ? { interactionId: MASK } : {}),
    parameters: {
      ...(parameters.eventType ? { eventType: String(parameters.eventType) } : {}),
      data: {
        ...(data.actionKey ? { actionKey: String(data.actionKey) } : {}),
        ...(formData ? { formData } : {}),
      },
    },
  };
}

function parseBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body;
}

function maskedCollectors(collectors) {
  if (!Array.isArray(collectors)) return null;
  return collectors.map((collector) => ({
    ...(collector?.type ? { type: String(collector.type) } : {}),
    ...(collector?.category ? { category: String(collector.category) } : {}),
  }));
}

/** Returns only the allowlisted fields that are safe to display in the execution reel. */
export function maskExecutionDetail(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
  const formData = maskedFormData(detail.formData);
  const body = maskedStepBody(parseBody(detail.body));
  const collectors = maskedCollectors(detail.collectors);
  return {
    ...(detail.method ? { method: String(detail.method).toUpperCase() } : {}),
    ...(detail.host ? { host: String(detail.host) } : {}),
    ...(detail.path ? { path: String(detail.path) } : {}),
    ...(Array.isArray(detail.paramNames) ? { paramNames: detail.paramNames.map(String) } : {}),
    ...(detail.responseMode ? { responseMode: String(detail.responseMode) } : {}),
    ...(detail.eventType ? { eventType: String(detail.eventType) } : {}),
    ...(detail.actionKey ? { actionKey: String(detail.actionKey) } : {}),
    ...(detail.status ? { status: String(detail.status) } : {}),
    ...(detail.type ? { type: String(detail.type) } : {}),
    ...(detail.category ? { category: String(detail.category) } : {}),
    ...(formData ? { formData } : {}),
    ...(body ? { body } : {}),
    ...(collectors ? { collectors } : {}),
    ...(Object.hasOwn(detail, "nonce") ? { nonce: maskedValue(detail.nonce) } : {}),
    ...(Object.hasOwn(detail, "state") ? { state: maskedValue(detail.state) } : {}),
    ...(Object.hasOwn(detail, "pkce") ? { pkce: maskedValue(detail.pkce) } : {}),
    ...(Object.hasOwn(detail, "interactionId") ? { interactionId: maskedValue(detail.interactionId) } : {}),
    ...(Object.hasOwn(detail, "authorizationCode") ? { authorizationCode: maskedValue(detail.authorizationCode) } : {}),
  };
}

/** Creates a display-safe event; callers provide sequence and identity when they append it. */
export function createOperationEvent({ id = null, sequence = null, at = Date.now(), lane, kind, label, codeKey = null, detail = {} }) {
  return {
    id: id ?? `execution-${sequence ?? "pending"}`,
    sequence,
    at,
    lane,
    kind,
    label,
    codeKey,
    detail: maskExecutionDetail(detail),
  };
}

/** Reduces only the existing safe HTTP/state trace shapes into execution-reel events. */
export function normalizeTraceEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  if (entry.source === "http") {
    let url;
    try {
      url = new URL(entry.url);
    } catch {
      return null;
    }
    return createOperationEvent({
      id: entry.id,
      sequence: entry.sequence,
      at: entry.at,
      lane: "davinci",
      kind: "request",
      label: "DaVinci request",
      codeKey: null,
      detail: {
        method: entry.method || "GET",
        host: url.host,
        path: url.pathname,
        paramNames: [...url.searchParams.keys()],
        responseMode: url.searchParams.get("response_mode") || undefined,
        body: entry.body,
      },
    });
  }

  if (entry.source === "state") {
    return createOperationEvent({
      id: entry.id,
      sequence: entry.sequence,
      at: entry.at,
      lane: "collector",
      kind: "collectors",
      label: "SDK collector state",
      codeKey: null,
      detail: { status: entry.status, collectors: entry.collectors },
    });
  }

  return null;
}

export const PREVIEW_EVENTS = [
  createOperationEvent({
    id: "preview-1",
    sequence: 1,
    at: 1,
    lane: "sdk",
    kind: "operation.begin",
    label: "SDK starts the flow",
    codeKey: "start",
    detail: { eventType: "start" },
  }),
  createOperationEvent({
    id: "preview-2",
    sequence: 2,
    at: 2,
    lane: "davinci",
    kind: "request",
    label: "DaVinci authorize request",
    codeKey: "start",
    detail: { method: "GET", host: "auth.example", path: "/as/authorize", paramNames: ["response_mode", "nonce", "state"], responseMode: "pi.flow" },
  }),
  createOperationEvent({
    id: "preview-3",
    sequence: 3,
    at: 3,
    lane: "collector",
    kind: "collectors",
    label: "DaVinci returns sign-on collectors",
    codeKey: "start",
    detail: { status: "continue", collectors: [{ type: "TextCollector", category: "INPUT" }, { type: "PasswordCollector", category: "INPUT" }] },
  }),
  createOperationEvent({
    id: "preview-4",
    sequence: 4,
    at: 4,
    lane: "sdk",
    kind: "terminal",
    label: "SDK completes the callback",
    codeKey: "update-next",
    detail: { status: "success" },
  }),
];
