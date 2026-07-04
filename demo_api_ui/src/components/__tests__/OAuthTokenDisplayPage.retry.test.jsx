// OAuthTokenDisplayPage.retry.test.jsx
// Regression test for the "Failed to Load Token Data" dead-end: a transient
// request failure (timeout / connection reset / server restart) left the modal
// permanently stuck with no way to recover. The fix adds a "Try Again" button
// that re-runs the fetch without remounting the modal.
import { TextEncoder, TextDecoder } from "util";

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import bffAxios from "../../services/bffAxios";
import { fetchEnrichedUserInfo } from "../../services/userInfoService";
import OAuthTokenDisplayPage from "../OAuthTokenDisplayPage";

if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

vi.mock("../../services/bffAxios", () => ({
  __esModule: true,
  default: { get: vi.fn() },
}));

vi.mock("../../services/userInfoService", () => ({
  __esModule: true,
  fetchEnrichedUserInfo: vi.fn(() => Promise.resolve({ data: null })),
}));

// Stub the token card so the assertion doesn't depend on its internals — it just
// echoes the title so we can confirm the success path rendered after retry.
vi.mock("../TokenCard", () => ({
  __esModule: true,
  default: ({ title }) => <div data-testid="token-card">{title}</div>,
}));

const STATUS_URL = "/api/auth/oauth/user/status";
const PREVIEW_URL = "/api/tokens/session-preview";

const AUTHED_STATUS = {
  authenticated: true,
  oauthProvider: "PingOne",
  user: { id: "u1", username: "jdoe" },
};

const PREVIEW_WITH_USER_TOKEN = {
  tokenEvents: [
    {
      id: "user-token",
      label: "User access token",
      jwtFullDecode: { header: { alg: "RS256" }, claims: { sub: "user-123", scope: "openid" } },
    },
  ],
};

function wireSuccess() {
  bffAxios.get.mockImplementation((url) => {
    if (url === STATUS_URL) return Promise.resolve({ data: AUTHED_STATUS });
    if (url === PREVIEW_URL) return Promise.resolve({ data: PREVIEW_WITH_USER_TOKEN });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchEnrichedUserInfo.mockResolvedValue({ data: null });
});

test("recovers from a transient fetch failure when Try Again is clicked", async () => {
  // First mount: the status request rejects (transient network failure).
  bffAxios.get.mockRejectedValueOnce(new Error("Network Error"));

  render(<OAuthTokenDisplayPage />);

  // The error screen appears with a working retry control (not a dead end).
  const retry = await screen.findByRole("button", { name: /try again/i });
  expect(screen.getByText(/Failed to Load Token Data/i)).toBeInTheDocument();

  // Server recovers; clicking Try Again re-runs the fetch without a remount.
  wireSuccess();
  fireEvent.click(retry);

  // Token data now renders and the error screen is gone.
  await waitFor(() =>
    expect(screen.queryByText(/Failed to Load Token Data/i)).not.toBeInTheDocument()
  );
  expect(await screen.findByTestId("token-card")).toHaveTextContent("User Access Token");
});
