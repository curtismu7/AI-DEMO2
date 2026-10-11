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

test("the store renders operator steps once ingested", () => {
  tokenChainTraceStore.beginTrace({ prompt: "Approve expense 204" });
  tokenChainTraceStore.ingestTokenEvents(WRITE_CHAIN);
  tokenChainTraceStore.completeTrace(true);
  const { steps } = tokenChainTraceStore.getState();
  expect(steps.map((s) => s.id)).toContain("operator-write");
});

test("buildOperatorChainSteps drops events from a different vertical", () => {
  const steps = buildOperatorChainSteps(WRITE_CHAIN, "healthcare");
  expect(steps).toEqual([]);
  const own = buildOperatorChainSteps(WRITE_CHAIN, "workforce");
  expect(own.map((s) => s.id)).toContain("operator-write");
  // No vertical asked → no filtering (other callers are vertical-agnostic).
  expect(buildOperatorChainSteps(WRITE_CHAIN).length).toBe(4);
});
