// Operator-chain projection — RED first.
import { buildOperatorChainSteps } from "../operatorChainSteps";
import { tokenChainTraceStore } from "../tokenChainTraceStore";

beforeEach(() => tokenChainTraceStore.reset());

const WRITE_CHAIN = [
  { id: "operator-session", label: "Operator session", status: "done", vertical: "workforce", claims: { operator: "op-1", role: "admin" } },
  { id: "operator-verification", label: "Customer identity verified", status: "done", vertical: "workforce", claims: { customerId: "u1" }, verifiedUntil: "2026-10-11T05:00:00.000Z" },
  { id: "operator-write", label: "Store write — 204", status: "done", vertical: "workforce", claims: { row: "204", beforeStatus: "Pending", afterStatus: "Approved" }, request: { method: "POST", url: "/api/admin/workforce/expenses/204/approve" }, result: { id: "204", status: "Approved" } },
  { id: "operator-audit", label: "Audit recorded", status: "done", vertical: "workforce", claims: { operator: "op-1", action: "POST /api/admin/workforce/expenses/204/approve" } },
];

test("buildOperatorChainSteps turns operator events into rail steps", () => {
  const steps = buildOperatorChainSteps(WRITE_CHAIN);
  expect(steps.map((s) => s.id)).toEqual([
    "operator-session", "operator-verification", "operator-write", "operator-audit",
  ]);
  expect(steps.every((s) => s.status === "done")).toBe(true);
  expect(steps[2].detail.request.text).toContain("/approve");
  expect(steps[2].detail.kv).toEqual(
    expect.arrayContaining([["row", "204"], ["before", "Pending"], ["after", "Approved"]]),
  );
});

test("an error event (verification refusal) keeps its error status", () => {
  const steps = buildOperatorChainSteps([
    WRITE_CHAIN[0],
    { id: "operator-verification", label: "Customer identity NOT verified", status: "error", claims: { customerId: "u1" } },
  ]);
  expect(steps[1].status).toBe("error");
  expect(steps[1].title).toMatch(/not verified/i);
});

test("non-operator events produce no steps (banking pipelines untouched)", () => {
  expect(buildOperatorChainSteps([{ id: "user-token", claims: { sub: "u" } }])).toEqual([]);
  expect(buildOperatorChainSteps([])).toEqual([]);
  expect(buildOperatorChainSteps(undefined)).toEqual([]);
});

test("an agent run's seeded exchange placeholder does not claim the trace (regression: rail collapsed to 1 step)", () => {
  // The AG-UI session preview seeds an id-'exchange' waiting placeholder on
  // EVERY dashboard agent run (agentMcpTokenService.buildSessionPreviewTokenEvents).
  // Without an operator- gate here that placeholder alone triggered this
  // projection and buildTraceSteps early-returned it, collapsing the whole
  // banking pipeline to one "BFF Exchange / waiting" node (live 2026-10-11).
  const AGENT_RUN_SEED = [
    { id: "intent-token", label: "Intent Token", status: "active", claims: {} },
    { id: "user-token", label: "User access token", status: "active", claims: { sub: "u" } },
    { id: "exchange", label: "Token exchange (RFC 8693)", status: "waiting", claims: null },
    { id: "exchanged-token", label: "MCP access token (delegated)", status: "waiting", claims: null },
  ];
  expect(buildOperatorChainSteps(AGENT_RUN_SEED)).toEqual([]);
});

test("the store renders operator steps once ingested", () => {
  tokenChainTraceStore.beginTrace({ prompt: "Approve expense 204" });
  tokenChainTraceStore.ingestTokenEvents(WRITE_CHAIN);
  tokenChainTraceStore.completeTrace(true);
  const { steps } = tokenChainTraceStore.getState();
  expect(steps.map((s) => s.id)).toContain("operator-write");
});

test("ceremony hops in a mixed chain render with their lanes", () => {
  // The real write chain interleaves the delegation ceremony (PingOne sign-on,
  // token issue, RFC 8693 exchange) with the operator hops. Every hop of ALL
  // FOUR ids must survive the filter, or the rail tells a partial story.
  const MIXED_CHAIN = [
    { id: "operator-session", label: "Operator session", status: "done", vertical: "workforce" },
    { id: "customer-signon", label: "Customer sign-on (pi.flow)", status: "done", vertical: "workforce" },
    { id: "customer-token-issued", label: "Customer token issued", status: "done", vertical: "workforce" },
    { id: "exchange", label: "RFC 8693 exchange", status: "done", vertical: "workforce", request: { audience: "enduser.ping.demo", scope: "write", hasActor: true, actorClientId: "admin-cid" } },
    { id: "operator-write", label: "Store write — 204", status: "done", vertical: "workforce" },
  ];
  const steps = buildOperatorChainSteps(MIXED_CHAIN);
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  expect(steps.map((s) => s.id)).toEqual([
    "operator-session", "customer-signon", "customer-token-issued", "exchange", "operator-write",
  ]);
  expect(byId["customer-signon"].lane).toBe("PINGONE");
  expect(byId["customer-token-issued"].lane).toBe("PINGONE");
  expect(byId["exchange"].lane).toBe("BFF");
  expect(byId["operator-write"].lane).toBe("API");
  // The exchange's request has no method/url — it must render its real fields,
  // never "undefined undefined".
  expect(byId["exchange"].detail.request.text).toContain("token-exchange");
  expect(byId["exchange"].detail.request.text).toContain("enduser.ping.demo");
  expect(byId["exchange"].detail.request.text).not.toContain("undefined");
});

test("buildOperatorChainSteps drops events from a different vertical", () => {
  const steps = buildOperatorChainSteps(WRITE_CHAIN, "healthcare");
  expect(steps).toEqual([]);
  const own = buildOperatorChainSteps(WRITE_CHAIN, "workforce");
  expect(own.map((s) => s.id)).toContain("operator-write");
  // No vertical asked → no filtering (other callers are vertical-agnostic).
  expect(buildOperatorChainSteps(WRITE_CHAIN).length).toBe(4);
});
