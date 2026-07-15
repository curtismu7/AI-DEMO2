// demo_api_ui/src/pages/__tests__/TracingPage.test.jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TracingPage from "../TracingPage";
import {
  TRACING_SERVICE_STORAGE_KEY,
  __setTracingStorageForTests,
} from "../tracingServiceSelect";

function jsonOk(body) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function jsonFail(status, body = {}) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  });
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

describe("TracingPage", () => {
  let store;

  beforeEach(() => {
    store = memoryStorage();
    __setTracingStorageForTests(store);
  });

  afterEach(() => {
    __setTracingStorageForTests(undefined);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("auto-selects the service with the newest traces when none stored", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        const u = String(url);
        if (u.includes("/tracing/status")) {
          return jsonOk({ ok: true, jaegerUiUrl: "http://jaeger", otelEndpoint: "http://otel" });
        }
        if (u.includes("/tracing/services")) {
          return jsonOk({ services: ["quiet-svc", "busy-svc"] });
        }
        if (u.includes("service=quiet-svc") && u.includes("limit=5")) {
          return jsonOk({ traces: [] });
        }
        if (u.includes("service=busy-svc") && u.includes("limit=5")) {
          return jsonOk({
            traces: [{ traceId: "1", startTime: "2026-07-15T12:00:00.000Z", operation: "GET", spanCount: 1, durationMs: 10 }],
          });
        }
        if (u.includes("service=busy-svc") && u.includes("limit=25")) {
          return jsonOk({
            traces: [
              {
                traceId: "abcd1234abcd1234ffff",
                startTime: "2026-07-15T12:00:00.000Z",
                operation: "GET /accounts",
                spanCount: 3,
                durationMs: 42,
              },
            ],
            timestamp: "2026-07-15T12:01:00.000Z",
          });
        }
        return jsonOk({ traces: [] });
      }),
    );

    render(<TracingPage />);
    await waitFor(() => expect(screen.getByText("GET /accounts")).toBeInTheDocument());
    expect(screen.getByLabelText("Service")).toHaveValue("busy-svc");
    expect(screen.queryByText(/Try another service/i)).not.toBeInTheDocument();
  });

  it("honors a stored service even when another has newer traces", async () => {
    store.setItem(TRACING_SERVICE_STORAGE_KEY, "quiet-svc");
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        const u = String(url);
        if (u.includes("/tracing/status")) {
          return jsonOk({ ok: true, jaegerUiUrl: "http://jaeger" });
        }
        if (u.includes("/tracing/services")) {
          return jsonOk({ services: ["quiet-svc", "busy-svc"] });
        }
        if (u.includes("service=quiet-svc") && u.includes("limit=25")) {
          return jsonOk({ traces: [], timestamp: "2026-07-15T12:01:00.000Z" });
        }
        return jsonOk({ traces: [] });
      }),
    );

    render(<TracingPage />);
    await waitFor(() => expect(screen.getByLabelText("Service")).toHaveValue("quiet-svc"));
    await waitFor(() => expect(screen.getByText(/Try another service/i)).toBeInTheDocument());
    const chainLinks = screen.getAllByRole("link", { name: "Token Chain" });
    expect(chainLinks.some((a) => a.getAttribute("href") === "/monitoring/token-chain")).toBe(true);
  });

  it("shows full empty explainer only after a manual service change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        const u = String(url);
        if (u.includes("/tracing/status")) {
          return jsonOk({ ok: true, jaegerUiUrl: "http://jaeger" });
        }
        if (u.includes("/tracing/services")) {
          return jsonOk({ services: ["a-svc", "b-svc"] });
        }
        if (u.includes("limit=5")) {
          return jsonOk({ traces: [] });
        }
        if (u.includes("service=a-svc") && u.includes("limit=25")) {
          return jsonOk({ traces: [], timestamp: "2026-07-15T12:01:00.000Z" });
        }
        if (u.includes("service=b-svc") && u.includes("limit=25")) {
          return jsonOk({ traces: [], timestamp: "2026-07-15T12:01:00.000Z" });
        }
        return jsonOk({ traces: [] });
      }),
    );

    render(<TracingPage />);
    await waitFor(() => expect(screen.getByText(/No traces in this window yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/Try another service/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "b-svc" } });
    await waitFor(() => expect(screen.getByText(/Try another service/i)).toBeInTheDocument());
    expect(store.getItem(TRACING_SERVICE_STORAGE_KEY)).toBe("b-svc");
  });

  it("shows retry copy on HTTP 502 instead of empty traces", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => {
        const u = String(url);
        if (u.includes("/tracing/status")) {
          return jsonFail(502, { message: "HTTP 502" });
        }
        return jsonFail(502, { message: "HTTP 502" });
      }),
    );

    render(<TracingPage />);
    await waitFor(() => expect(screen.getByText(/Backend briefly unavailable/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/No traces yet/i)).not.toBeInTheDocument();
  });
});
