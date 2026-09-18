import { describe, expect, it } from "vitest";
import { PREVIEW_EVENTS, maskExecutionDetail, normalizeTraceEntry } from "../sdkExecutionEvents";

describe("normalizeTraceEntry", () => {
  it("converts an HTTP trace into a masked DaVinci request event", () => {
    const event = normalizeTraceEntry({
      at: 10,
      source: "http",
      method: "POST",
      url: "https://auth.example/as/authorize?nonce=secret&response_mode=pi.flow&state=state-secret",
      body: JSON.stringify({
        parameters: { data: { formData: { email: "customer@example.test", password: "secret" } } },
      }),
    });

    expect(event).toMatchObject({
      at: 10,
      lane: "davinci",
      kind: "request",
      detail: {
        method: "POST",
        host: "auth.example",
        path: "/as/authorize",
        paramNames: ["nonce", "response_mode", "state"],
        responseMode: "pi.flow",
        body: { parameters: { data: { formData: { email: "…", password: "…" } } } },
      },
    });
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(JSON.stringify(event)).not.toContain("customer@example.test");
  });

  it("converts state traces into collector events with safe collector metadata", () => {
    expect(
      normalizeTraceEntry({
        at: 20,
        source: "state",
        status: "continue",
        collectors: [{ type: "PasswordCollector", category: "INPUT", name: "password", key: "password" }],
      }),
    ).toMatchObject({
      at: 20,
      lane: "collector",
      kind: "collectors",
      detail: { status: "continue", collectors: [{ type: "PasswordCollector", category: "INPUT" }] },
    });
  });

  it("drops unsupported logger entries instead of displaying arbitrary logger arguments", () => {
    expect(normalizeTraceEntry({ source: "logger", parts: ["authorization_code=secret"] })).toBeNull();
  });
});

describe("maskExecutionDetail", () => {
  it("masks form values and authorization-sensitive values while retaining safe shape", () => {
    expect(
      maskExecutionDetail({
        formData: { email: "customer@example.test", password: "secret" },
        nonce: "nonce-secret",
        state: "state-secret",
        pkce: "verifier-secret",
        interactionId: "interaction-secret",
        authorizationCode: "code-secret",
      }),
    ).toEqual({
      formData: { email: "…", password: "…" },
      nonce: "…",
      state: "…",
      pkce: "…",
      interactionId: "…",
      authorizationCode: "…",
    });
  });
});

describe("PREVIEW_EVENTS", () => {
  it("provides stable, display-safe milestones for the movie, debugger, and storyboard concepts", () => {
    expect(PREVIEW_EVENTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "preview-1", sequence: 1, lane: "sdk", kind: "operation.begin" }),
        expect.objectContaining({ lane: "davinci", kind: "request" }),
        expect.objectContaining({ lane: "collector", kind: "collectors" }),
        expect.objectContaining({ lane: "sdk", kind: "terminal" }),
      ]),
    );
    expect(JSON.stringify(PREVIEW_EVENTS)).not.toMatch(/secret|password=|authorization_code=/i);
  });
});
