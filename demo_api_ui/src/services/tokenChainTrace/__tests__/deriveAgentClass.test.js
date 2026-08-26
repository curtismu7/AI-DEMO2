import { deriveAgentClass } from "../deriveAgentClass";

test("a chain with a user token is a worker run", () => {
  expect(deriveAgentClass([
    { id: "user-token", claims: { sub: "demoUser" } },
    { id: "agent-actor-token", claims: { sub: "agent" } },
  ])).toBe("worker");
});

test("an act claim alone proves delegation, with no user-token event", () => {
  expect(deriveAgentClass([
    { id: "two-ex-agent-actor", claims: { sub: "agent" } },
    { id: "two-ex-final-token", claims: { sub: "demoUser", act: { sub: "agent" } } },
  ])).toBe("worker");
});

test("an agent token with no user and no act is an autonomous run", () => {
  expect(deriveAgentClass([
    { id: "agent-actor-token", claims: { sub: "agent:balance-sweep" } },
  ])).toBe("autonomous");
});

// The exact event shape the BFF's unattendedRunContext.recordAgentToken()
// emits for a scheduled run. If the server's shape and this derivation ever
// drift, a real unattended run renders as a Worker — the one thing the badge
// exists to get right. Server side asserts the same shape in
// demo_api_server/src/__tests__/fraudWatchJob.test.js.
test("classifies the BFF's real unattended-run token events as autonomous", () => {
  expect(deriveAgentClass([
    {
      id: "agent-actor-token",
      label: "Agent Token (unattended)",
      claims: { sub: "agent:fraud-watch", aud: "banking.ping.demo", scope: "read", iss: null },
    },
  ])).toBe("autonomous");
});

// The badge must stay silent rather than guess: on an identity demo a wrong
// class reads as a broken delegation chain.
test("returns null when there is no agent token to classify", () => {
  expect(deriveAgentClass([{ id: "user-token", claims: { sub: "demoUser" } }])).toBeNull();
  expect(deriveAgentClass([])).toBeNull();
  expect(deriveAgentClass(undefined)).toBeNull();
});
