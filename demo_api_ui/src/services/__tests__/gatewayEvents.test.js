import { loadGatewayRecord, normalizeGuardrailEvent } from "../gatewayEvents";

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const searchResult = (sources) => json({
  result: { content: [{ type: "text", text: `Search results from gateway-events (JSON format):\n${JSON.stringify({ hits: { hits: sources.map((_source) => ({ _source })) } })}` }] },
});

const BLOCKED = {
  msg: "AIGuard",
  time: "2026-10-05T10:00:00Z",
  Event: "a2a_request_blocked",
  Category: "prompt_injection",
  Direction: "request",
  Client: "main-agent",
  VirtualKeyID: "sk-orion-...abcd",
  ComplianceMappings: [
    { Framework: "mitre_atlas", Identifier: "AML.T0051", Source: "inj-ignore-previous" },
    { Framework: "mitre_atlas", Identifier: "AML.T0056", Source: "exf-prompt-leak-marker" },
    { Framework: "owasp_asi", Identifier: "ASI01", Source: "inj-ignore-previous" },
  ],
};
const MODEL_CALL = { msg: "LLM request", time: "2026-10-05T10:00:01Z", Provider: "google", Model: "gemini-3.5-flash-lite", HTTPStatus: 200, PromptTokens: 100, CompletionTokens: 28, TotalTokens: 128, CostUSD: 0.0004995, LatencyMs: 1285, VirtualKeyID: "sk-orion-...abcd" };

test("a guardrail line keeps the verdict and its framework mappings, and drops the key", () => {
  const verdict = normalizeGuardrailEvent({ _source: BLOCKED });

  expect(verdict).toEqual({
    time: "2026-10-05T10:00:00Z",
    event: "a2a_request_blocked",
    category: "prompt_injection",
    direction: "request",
    client: "main-agent",
    rules: ["inj-ignore-previous", "exf-prompt-leak-marker"],
    frameworks: [
      { label: "MITRE ATLAS", identifiers: ["AML.T0051", "AML.T0056"] },
      { label: "OWASP Agentic (ASI)", identifiers: ["ASI01"] },
    ],
  });
  expect(JSON.stringify(verdict)).not.toContain("sk-orion");
});

test("the record for a run is the gateway's lines in its time window, split by kind", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(json({ tools: [{ name: "SearchIndexTool" }] }))
    .mockResolvedValueOnce(searchResult([BLOCKED, MODEL_CALL]));

  const record = await loadGatewayRecord({ since: Date.UTC(2026, 9, 5, 9, 59, 58), until: Date.UTC(2026, 9, 5, 10, 0, 5), fetchImpl });

  expect(record.state).toBe("ready");
  expect(record.guardrail.map((entry) => entry.event)).toEqual(["a2a_request_blocked"]);
  expect(record.modelCalls).toEqual([{ time: "2026-10-05T10:00:01Z", provider: "google", model: "gemini-3.5-flash-lite", status: 200, promptTokens: 100, completionTokens: 28, totalTokens: 128, costUsd: 0.0004995, latencyMs: 1285 }]);
  const sent = JSON.parse(fetchImpl.mock.calls[1][1].body);
  expect(sent.params.index).toBe("gateway-events");
  expect(sent.params.query_dsl.query.range.time).toEqual({ gte: "2026-10-05T09:59:58.000Z", lte: "2026-10-05T10:00:05.000Z" });
});

test("accepted A2A requests and policy refusals are read from the same window", async () => {
  const accepted = { msg: "Received HTTP request", time: "2026-10-05T10:00:02Z", Domain: { Elems: ["langchainagent.default.applications.procyon.ai"] }, Method: "POST", Path: "/a2a/jsonrpc", User: "03de8762", Device: "03de8762", Tenant: "0428ba4f" };
  const refused = { msg: "A2A policy denied", time: "2026-10-05T10:00:03Z", Principal: "b1645e7b", App: "restrictedagent", Reason: "principal does not have access" };
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(json({ tools: [{ name: "SearchIndexTool" }] }))
    .mockResolvedValueOnce(searchResult([accepted, refused]));

  const record = await loadGatewayRecord({ since: 0, until: 1, fetchImpl });

  expect(record.requests).toEqual([{ time: "2026-10-05T10:00:02Z", app: "langchainagent", method: "POST", path: "/a2a/jsonrpc", principal: "03de8762", tenant: "0428ba4f" }]);
  expect(record.denials).toEqual([{ time: "2026-10-05T10:00:03Z", app: "restrictedagent", principal: "b1645e7b", reason: "principal does not have access" }]);
});

test("a door that has not been signed in to is reported, not treated as empty", async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(json({ tools: [], privilege_login_required: true, loginUrl: "/login/door" }));

  expect(await loadGatewayRecord({ since: 0, until: 1, fetchImpl, signIn: null })).toEqual({ state: "needsAuth", loginUrl: "/login/door", guardrail: [], modelCalls: [], requests: [], denials: [] });
});

test("a failure to read the record never rejects", async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

  expect(await loadGatewayRecord({ since: 0, until: 1, fetchImpl })).toEqual({ state: "error", error: "network down", guardrail: [], modelCalls: [], requests: [], denials: [] });
});

test("a door that is not signed in is signed in silently and asked again", async () => {
  const signIn = vi.fn().mockResolvedValue();
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(json({ tools: [], privilege_login_required: true, loginUrl: "/login/door" }))
    .mockResolvedValueOnce(json({ tools: [{ name: "SearchIndexTool" }] }))
    .mockResolvedValueOnce(searchResult([BLOCKED]));

  const record = await loadGatewayRecord({ since: 0, until: 1, fetchImpl, signIn });

  expect(signIn).toHaveBeenCalledWith("/login/door");
  expect(record.state).toBe("ready");
  expect(record.guardrail).toHaveLength(1);
});

test("if the silent sign-in does not take, the door is reported once, not retried forever", async () => {
  const signIn = vi.fn().mockResolvedValue();
  const needsLogin = () => json({ tools: [], privilege_login_required: true, loginUrl: "/login/door" });
  const fetchImpl = vi.fn().mockResolvedValueOnce(needsLogin()).mockResolvedValueOnce(needsLogin());

  const record = await loadGatewayRecord({ since: 0, until: 1, fetchImpl, signIn });

  expect(signIn).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(record.state).toBe("needsAuth");
});
