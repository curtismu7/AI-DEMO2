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
  // The session's own demo user, not /api/auth/me: /me looks the user up by the
  // token's PingOne sub, which is not the demo record a DaVinci sign-in stores,
  // so its username came back blank.
  test("shows the signed-in user from the customer session status", async () => {
    global.fetch = vi.fn((url) => {
      expect(url).toBe("/api/auth/oauth/user/status");
      return Promise.resolve({
        ok: true,
        json: async () => ({
          authenticated: true,
          user: { username: "demoUser", role: "customer", email: "demo@example.com" },
        }),
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

  test("says so when the customer session is not signed in", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ authenticated: false, user: null }) })
    );

    const { findByText, queryByText } = renderPage();

    await findByText(/not signed in/i);
    expect(queryByText("Username")).toBeNull();
  });
});
