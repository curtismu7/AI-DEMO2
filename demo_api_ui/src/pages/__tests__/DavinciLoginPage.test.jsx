import { render, waitFor } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import DavinciLoginPage from "../DavinciLoginPage";

// The page must fetch a session-bound nonce from the BFF and pass it into
// client.start({ query: { nonce } }) — that is the UI half of the ID-token
// replay protection verified by POST /api/davinci-login/callback. Dropping
// either side silently disarms the check, so this test pins the wiring.

vi.mock("../../lib/davinciWidgetClient", () => ({
  getDavinciClient: vi.fn(),
  isSdkError: (r) => !r || Boolean(r.error),
}));

import { getDavinciClient } from "../../lib/davinciWidgetClient";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (String(url).includes("/api/davinci-login/nonce")) {
      return Promise.resolve({ ok: true, json: async () => ({ nonce: "test-nonce-1" }) });
    }
    // GET /api/davinci-demo/config (flow version badge)
    return Promise.resolve({ ok: true, json: async () => ({ flowVersion: "v1" }) });
  });
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe("DavinciLoginPage flow start", () => {
  test("passes the BFF-issued nonce into client.start as an authorize query param", async () => {
    const start = vi.fn().mockResolvedValue({ collectors: [] });
    getDavinciClient.mockResolvedValue({ start });

    render(<DavinciLoginPage />);

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start).toHaveBeenCalledWith({ query: { nonce: "test-nonce-1" } });
  });

  test("shows an error instead of starting the flow when the nonce endpoint fails", async () => {
    const start = vi.fn();
    getDavinciClient.mockResolvedValue({ start });
    global.fetch = vi.fn((url) =>
      String(url).includes("/api/davinci-login/nonce")
        ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
        : Promise.resolve({ ok: true, json: async () => ({ flowVersion: "v1" }) })
    );

    const { findByText } = render(<DavinciLoginPage />);

    await findByText(/could not start a login flow/i);
    expect(start).not.toHaveBeenCalled();
  });
});
