import { describe, it, expect } from "vitest";
import { extractDenyDetail, RATE_LIMIT_DEFAULTS } from "../denyDetail";
import { buildTraceSteps } from "../buildTraceSteps";

const rows = (d) => Object.fromEntries(d.rows);

describe("extractDenyDetail", () => {
  it("returns null for a step that did not fail", () => {
    expect(extractDenyDetail({ id: "gateway", status: "done", detail: {} }, {})).toBeNull();
  });

  it("pulls reason, code, status, statements and scopes from a gateway deny", () => {
    const trace = {
      tokenEvents: [{
        id: "sim-gateway-deny", error: "insufficient_scope", httpStatus: 403,
        reason: "token is missing a scope the tool requires",
        presentedScopes: ["read"], requiredScopes: ["write"],
        authorizeStatements: [{ code: "rule", payload: "HasWrite" }],
      }],
    };
    const d = extractDenyDetail({ id: "gateway", status: "error", detail: {} }, trace);
    const r = rows(d);
    expect(r["error code"]).toBe("insufficient_scope");
    expect(r["http status"]).toBe("403");
    expect(r.reason).toMatch(/missing a scope/);
    expect(r.scope).toBe("required write · presented read");
    expect(r.statements).toBe("rule: HasWrite");
    expect(d.rateLimit).toBeNull();
  });

  it("reads the reason out of a P1AZ response body on the authorize step", () => {
    const step = {
      id: "authorize", baseId: "authorize", status: "error",
      detail: { response: { text: JSON.stringify({ reason: "amount > 100", statements: [{ code: "policy", payload: "TransferCap" }] }) } },
    };
    const r = rows(extractDenyDetail(step, { authorize: { outcome: "DENY" } }));
    expect(r.reason).toBe("amount > 100");
    expect(r.statements).toBe("policy: TransferCap");
  });

  it("explains a rate-limit deny with its configured limit, observed count and reset", () => {
    const trace = {
      tokenEvents: [{
        id: "sim-burst-4", error: "rate_limited", httpStatus: 429, retryAfterMs: 7200,
        maxRequests: 3, windowMs: 10000, observedCalls: 3, rateLimitLayer: "gateway",
      }],
    };
    const d = extractDenyDetail({ id: "gateway", status: "error", detail: {} }, trace);
    const rl = Object.fromEntries(d.rateLimit);
    expect(rl["what it means"]).toMatch(/sliding window/);
    expect(rl.limit).toBe("3 calls per 10 s per (agent, tool)");
    expect(rl.observed).toBe("3 calls in the window (limit 3)");
    expect(rl.resets).toMatch(/about 8 s/);
  });

  it("falls back to the documented gateway default when the 429 reports no limit", () => {
    const trace = { tokenEvents: [{ id: "sim-gateway-deny", error: "rate_limited", httpStatus: 429 }] };
    const d = extractDenyDetail({ id: "gateway", status: "error", detail: {} }, trace);
    expect(Object.fromEntries(d.rateLimit).limit).toContain(
      `${RATE_LIMIT_DEFAULTS.maxRequests} calls per ${RATE_LIMIT_DEFAULTS.windowMs / 1000} s`,
    );
  });
});

describe("buildTraceSteps attaches denyDetail to the failing gateway hop", () => {
  it("shows the rate-limited burst call as the gateway deny", () => {
    const steps = buildTraceSteps({
      prompt: null, routingMode: null, phases: [], authorizeEvaluations: [],
      tokenEvents: [{ id: "sim-burst-4", error: "rate_limited", httpStatus: 429, retryAfterMs: 1000, label: "Burst call 4 RATE LIMITED (429)" }],
      outcome: "error",
    });
    const gw = steps.find((s) => s.id === "gateway");
    expect(gw.status).toBe("error");
    expect(gw.detail.denyDetail.rateLimit).toBeTruthy();
  });
});
