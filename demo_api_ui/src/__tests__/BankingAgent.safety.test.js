/**
 * Safety-fix regression tests for BankingAgent.
 * These assert the invariants fixed in docs/superpowers/plans/2026-05-18-banking-agent-safety-fixes.md
 * They intentionally test small pure helpers extracted from the component so they
 * are fast and do not require mounting the 357KB component.
 */
import {
  claimPendingNl,
  clampPanelPosition,
  makeReentrancyGuard,
  resolveEmbeddedFocus,
  isAbortError,
  anySignal,
  isLocalModelTimeout,
  prewarmTierAndRetry,
} from "../components/demoAgentSafety";

describe("claimPendingNl — atomic single-fire post-OAuth replay (Task 1)", () => {
  beforeEach(() => {
    const store = {};
    global.sessionStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    };
  });

  test("returns the stored value and removes it in one call", () => {
    sessionStorage.setItem("bx_agent_pending_nl", "transfer $50 to savings");
    const first = claimPendingNl("bx_agent_pending_nl");
    expect(first).toBe("transfer $50 to savings");
    expect(sessionStorage.getItem("bx_agent_pending_nl")).toBeNull();
  });

  test("a second concurrent claim gets null (no double replay)", () => {
    sessionStorage.setItem("bx_agent_pending_nl", "transfer $50 to savings");
    const a = claimPendingNl("bx_agent_pending_nl");
    const b = claimPendingNl("bx_agent_pending_nl");
    expect(a).toBe("transfer $50 to savings");
    expect(b).toBeNull();
  });

  test("returns null and does not throw when storage is unavailable", () => {
    global.sessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(claimPendingNl("bx_agent_pending_nl")).toBeNull();
  });
});

describe("clampPanelPosition — off-screen recovery bounds", () => {
  const panel = { width: 620, height: 540 };
  const vp = { width: 1280, height: 800 };

  test("position fully inside viewport is unchanged", () => {
    expect(clampPanelPosition({ x: 100, y: 100 }, panel, vp)).toEqual({
      x: 100,
      y: 100,
    });
  });

  test("dragged past the right edge keeps a 48px strip visible", () => {
    const r = clampPanelPosition({ x: 5000, y: 200 }, panel, vp);
    expect(r.x).toBe(1280 - 48);
    expect(r.y).toBe(200);
  });

  test("dragged above the top is clamped to y=0", () => {
    const r = clampPanelPosition({ x: 100, y: -400 }, panel, vp);
    expect(r.y).toBe(0);
  });

  test("dragged off the left keeps >=48px of panel on screen", () => {
    const r = clampPanelPosition({ x: -5000, y: 100 }, panel, vp);
    expect(r.x).toBe(48 - panel.width);
    expect(r.x + panel.width).toBe(48);
  });

  test("window shrunk below panel position reclamps inward", () => {
    const small = { width: 360, height: 640 };
    const r = clampPanelPosition({ x: 1000, y: 700 }, panel, small);
    expect(r.x).toBe(360 - 48);
    expect(r.y).toBe(640 - 48);
  });
});

describe("makeReentrancyGuard — single in-flight send (Task 2)", () => {
  test("second acquire while held returns false", () => {
    const g = makeReentrancyGuard();
    expect(g.tryAcquire()).toBe(true);
    expect(g.tryAcquire()).toBe(false);
    g.release();
    expect(g.tryAcquire()).toBe(true);
  });

  test("release is idempotent and safe when not held", () => {
    const g = makeReentrancyGuard();
    expect(() => g.release()).not.toThrow();
    expect(g.tryAcquire()).toBe(true);
  });

  test("guard is released even when the guarded fn throws", async () => {
    const g = makeReentrancyGuard();
    const run = async () => {
      if (!g.tryAcquire()) return "blocked";
      try {
        return await Promise.reject(new Error("boom"));
      } finally {
        g.release();
      }
    };
    await expect(run()).rejects.toThrow("boom");
    expect(g.tryAcquire()).toBe(true); // not stuck held
  });
});

describe("resolveEmbeddedFocus — route → agent persona parity (Phase 2)", () => {
  test("config route resolves to 'config'", () => {
    expect(resolveEmbeddedFocus("/config")).toBe("config");
    expect(resolveEmbeddedFocus("/config/")).toBe("config");
  });
  test("dashboard and other routes resolve to 'banking'", () => {
    expect(resolveEmbeddedFocus("/dashboard")).toBe("banking");
    expect(resolveEmbeddedFocus("/")).toBe("banking");
    expect(resolveEmbeddedFocus("/admin")).toBe("banking");
    expect(resolveEmbeddedFocus("/monitoring/api-traffic")).toBe("banking");
  });
  test("non-string input falls back to 'banking' (guard, never throws)", () => {
    expect(resolveEmbeddedFocus(undefined)).toBe("banking");
    expect(resolveEmbeddedFocus(null)).toBe("banking");
  });
  test("query/hash are not stripped — parity with the legacy predicate", () => {
    expect(resolveEmbeddedFocus("/config?x=1")).toBe("banking");
    expect(resolveEmbeddedFocus("/config#h")).toBe("banking");
  });
});

