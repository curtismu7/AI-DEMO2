import { describe, expect, it } from "vitest";
import {
  DEMO_ARCH_SLIDES,
  liveStepCiba,
  liveStepControlPlane,
  liveStepIdJag,
  liveStepTopology,
} from "../DemoArchSlidesPage";

// Live mode maps a trimmed BFF app event { category, tag, severity } to a
// slide step. Tag prefix wins over category, and an event no step explains
// returns null so it only shows in the log. A mapped step must exist on its slide.
const ev = (category, tag, severity = "info") => ({ category, tag, severity });

describe("Demo arch slides live-step mappers", () => {
  it("topology: tag prefix beats category", () => {
    // 'OAuth token received' is logged under token_exchange with an oauth/ tag → sign-in step, not exchange
    expect(liveStepTopology(ev("token_exchange", "oauth/user/callback"))).toBe(2);
    expect(liveStepTopology(ev("token_exchange", "token_exchange/rfc8693-success"))).toBe(4);
    expect(liveStepTopology(ev("agent", "agent/message"))).toBe(3);
    expect(liveStepTopology(ev("agent", "agent/complete"))).toBe(8);
    expect(liveStepTopology(ev("mcp", "mcp/tool"))).toBe(6);
    expect(liveStepTopology(ev("authorize", "authorize/permit"))).toBe(7);
    expect(liveStepTopology(ev("hitl", "hitl/consent-required"))).toBe(9);
    expect(liveStepTopology(ev("config", "config/env-reconcile"))).toBeNull();
  });

  it("ciba: approval and refusal land on their own steps", () => {
    expect(liveStepCiba(ev("hitl", "ciba/initiate"))).toBe(4);
    expect(liveStepCiba(ev("hitl", "ciba/tokens-received"))).toBe(6);
    expect(liveStepCiba(ev("hitl", "hitl/consent-verified"))).toBe(7);
    expect(liveStepCiba(ev("authorize", "authorize/permit"))).toBe(8);
    expect(liveStepCiba(ev("authorize", "authorize/simulated-result", "warning"))).toBe(2);
  });

  it("id-jag and control plane map their key hops", () => {
    expect(liveStepIdJag(ev("enterprise_mcp", "enterprise_mcp/token_issued"))).toBe(4);
    expect(liveStepIdJag(ev("mcp", "mcp/tool"))).toBe(3);
    expect(liveStepControlPlane(ev("agent", "agent/invoke"))).toBe(7);
    expect(liveStepControlPlane(ev("mcp", "mcp/result"))).toBe(8);
  });

  it("every mapper only returns steps its slide defines", () => {
    const probes = [
      "oauth/user/login", "oauth/user/callback", "token_exchange/rfc8693-success", "agent/message",
      "agent/invoke", "agent/complete", "mcp/tool", "mcp/result", "authorize/permit", "introspection/middleware-validated",
      "hitl/consent-required", "ciba/initiate", "ciba/tokens-received", "enterprise_mcp/token_issued", "config/env-reconcile",
    ].map((tag) => ev(tag.split("/")[0], tag));
    const outOfRange = [];
    for (const slide of DEMO_ARCH_SLIDES) {
      const total = slide.meta.steps.length;
      for (const probe of probes) {
        const step = slide.live(probe);
        if (step !== null && (step < 1 || step > total)) outOfRange.push(`${slide.id}:${probe.tag}→${step}`);
      }
    }
    expect(outOfRange).toEqual([]);
  });
});
