// The LLM Gateway console exists to separate two failures that look identical in a
// log: Privilege refused the prompt (it never reached a model), and the provider
// credential behind the virtual key was rejected (it did). Everything below pins
// that distinction, plus the honesty rule — no number is presented as a Privilege
// cap unless it is one.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import LlmGatewayPage from "../LlmGatewayPage";
import { MemoryRouter } from "react-router-dom";
import { GUARDRAIL_ATTACKS } from "../../config/guardrailAttackCatalog";

const CONFIG = {
  gatewayUrl: "https://mcpgw.ai-demo.ping-devops.com",
  lanes: [
    { provider: "anthropic", route: "/llm/anthropic/v1/messages", model: "claude-haiku-4-5-20251001", keyConfigured: true, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC" },
    { provider: "google", route: "/llm/google/v1/chat/completions", model: "gemini-2.0-flash", keyConfigured: true, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE" },
    { provider: "openai", route: "/llm/openai/v1/chat/completions", model: "gpt-4o-mini", keyConfigured: false, keyEnv: "PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI" },
  ],
};

const CONFIG_WITH_LOCALS = {
  ...CONFIG,
  locals: [
    { provider: "lmstudio", title: "LM Studio (local)", baseUrl: "http://host.docker.internal:1234", route: "/v1/chat/completions", defaultMaxTokens: 512 },
    { provider: "llamacpp", title: "llama.cpp (local)", baseUrl: "http://host.docker.internal:8090", route: "/v1/chat/completions", defaultMaxTokens: 256 },
  ],
};

function mockFetch(call, config = CONFIG) {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.endsWith("/llm/config")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(config) });
    }
    if (u.endsWith("/llm/call")) return Promise.resolve(call());
    return new Promise(() => {});
  });
}

