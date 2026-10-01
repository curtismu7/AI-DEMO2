import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import bffAxios from "../../services/bffAxios";
import { fetchEnrichedUserInfo } from "../../services/userInfoService";
import OAuthTokenDisplayPage from "../OAuthTokenDisplayPage";

vi.mock("../../services/bffAxios", () => ({
  __esModule: true,
  default: { get: vi.fn() },
}));

vi.mock("../../services/userInfoService", () => ({
  __esModule: true,
  fetchEnrichedUserInfo: vi.fn(() => Promise.resolve({ data: null })),
}));

vi.mock("../../lib/embeddedPiFlow", () => ({
  startEmbeddedSignInFromUrl: vi.fn(async () => ({ code: "auth-code", state: "oauth-state" })),
  submitPassword: vi.fn(),
}));

vi.mock("../TokenCard", () => ({
  __esModule: true,
  default: ({ title }) => <div data-testid="token-card">{title}</div>,
}));

const ADMIN_STATUS_URL = "/api/auth/oauth/status";
const USER_STATUS_URL = "/api/auth/oauth/user/status";
const LOGIN_URL = "/api/auth/oauth/user/login?mode=pi.flow";
const TOKEN_CLAIMS_URL = "/api/auth/oauth/token-claims";

beforeEach(() => {
  vi.clearAllMocks();
});

test("accepts the BFF callback redirect after pi.flow establishes a user session", async () => {
  let callbackCompleted = false;
  bffAxios.get.mockImplementation((url) => {
    if (url === ADMIN_STATUS_URL) return Promise.resolve({ data: { authenticated: false } });
    if (url === USER_STATUS_URL) {
      return Promise.resolve({
        data: {
          authenticated: callbackCompleted,
          sessionType: callbackCompleted ? "user" : null,
          oauthProvider: callbackCompleted ? "PingOne" : null,
        },
      });
    }
    if (url === LOGIN_URL) {
      return Promise.resolve({
        data: {
          authorizeUrl: "https://auth.pingone.com/env/as/authorize?response_type=code",
          callbackPath: "/api/auth/oauth/user/callback",
        },
      });
    }
    if (url === TOKEN_CLAIMS_URL) {
      return Promise.resolve({
        data: { authenticated: true, decoded: { header: {}, payload: { sub: "user-1" } } },
      });
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });

  const originalFetch = global.fetch;
  global.fetch = vi.fn(async () => {
    callbackCompleted = true;
    return { status: 302, ok: false, type: "basic" };
  });

  try {
    render(<OAuthTokenDisplayPage />);
    fireEvent.click(await screen.findByRole("button", { name: /sign in with pingone here/i }));

    await waitFor(() => expect(screen.getByTestId("token-card")).toHaveTextContent("User Access Token"));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/oauth/user/callback?code=auth-code&state=oauth-state"),
      expect.objectContaining({ credentials: "include", redirect: "manual" }),
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("renders an active Admin session and does not offer user sign-in", async () => {
  bffAxios.get.mockImplementation((url) => {
    if (url === ADMIN_STATUS_URL) {
      return Promise.resolve({
        data: {
          authenticated: true,
          sessionType: "admin",
          oauthProvider: "PingOne",
          user: { id: "admin-1", role: "admin" },
        },
      });
    }
    if (url === USER_STATUS_URL) return Promise.resolve({ data: { authenticated: false } });
    if (url === TOKEN_CLAIMS_URL) {
      return Promise.resolve({
        data: {
          authenticated: true,
          sessionType: "admin",
          decoded: { header: {}, payload: { sub: "admin-1" } },
        },
      });
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });

  render(<OAuthTokenDisplayPage />);

  expect(await screen.findByTestId("token-card")).toHaveTextContent("Admin Access Token");
  expect(screen.getByText("Admin Session")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /sign in with pingone here/i })).not.toBeInTheDocument();
  expect(fetchEnrichedUserInfo).not.toHaveBeenCalled();
});
