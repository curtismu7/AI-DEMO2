import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import DavinciLoginCallback from "../DavinciLoginCallback";

// The callback exchanges the code the widget flow produced and lands the user
// on the confirmation page (/davinci-login/confirmed), not "/" — the point of
// that page is to show explicitly who the flow just signed in as, rather than
// silently dropping the user back into the app shell.

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const originalFetch = global.fetch;

function renderAt(search) {
  window.history.pushState({}, "", `/davinci-login/callback${search}`);
  return render(
    <MemoryRouter initialEntries={[`/davinci-login/callback${search}`]}>
      <DavinciLoginCallback />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockNavigate.mockClear();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("DavinciLoginCallback", () => {
  test("exchanges the code and navigates to the confirmation page on success", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ ok: true }) }));

    renderAt("?code=abc123");

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/davinci-login/confirmed", { replace: true })
    );
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/davinci-login/callback");
    expect(JSON.parse(opts.body)).toEqual({ code: "abc123" });
  });

  test("shows an error and never navigates when the exchange fails", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 401, json: async () => ({ message: "nonce_mismatch" }) })
    );

    const { findByText } = renderAt("?code=abc123");

    await findByText(/nonce_mismatch/i);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("shows an error with no fetch when the callback URL carries an OIDC error", async () => {
    global.fetch = vi.fn();

    const { findByText } = renderAt("?error=access_denied&error_description=User+cancelled");

    await findByText(/user cancelled/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
