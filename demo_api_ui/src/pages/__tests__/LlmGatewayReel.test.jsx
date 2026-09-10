import { render, screen, fireEvent } from "@testing-library/react";
import LlmGatewayReel, { buildReelSteps } from "../LlmGatewayReel";

// The reel's substance is which hops it draws and which it marks as never
// reached. A denial that drew the provider as "failed" would blame the model for
// something Privilege did, so that distinction is asserted directly.

const answered = {
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  route: "/llm/anthropic/v1/messages",
  verdict: "Answered",
  tone: "ok",
  layer: null,
  redactions: 0,
  reachedProvider: true,
  latencyMs: 812,
};

const denied = {
  provider: "openai",
  model: "gpt-4o-mini",
  route: "/llm/openai/v1/chat/completions",
  verdict: "Denied by policy",
  tone: "warn",
  layer: "Privilege",
  reason: "request blocked by security policy: prompt_injection",
  reachedProvider: false,
  latencyMs: 145,
};

describe("buildReelSteps", () => {
  it("draws you, Privilege and the provider for a gateway lane", () => {
    const ids = buildReelSteps(answered, { providerTitle: "Anthropic" }).map((s) => s.id);
    expect(ids).toEqual(["you", "privilege", "provider"]);
  });

  it("omits Privilege for a local lane — no gate ran, so none is drawn", () => {
    const ids = buildReelSteps(answered, { providerTitle: "llama.cpp", isLocalLane: true }).map((s) => s.id);
    expect(ids).toEqual(["you", "provider"]);
  });

  it("a denial stops the reel: Privilege denied, provider UNREACHED not failed", () => {
    const steps = buildReelSteps(denied, { providerTitle: "OpenAI" });
    expect(steps.find((s) => s.id === "privilege").state).toBe("denied");
    const provider = steps.find((s) => s.id === "provider");
    expect(provider.state).toBe("unreached");
    expect(provider.summary).toMatch(/never saw the prompt/i);
  });

  it("a redaction is policy ACTING, not the call failing", () => {
    const steps = buildReelSteps({ ...answered, redactions: 2 }, { providerTitle: "Anthropic" });
    expect(steps.find((s) => s.id === "privilege").state).toBe("acted");
  });

  it("labels the provider's rate limits as the PROVIDER's, never the virtual key's", () => {
    const steps = buildReelSteps(
      { ...answered, providerLimits: { requestsRemaining: "42" } },
      { providerTitle: "Anthropic" },
    );
    const row = steps.find((s) => s.id === "provider").detail.find(([k]) => /rate limit/i.test(k));
    expect(row[0]).toMatch(/provider/i);
  });

  it("without a decision it returns the RESTING reel, not nothing", () => {
    // The page opens showing the shape of the call it is about to make. Same
    // boxes, same order, all idle — so the first real answer changes their
    // state rather than making the reel appear from nothing.
    const steps = buildReelSteps(null, { providerTitle: "Anthropic", pending: { provider: "anthropic" } });
    expect(steps.map((s) => s.id)).toEqual(["you", "privilege", "provider"]);
    expect(steps.every((s) => s.state === "idle")).toBe(true);
    expect(steps[0].detail).toContainEqual(["Lane selected", "anthropic"]);
  });

  it("the resting reel drops Privilege for a local lane too", () => {
    const steps = buildReelSteps(null, { providerTitle: "llama.cpp", isLocalLane: true });
    expect(steps.map((s) => s.id)).toEqual(["you", "provider"]);
  });
});

describe("LlmGatewayReel", () => {
  it("at rest it opens on You — the only box with anything to say yet", () => {
    render(<LlmGatewayReel decision={null} providerTitle="Anthropic" pending={{ provider: "anthropic" }} />);
    expect(screen.getByText("Lane selected")).toBeInTheDocument();
  });

  it("opens on the hop that decided the outcome, so a denial explains itself unclicked", () => {
    render(<LlmGatewayReel decision={denied} providerTitle="OpenAI" />);
    expect(screen.getByText(/prompt_injection/)).toBeInTheDocument();
  });

  it("clicking a box shows that hop's detail", () => {
    render(<LlmGatewayReel decision={answered} providerTitle="Anthropic" />);
    fireEvent.click(screen.getByRole("button", { name: /You/ }));
    expect(screen.getByText("Lane requested")).toBeInTheDocument();
    expect(screen.getByText("anthropic")).toBeInTheDocument();
  });

  it("the open box is reported as expanded for assistive tech", () => {
    render(<LlmGatewayReel decision={answered} providerTitle="Anthropic" />);
    const you = screen.getByRole("button", { name: /You/ });
    fireEvent.click(you);
    expect(you).toHaveAttribute("aria-expanded", "true");
  });
});
