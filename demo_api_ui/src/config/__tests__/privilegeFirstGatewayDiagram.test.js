import { describe, it, expect } from "vitest";
import { GROUPS, GATEWAY_NODES, GATEWAY_EDGES, GATEWAY_STEPS, FORK_NODES, FORK_EDGES, FORK_STEPS } from "../privilegeFirstGatewayDiagram";

const figures = [
  ["gateway", GATEWAY_NODES, GATEWAY_EDGES, GATEWAY_STEPS],
  ["fork", FORK_NODES, FORK_EDGES, FORK_STEPS],
];

describe.each(figures)("privilege-first-gateway %s figure", (_name, NODES, EDGES, STEPS) => {
  it("every edge is covered by exactly one step with a request form and standards", () => {
    const covered = STEPS.flatMap((s) => s.edges).sort((a, b) => a - b);
    expect(covered).toEqual(EDGES.map((_, i) => i));
    STEPS.forEach((s) => {
      expect(s.detail.form).toBeTruthy();
      expect(s.detail.refs.length).toBeGreaterThan(0);
      s.detail.refs.forEach((r) => expect(["rfc", "spec", "emerging"]).toContain(r.kind));
    });
  });

  it("edges reference real nodes and nodes use declared groups", () => {
    const ids = new Set(NODES.map((n) => n.id));
    EDGES.forEach(([a, b]) => {
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
    });
    NODES.forEach((n) => expect(GROUPS[n.group]).toBeTruthy());
  });

  it("tokens are decoded MOCK claims and carry no real secrets", () => {
    const text = JSON.stringify(STEPS);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8}|eyJ[A-Za-z0-9]{10}/);
    STEPS.forEach((s) => (s.detail.tokens || []).forEach((t) => expect(typeof t.claims).toBe("object")));
  });

  it("lists each standard once per step (the reel keys refs by id)", () => {
    STEPS.forEach((s) => {
      const ids = s.detail.refs.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it("names Privilege and uses the wire formats the repo documents", () => {
    const text = JSON.stringify(STEPS.map((s) => [s.what, s.detail.form, s.detail.tokens]));
    expect(STEPS.every((s) => s.detail.refs.length > 0)).toBe(true);
    // PingOne ignores audience= on exchange (needs resource=); the PingOne branch sends no actor_token; key prefixes are unverified
    expect(text).not.toMatch(/audience=|actor_token|\bvk_|\bak_/);
    // the bridge bearer is a shared secret, never shown as a decoded token
    expect(text).not.toMatch(/privilege-bridge"|Bridge token/);
  });
});

it("Privilege and PingOne Authorize appear in the standards", () => {
  const ids = [...GATEWAY_STEPS, ...FORK_STEPS].flatMap((s) => s.detail.refs.map((r) => r.id));
  expect(ids).toContain("PingOne Agent Privilege");
  expect(ids).toContain("PingOne Authorize");
});
