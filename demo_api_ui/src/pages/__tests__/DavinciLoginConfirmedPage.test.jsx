import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import DavinciLoginConfirmedPage from "../DavinciLoginConfirmedPage";

const originalFetch = global.fetch;

function renderPage() {
  return render(
    <MemoryRouter>
      <DavinciLoginConfirmedPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("DavinciLoginConfirmedPage", () => {
  test("shows the signed-in user from /api/auth/me", async () => {
    global.fetch = vi.fn((url) => {
      expect(url).toBe("/api/auth/me");
      return Promise.resolve({
        ok: true,
        json: async () => ({ user: { username: "demoUser", role: "customer", email: "demo@example.com" } }),
      });
    });

    const { findByText } = renderPage();

    await findByText("demoUser");
    await findByText("customer");
    await findByText("demo@example.com");
  });

  test("shows an error instead of user facts when the session check fails", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401 }));

    const { findByText } = renderPage();

    await findByText(/could not load your session/i);
  });
});
