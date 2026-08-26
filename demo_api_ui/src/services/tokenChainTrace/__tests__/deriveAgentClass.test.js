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

// The badge must stay silent rather than guess: on an identity demo a wrong
// class reads as a broken delegation chain.
test("returns null when there is no agent token to classify", () => {
  expect(deriveAgentClass([{ id: "user-token", claims: { sub: "demoUser" } }])).toBeNull();
  expect(deriveAgentClass([])).toBeNull();
  expect(deriveAgentClass(undefined)).toBeNull();
});
