import { createRequire } from "node:module";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LlmGatewayPage from "../LlmGatewayPage";
import { GUARDRAIL_ATTACKS } from "../../config/guardrailAttackCatalog";

const require = createRequire(import.meta.url);
const { validateFeatureFamilyEvidence } = require("../../../../demo_api_server/services/demoReadinessExecutionService");
const readinessFeatures = require("../../../../demo_api_server/config/demoReadinessFeatureChecks.json");
const originalFetch = global.fetch;

const CONFIG = {
  gatewayUrl: "https://gateway.example.test",
  lanes: [
    { provider: "anthropic", route: "/llm/anthropic/v1/messages", model: "claude-haiku", keyConfigured: true },
  ],
};

describe("UC-LEARN11 readiness evidence from the real LLM Gateway route", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("accepts only the route-selected source payload and a Privilege denial before provider reach", async () => {
    const attack = GUARDRAIL_ATTACKS.find((item) => item.id === "prompt_injection");
    const denial = {
      error: "blocked",
      code: "llm_policy_denied",
      reason: "request blocked by security policy: prompt_injection",
      provider: "anthropic",
      route: "/llm/anthropic/v1/messages",
      latencyMs: 12,
      reachedProvider: false,
    };
    let submitted;
    global.fetch = vi.fn((url, options = {}) => {
      const path = String(url);
      if (path.endsWith("/llm/config")) {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(CONFIG) });
      }
      if (path.endsWith("/llm/keys")) {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ keys: [] }) });
      }
      if (path.includes("/llm/models?")) {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ models: [] }) });
      }
      if (path.endsWith("/llm/call")) {
        submitted = JSON.parse(options.body);
        return Promise.resolve({ ok: false, status: 403, text: async () => JSON.stringify(denial) });
      }
      return new Promise(() => {});
    });

    window.history.replaceState({}, "", "/llm-gateway?attack=prompt_injection");
    render(<LlmGatewayPage />);

    const attackSelect = await screen.findByLabelText(/attack library/i);
    const promptBox = screen.getByLabelText(/^prompt$/i);
    expect(attackSelect).toHaveValue(attack.id);
    expect(promptBox).toHaveValue(attack.payload);

    const route = window.location.pathname + window.location.search;
    const selectedAttack = attackSelect.value;
    const prefilledPayload = promptBox.value;
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => expect(submitted).toEqual({ provider: "anthropic", prompt: attack.payload }));

    const evidence = {
      feature: {
        family: "prompt-injection",
        route,
        selectedAttack,
        prefilledPayload,
        submission: {
          code: denial.code,
          denied: denial.code === "llm_policy_denied" && denial.reachedProvider === false,
          reachedProvider: denial.reachedProvider,
        },
      },
    };
    const contract = readinessFeatures.contracts["UC-LEARN11-PROMPT-INJECTION"];
    const positiveFailures = [];
    validateFeatureFamilyEvidence(positiveFailures, evidence, contract, "pingone");
    expect(positiveFailures).toEqual([]);

    const mutations = [
      ["wrong route", (feature) => { feature.route = "/dashboard?attack=prompt_injection"; }, /route/],
      ["wrong selected attack", (feature) => { feature.selectedAttack = "jailbreak"; }, /select/],
      ["wrong payload", (feature) => { feature.prefilledPayload += " edited"; }, /prefill/],
      ["provider reached", (feature) => { feature.submission.reachedProvider = true; }, /reachability/],
    ];
    for (const [, mutate, expectedFailure] of mutations) {
      const changed = structuredClone(evidence);
      mutate(changed.feature);
      const failures = [];
      validateFeatureFamilyEvidence(failures, changed, contract, "pingone");
      expect(failures).toEqual(expect.arrayContaining([expect.stringMatching(expectedFailure)]));
    }
  });
});