async function ask(text = "hello") {
  fireEvent.change(await screen.findByLabelText(/^prompt$/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
}

describe("LLM Gateway console - attack runs and model picker", () => {
  // The attack-choice key is the one piece of state this page persists across
  // reloads (see 'lgw-attack-choice' in LlmGatewayPage.jsx). Left set by one
  // test, it silently seeds the prompt/selection in every test that runs
  // after it — previously invisible because the payload only ever sat in an
  // <input> value, which text queries can't see; the new prompt-reveal <pre>
  // renders that same text as real DOM content, exposing the leak.
  afterEach(() => { window.localStorage.clear(); });  describe("run all attacks", () => {
    const EXPECTED_LABEL = { blocks: "Blocked", sanitizes: "Redacted", none: "No verdict" };
    const DENIED = () => ({
      ok: false, status: 403,
      text: async () => JSON.stringify({
        error: "blocked", code: "llm_policy_denied", reason: "request blocked by security policy: prompt_injection",
        provider: "anthropic", route: "/llm/anthropic/v1/messages", latencyMs: 20, reachedProvider: false,
      }),
    });
    const OK = (reply) => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({
        reply, provider: "anthropic", route: "/llm/anthropic/v1/messages",
        latencyMs: 300, reachedProvider: true, providerLimits: null,
      }),
    });
    // What the gateway does to each attack, per the catalog's measured `effect`.
    const faithful = (payload) => {
      const effect = GUARDRAIL_ATTACKS.find((a) => a.payload === payload).effect;
      if (effect === "blocks") return DENIED();
      if (effect === "sanitizes") return OK("Jane Doe | [REDACTED:pii] | [REDACTED:pii]");
      return OK("I can't help with that.");
    };

    // Records every /llm/call body, and whether a call ever started while
    // another was still in flight.
    function mockRunAll({ guarded = faithful, unguarded = () => OK("Sure, here you go."), config = CONFIG_WITH_LOCALS } = {}) {
      const state = { calls: [], overlapped: false, inFlight: 0 };
      global.fetch = vi.fn((url, init) => {
        const u = String(url);
        if (u.endsWith("/llm/config")) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(config) });
        }
        if (u.endsWith("/llm/call")) {
          const body = JSON.parse(init.body);
          state.calls.push(body);
          if (state.inFlight > 0) state.overlapped = true;
          state.inFlight += 1;
          const res = body.provider === "llamacpp" ? unguarded(body.prompt) : guarded(body.prompt);
          return Promise.resolve({ ...res, text: async () => { state.inFlight -= 1; return res.text(); } });
        }
        return new Promise(() => {});
      });
      return state;
    }
    const runAll = () => fireEvent.click(screen.getByRole("button", { name: /run all chat attacks/i }));
    const whenDone = () => waitFor(() => expect(screen.getByTestId("lgw-scorecard")).toHaveAttribute("data-done", "true"));

    it("fires only chat attacks and links tool/A2A entries to their own runners", async () => {
      const state = mockRunAll();
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      runAll();
      await whenDone();

      const chatAttacks = GUARDRAIL_ATTACKS.filter((attack) => !attack.demoPath);
      expect(state.calls.map((c) => [c.provider, c.prompt])).toEqual(
        chatAttacks.flatMap((a) => [["anthropic", a.payload], ["llamacpp", a.payload]]),
      );
      for (const attack of GUARDRAIL_ATTACKS.filter((item) => item.demoPath)) {
        const row = screen.getByTestId(`lgw-score-${attack.id}`);
        expect(within(row).getByText("Separate demo")).toBeInTheDocument();
        expect(within(row).getAllByRole("link", { name: /open demo/i })).toHaveLength(2);
        expect(within(row).getAllByRole("link", { name: /open demo/i })[0]).toHaveAttribute("href", attack.demoPath);
      }
      expect(state.overlapped).toBe(false);
    });

    it("scores each row by what came back, with no flag when it matches the catalog", async () => {
      mockRunAll();
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      runAll();
      await whenDone();

      for (const a of GUARDRAIL_ATTACKS) {
        const row = screen.getByTestId(`lgw-score-${a.id}`);
        if (a.demoPath) {
          expect(within(row).getByText("Separate demo"), a.id).toBeInTheDocument();
          continue;
        }
        expect(within(row).getByTestId("lgw-score-guarded"), a.id).toHaveTextContent(
          a.effect === "unmeasured" ? "No verdict" : EXPECTED_LABEL[a.effect],
        );
        if (a.effect === "unmeasured") expect(within(row).getByText("Not measured")).toBeInTheDocument();
        expect(row, a.id).not.toHaveAttribute("data-mismatch", "true");
      }
    });

    it("flags a row that disagrees with the catalog, and still runs the rest", async () => {
      const injection = GUARDRAIL_ATTACKS.find((a) => a.id === "prompt_injection");
      mockRunAll({ guarded: (p) => (p === injection.payload ? OK("Sure.") : faithful(p)) });
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      runAll();
      await whenDone();

      const row = screen.getByTestId("lgw-score-prompt_injection");
      expect(row).toHaveAttribute("data-mismatch", "true");
      expect(row).toHaveTextContent(/⚠️.*expected Blocked/);
      const last = GUARDRAIL_ATTACKS[GUARDRAIL_ATTACKS.length - 1];
      expect(within(screen.getByTestId(`lgw-score-${last.id}`)).getByTestId("lgw-score-unguarded")).toHaveTextContent("Sure, here you go.");
    });

    it("previews only the first line of an unguarded reply until it is clicked", async () => {
      mockRunAll({ unguarded: () => OK("First line of the answer.\nimport os  # the rest of it") });
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      runAll();
      await whenDone();

      const cell = within(screen.getByTestId("lgw-score-malicious_content")).getByTestId("lgw-score-unguarded");
      expect(cell).toHaveTextContent("First line of the answer.");
      expect(screen.queryByText(/import os/)).not.toBeInTheDocument();

      fireEvent.click(cell);

      expect(screen.getByTestId("lgw-score-detail")).toHaveTextContent(/import os/);
      expect(screen.getByTestId("lgw-decision")).toHaveTextContent("llamacpp");
    });

    it("Stop sends nothing more, and marks the attacks it never reached", async () => {
      const calls = [];
      let release;
      global.fetch = vi.fn((url, init) => {
        const u = String(url);
        if (u.endsWith("/llm/config")) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(CONFIG_WITH_LOCALS) });
        }
        if (u.endsWith("/llm/call")) {
          calls.push(JSON.parse(init.body));
          return new Promise((resolve) => { release = () => resolve(DENIED()); });
        }
        return new Promise(() => {});
      });
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      runAll();
      await waitFor(() => expect(calls).toHaveLength(1));
      fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
      release();
      await whenDone();

      expect(calls).toHaveLength(1);
      expect(screen.getByTestId(`lgw-score-${GUARDRAIL_ATTACKS[1].id}`)).toHaveTextContent(/not run/i);
    });

    it("can't be started without a llama.cpp lane to compare against", async () => {
      mockRunAll({ config: CONFIG });
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      expect(screen.getByRole("button", { name: /run all chat attacks/i })).toBeDisabled();
    });

    // The results belong to the lane that ran them. Switching lanes afterwards
    // must not relabel a health check as a lane that was never tested.
    it("keeps the scorecard labelled with the lane the run went through after a lane switch", async () => {
      mockRunAll();
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      runAll();
      await whenDone();
      fireEvent.click(screen.getByRole("button", { name: /google/i }));

      const card = screen.getByTestId("lgw-scorecard");
      expect(within(card).getByRole("columnheader", { name: /through anthropic/i })).toBeInTheDocument();
      expect(within(card).queryByRole("columnheader", { name: /through google/i })).not.toBeInTheDocument();
    });

    // Clear mid-run would let the active loop refill the screen afterward.
    it("can't Clear while a run is still in flight", async () => {
      const calls = [];
      global.fetch = vi.fn((url, init) => {
        const u = String(url);
        if (u.endsWith("/llm/config")) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(CONFIG_WITH_LOCALS) });
        }
        if (u.endsWith("/llm/call")) {
          calls.push(JSON.parse(init.body));
          // The first guarded call lands, so a decision is on screen; the next
          // never does, so the run is still in flight.
          return calls.length === 1 ? Promise.resolve(DENIED()) : new Promise(() => {});
        }
        return new Promise(() => {});
      });
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      runAll();
      await waitFor(() => expect(calls).toHaveLength(2));
      await screen.findByTestId("lgw-decision");

      expect(screen.getByRole("button", { name: /^clear$/i })).toBeDisabled();
    });
  });

  describe("empty prompt", () => {
    beforeEach(() => { window.localStorage.clear(); });

    it("tells the user to enter a prompt instead of silently doing nothing", async () => {
      mockFetch(() => new Promise(() => {}));
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/enter a prompt/i);
      expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/llm/call"));
    });

    it("clears the message once the user types something", async () => {
      mockFetch(() => new Promise(() => {}));
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
      await screen.findByRole("alert");

      fireEvent.change(screen.getByLabelText(/^prompt$/i), { target: { value: "hello" } });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("why Privilege denied it", () => {
    beforeEach(() => { window.localStorage.clear(); });

    it("explains a catalog attack's denial instead of leaving the bare reason unexplained", async () => {
      const attack = GUARDRAIL_ATTACKS.find((a) => a.id === "jailbreak");
      mockFetch(() => ({
        ok: false, status: 403,
        text: async () => JSON.stringify({
          error: "Forbidden", code: "llm_policy_denied", reason: "Forbidden",
          provider: "anthropic", route: "/llm/anthropic/v1/messages",
          latencyMs: 50, reachedProvider: false,
        }),
      }));
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      fireEvent.change(screen.getByLabelText(/attack library/i), { target: { value: attack.id } });
      fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

      const note = await screen.findByTestId("lgw-denial-explanation");
      expect(note).toHaveTextContent(attack.whyDenied);
      expect(note).toHaveTextContent(/Forbidden/);
    });

    it("falls back to a by-design note for a freeform prompt with no catalog match", async () => {
      mockFetch(() => ({
        ok: false, status: 403,
        text: async () => JSON.stringify({
          error: "Forbidden", code: "llm_policy_denied", reason: "Forbidden",
          provider: "anthropic", route: "/llm/anthropic/v1/messages",
          latencyMs: 50, reachedProvider: false,
        }),
      }));
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await ask("something I typed myself");

      const note = await screen.findByTestId("lgw-denial-explanation");
      expect(note).toHaveTextContent(/doesn.t disclose which policy or rule matched/i);
    });
  });

  describe("decision view toggle", () => {
    async function sendAndGetDecision() {
      mockFetch(() => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          reply: "Paris.", provider: "anthropic", route: "/llm/anthropic/v1/messages",
          latencyMs: 300, reachedProvider: true,
        }),
      }));
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await ask("capital of France?");
      await screen.findByTestId("lgw-decision");
    }

    it("has no toggle before a decision exists", async () => {
      mockFetch(() => new Promise(() => {}));
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await screen.findByText("/llm/anthropic/v1/messages");

      expect(screen.queryByRole("button", { name: /^json$/i })).not.toBeInTheDocument();
    });

    it("defaults to the form view, and JSON shows the same decision data raw", async () => {
      await sendAndGetDecision();

      expect(screen.getByRole("button", { name: /^form$/i })).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByTestId("lgw-decision-json")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^json$/i }));

      expect(screen.queryByTestId("lgw-decision")).not.toBeInTheDocument();
      const json = screen.getByTestId("lgw-decision-json");
      expect(json).toHaveTextContent(/"verdict"/);
      expect(json).toHaveTextContent(/"provider"/);
      expect(json).toHaveTextContent(/anthropic/);
    });

    it("switches back to the form view", async () => {
      await sendAndGetDecision();
      fireEvent.click(screen.getByRole("button", { name: /^json$/i }));
      await screen.findByTestId("lgw-decision-json");

      fireEvent.click(screen.getByRole("button", { name: /^form$/i }));

      expect(screen.queryByTestId("lgw-decision-json")).not.toBeInTheDocument();
      expect(await screen.findByTestId("lgw-decision")).toBeInTheDocument();
    });
  });

  describe("each run starts clean", () => {
    it("clears the previous prompt, reply and decision when the next one is sent", async () => {
      const responses = [
        {
          ok: true, status: 200,
          text: async () => JSON.stringify({
            reply: "Paris.", provider: "anthropic", route: "/llm/anthropic/v1/messages",
            latencyMs: 300, reachedProvider: true,
          }),
        },
        {
          ok: false, status: 403,
          text: async () => JSON.stringify({
            error: "blocked", code: "llm_policy_denied", reason: "no PII",
            provider: "anthropic", route: "/llm/anthropic/v1/messages",
            latencyMs: 60, reachedProvider: false,
          }),
        },
      ];
      let call = 0;
      global.fetch = vi.fn((url) => {
        const u = String(url);
        if (u.endsWith("/llm/config")) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(CONFIG) });
        }
        if (u.endsWith("/llm/call")) return Promise.resolve(responses[call++]);
        return new Promise(() => {});
      });

      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await ask("capital of France?");
      await screen.findByText("Paris.");

      await ask("customer SSN 123-45-6789");
      expect(await screen.findByTestId("lgw-decision")).toHaveTextContent(/Denied by policy/);

      expect(screen.queryByText("Paris.")).not.toBeInTheDocument();
      expect(screen.queryByText("capital of France?")).not.toBeInTheDocument();
      expect(document.querySelectorAll(".lgw-turn--model")).toHaveLength(1);
    });
  });

  // The virtual key's model allowlist is a Privilege policy like any other, and the
  // console has to be able to trip it without anyone hand-editing JSON. The model
  // must reach the wire verbatim: silently substituting the lane default would show
  // a call being allowed while claiming a blocked model was sent.
  describe("model picker", () => {
    const CATALOG = {
      anthropic: ["claude-haiku-4-5-20251001", "claude-opus-5", "claude-sonnet-5"],
      google: ["gemini-2.0-flash", "gemini-2.5-pro"],
    };

    function bodyOf(mock) {
      const [, init] = mock.mock.calls.find(([u]) => String(u).endsWith("/llm/call"));
      return JSON.parse(init.body);
    }

    const OK = () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({
        reply: "Paris.", provider: "anthropic", route: "/llm/anthropic/v1/messages",
        latencyMs: 300, reachedProvider: true,
      }),
    });

    // `models` defaults to the catalog above; pass null for a lane whose list the
    // gateway will not serve (Google's does exactly this today).
    function mockWithCatalog(models = CATALOG) {
      global.fetch = vi.fn((url) => {
        const u = String(url);
        if (u.endsWith("/llm/config")) {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(CONFIG) });
        }
        const lane = (u.match(/\/llm\/models\?provider=(\w+)/) || [])[1];
        if (lane) {
          if (!models) return Promise.resolve({ ok: false, status: 502, text: async () => JSON.stringify({ error: "gateway down" }) });
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ models: models[lane] || [] }) });
        }
        if (u.endsWith("/llm/call")) return Promise.resolve(OK());
        return new Promise(() => {});
      });
    }

    async function picker() {
      const el = await screen.findByLabelText(/model/i);
      // The options arrive from the catalog fetch, so nothing can be chosen until
      // that has landed.
      await waitFor(() => expect(el.options.length).toBeGreaterThan(1));
      return el;
    }

    it("sends no model at all when the default option is left selected", async () => {
      mockWithCatalog();
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      await picker();
      await ask("capital of France?");
      await screen.findByText("Paris.");

      expect(bodyOf(global.fetch)).toEqual({ provider: "anthropic", prompt: "capital of France?" });
    });

    it("sends the picked model, and names it on the decision", async () => {
      mockWithCatalog();
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      fireEvent.change(await picker(), { target: { value: "claude-opus-5" } });
      await ask("capital of France?");
      await screen.findByText("Paris.");

      expect(bodyOf(global.fetch).model).toBe("claude-opus-5");
      expect(screen.getByTestId("lgw-decision")).toHaveTextContent("claude-opus-5");
    });

    // The list is the provider's catalog, NOT the key's allowlist — Privilege does
    // not publish that. The ids it will refuse have to be offered or the picker can
    // only demonstrate calls that succeed, which is the opposite of the point.
    it("offers the whole catalog, with the default as the empty option", async () => {
      mockWithCatalog();
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      const el = await picker();

      expect([...el.options].map((o) => o.value))
        .toEqual(["", "claude-opus-5", "claude-sonnet-5"]);
      // The default is the empty option's label, not an entry of its own.
      expect(el.options[0]).toHaveTextContent("claude-haiku-4-5-20251001");
    });

    // A blocked model is refused for the LANE it was picked in. Carrying it across
    // would send a claude-* id to Google, which rejects it as an unknown model — a
    // provider error dressed up as the policy denial the demo is trying to show.
    it("does not carry one lane's model over to another", async () => {
      mockWithCatalog();
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);
      fireEvent.change(await picker(), { target: { value: "claude-opus-5" } });
      fireEvent.click(screen.getByRole("button", { name: /google/i }));

      const el = await screen.findByLabelText(/model/i);
      expect(el).toHaveValue("");
      await waitFor(() => expect([...el.options].map((o) => o.value)).toEqual(["", "gemini-2.5-pro"]));
      await ask("capital of France?");
      expect(bodyOf(global.fetch).model).toBeUndefined();
    });

    // Google's catalog 403s on the live gateway today. A picker holding one silent
    // option would read as "this provider has one model"; the page has to say the
    // list is missing instead.
    it("says so when the catalog cannot be read, and still sends the default", async () => {
      mockWithCatalog(null);
      render(<MemoryRouter><LlmGatewayPage /></MemoryRouter>);

      expect(await screen.findByText(/model list could not be read/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/model/i).options).toHaveLength(1);

      await ask("hello");
      await screen.findByText("Paris.");
      expect(bodyOf(global.fetch).model).toBeUndefined();
    });
  });
});
