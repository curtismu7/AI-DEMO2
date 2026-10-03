import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import bffAxios from "../../services/bffAxios";
import { fetchEnrichedUserInfo } from "../../services/userInfoService";
import OAuthTokenDisplayPage from "../OAuthTokenDisplayPage";

vi.mock("../../services/bffAxios", () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("../../services/userInfoService", () => ({
  __esModule: true,
  fetchEnrichedUserInfo: vi.fn(() => Promise.resolve({ data: null })),
}));

vi.mock("../../lib/embeddedPiFlow", () => ({
  startEmbeddedSignInFromUrl: vi.fn(),
  submitPassword: vi.fn(),
}));

vi.mock("../TokenCard", () => ({
  __esModule: true,
  default: ({ title }) => <div data-testid="token-card">{title}</div>,
}));

function mockSession({ claims, sessionType = "user" }) {
  bffAxios.get.mockImplementation((url) => {
    if (url === "/api/auth/oauth/status") {
      return Promise.resolve({ data: sessionType === "admin" ? { authenticated: true, sessionType: "admin" } : { authenticated: false } });
    }
    if (url === "/api/auth/oauth/user/status") {
      return Promise.resolve({ data: sessionType === "user" ? { authenticated: true, sessionType: "user" } : { authenticated: false } });
    }
    if (url === "/api/auth/oauth/token-claims") return Promise.resolve({ data: claims });
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

const CLAIMS = {
  authenticated: true,
  decoded: { header: { alg: "RS256" }, payload: { sub: "u1", scope: "openid" } },
  idToken: { header: { alg: "RS256" }, payload: { sub: "u1", email: "old@example.com", given_name: "Ann" } },
  hasRefreshToken: true,
  refreshTokenFormat: "opaque",
  expiresAt: Date.now() + 3600_000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

test("shows a live countdown to access token expiry, and 'expired' once past", async () => {
  mockSession({ claims: CLAIMS });
  const { unmount } = render(<OAuthTokenDisplayPage />);
  expect((await screen.findByTestId("expiry-countdown")).textContent).toMatch(/^\(in 59m \d+s\)$/);
  unmount();

  mockSession({ claims: { ...CLAIMS, expiresAt: Date.now() - 1000 } });
  render(<OAuthTokenDisplayPage />);
  expect((await screen.findByTestId("expiry-countdown")).textContent).toBe("(expired)");
});

test("Refresh now posts to the user refresh route and re-reads the token", async () => {
  mockSession({ claims: CLAIMS });
  bffAxios.post.mockResolvedValue({ data: { success: true } });
  render(<OAuthTokenDisplayPage />);

  fireEvent.click(await screen.findByRole("button", { name: "Refresh now" }));
  await screen.findByText(/exchanged the refresh token for a new access token/i);
  expect(bffAxios.post).toHaveBeenCalledWith("/api/auth/oauth/user/refresh");
  // fetchTokenData ran again after the refresh.
  expect(bffAxios.get.mock.calls.filter(([u]) => u === "/api/auth/oauth/token-claims").length).toBeGreaterThanOrEqual(2);
});

test("Refresh now is not offered when the session has no refresh token", async () => {
  mockSession({ claims: { ...CLAIMS, hasRefreshToken: false, refreshTokenFormat: null } });
  render(<OAuthTokenDisplayPage />);
  await screen.findByText("Refresh Token");
  expect(screen.queryByRole("button", { name: "Refresh now" })).not.toBeInTheDocument();
});

test("Revoke asks first, then posts, and reports what PingOne says", async () => {
  mockSession({ claims: CLAIMS });
  bffAxios.post.mockResolvedValue({ data: { revoked: true, activeAfterRevoke: false } });
  render(<OAuthTokenDisplayPage />);

  fireEvent.click(await screen.findByRole("button", { name: "Revoke access token" }));
  expect(bffAxios.post).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

  await screen.findByText(/PingOne now reports this access token as inactive/i);
  expect(bffAxios.post).toHaveBeenCalledWith("/api/auth/oauth/user/revoke");
});

test("cancelling the revoke prompt posts nothing", async () => {
  mockSession({ claims: CLAIMS });
  render(<OAuthTokenDisplayPage />);

  fireEvent.click(await screen.findByRole("button", { name: "Revoke access token" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(bffAxios.post).not.toHaveBeenCalled();
});

test("an admin session cannot revoke from this page", async () => {
  mockSession({ claims: CLAIMS, sessionType: "admin" });
  render(<OAuthTokenDisplayPage />);
  await screen.findByText("Refresh Token");
  expect(screen.queryByRole("button", { name: "Revoke access token" })).not.toBeInTheDocument();
});

test("compares ID token claims with live userinfo and flags differences", async () => {
  mockSession({ claims: CLAIMS });
  fetchEnrichedUserInfo.mockResolvedValue({
    data: { email: "new@example.com", given_name: "Ann", family_name: "Lee" },
  });
  render(<OAuthTokenDisplayPage />);

  const table = await screen.findByRole("table", { name: /ID token compared with userinfo/i });
  const row = (key) => Array.from(table.querySelectorAll('[role="row"]')).find((r) => r.textContent.startsWith(key));
  expect(row("email").textContent).toContain("differs");
  expect(row("given_name").textContent).toContain("match");
  expect(row("family_name").textContent).toContain("only in userinfo");
  expect(row("sub").textContent).toContain("only in ID token");
});

test("Copy claims writes the decoded payload as JSON to the clipboard", async () => {
  mockSession({ claims: CLAIMS });
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<OAuthTokenDisplayPage />);

  fireEvent.click(await screen.findByRole("button", { name: "Copy claims" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(CLAIMS.decoded.payload, null, 2)));
  expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
});