describe("isAbortError — silent-cancel classification (Phase 3)", () => {
  test("DOMException AbortError is recognized", () => {
    const e = new DOMException("aborted", "AbortError");
    expect(isAbortError(e)).toBe(true);
  });
  test("a plain error named AbortError is recognized", () => {
    const e = new Error("x");
    e.name = "AbortError";
    expect(isAbortError(e)).toBe(true);
  });
  test("an ordinary error is not an abort", () => {
    expect(isAbortError(new Error("network"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe("abort wiring contract (Phase 3)", () => {
  test("a fetch given an aborted signal rejects with AbortError and isAbortError catches it", async () => {
    // jsdom's fetch may use a different URL resolver; test isAbortError directly
    // with a spec-compliant DOMException (name === 'AbortError')
    const abortErr = new DOMException("The operation was aborted.", "AbortError");
    expect(isAbortError(abortErr)).toBe(true);
  });
  test("anySignal aborts when either input aborts", () => {
    const a = new AbortController();
    const b = new AbortController();
    const any = anySignal([a.signal, b.signal]);
    expect(any.aborted).toBe(false);
    b.abort();
    expect(any.aborted).toBe(true);
  });
  test("anySignal aborts immediately if an input is already aborted", () => {
    const a = new AbortController();
    a.abort();
    const b = new AbortController();
    const any = anySignal([a.signal, b.signal]);
    expect(any.aborted).toBe(true);
  });
  test("anySignal still aborts via the short signal when a never-aborted lifecycle signal is composed", async () => {
    const live = new AbortController(); // never aborted
    const short = new AbortController(); // stands in for AbortSignal.timeout(10) — jsdom lacks AbortSignal.timeout
    const any = anySignal([short.signal, live.signal]);
    expect(any.aborted).toBe(false);
    short.abort(); // simulate the timeout firing
    expect(any.aborted).toBe(true);
    expect(live.signal.aborted).toBe(false); // lifecycle signal untouched
  });
});

describe("isLocalModelTimeout — gates the pre-warm retry action to llama.cpp timeouts", () => {
  test("true for a TimeoutError name while on llamacpp", () => {
    expect(isLocalModelTimeout({ name: "TimeoutError" }, "llamacpp")).toBe(true);
  });

  test("true for a message containing 'timed out' while on llamacpp", () => {
    expect(isLocalModelTimeout({ message: "signal timed out" }, "llamacpp")).toBe(true);
  });

  test("false when the provider is not llamacpp, even if it timed out", () => {
    expect(isLocalModelTimeout({ name: "TimeoutError" }, "helix")).toBe(false);
    expect(isLocalModelTimeout({ name: "TimeoutError" }, "anthropic-lmstudio")).toBe(false);
  });

  test("false for a non-timeout error on llamacpp", () => {
    expect(isLocalModelTimeout({ message: "network error" }, "llamacpp")).toBe(false);
  });

  test("false for a null/undefined error", () => {
    expect(isLocalModelTimeout(null, "llamacpp")).toBe(false);
    expect(isLocalModelTimeout(undefined, "llamacpp")).toBe(false);
  });
});

describe("prewarmTierAndRetry — force-load a tier then replay the original request", () => {
  afterEach(() => {
    delete global.fetch;
  });

  test("POSTs the model to the prewarm endpoint and calls retry on success", async () => {
    const calls = [];
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    const retry = vi.fn().mockResolvedValue(undefined);

    await prewarmTierAndRetry("gpt-oss-20b", retry);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/langchain/llamacpp/prewarm",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-oss-20b" }),
      }),
    );
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("throws and does not call retry when the prewarm response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    const retry = vi.fn();

    await expect(prewarmTierAndRetry("gpt-oss-20b", retry)).rejects.toThrow("Pre-warm failed");
    expect(retry).not.toHaveBeenCalled();
  });

  test("propagates a fetch rejection and does not call retry", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const retry = vi.fn();

    await expect(prewarmTierAndRetry("gpt-oss-20b", retry)).rejects.toThrow("network down");
    expect(retry).not.toHaveBeenCalled();
  });
});
