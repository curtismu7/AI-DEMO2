import React from "react";
import { render, screen } from "@testing-library/react";
import bffAxios from "../../services/bffAxios";
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
  startEmbeddedSignInFromUrl: vi.fn(),
  submitPassword: vi.fn(),
}));

vi.mock("../TokenCard", () => ({
  __esModule: true,
  default: ({ title }) => <div data-testid="token-card">{title}</div>,
}));

function mockSession(claims) {
  bffAxios.get.mockImplementation((url) => {
    if (url === "/api/auth/oauth/status") return Promise.resolve({ data: { authenticated: false } });
    if (url === "/api/auth/oauth/user/status") {
      return Promise.resolve({ data: { authenticated: true, sessionType: "user", oauthProvider: "PingOne" } });
    }
    if (url === "/api/auth/oauth/token-claims") return Promise.resolve({ data: claims });
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

test("shows the ID token and refresh token status, with every section open by default", async () => {
  mockSession({
    authenticated: true,
    decoded: { header: { alg: "RS256" }, payload: { sub: "u1", scope: "openid" } },
    idToken: { header: { alg: "RS256" }, payload: { sub: "u1", email: "a@b.c" } },
    hasRefreshToken: true,
    refreshTokenFormat: "opaque",
    expiresAt: Date.now() + 3600_000,
  });
  const { container } = render(<OAuthTokenDisplayPage />);

  const cards = await screen.findAllByTestId("token-card");
  expect(cards.map((c) => c.textContent)).toEqual(["User Access Token", "ID Token"]);
  expect(screen.getByText("Refresh Token")).toBeInTheDocument();
  expect(screen.getByText(/Opaque \(not a JWT/)).toBeInTheDocument();
  expect(screen.getByText(/never sent to the browser/i)).toBeInTheDocument();
  // Raw claims used to start collapsed.
  expect(container.querySelector(".otdp-raw-json")).not.toBeNull();
});

test("a session without an ID token or refresh token says so and omits the ID card", async () => {
  mockSession({
    authenticated: true,
    decoded: { header: {}, payload: { sub: "u1" } },
    idToken: null,
    hasRefreshToken: false,
    refreshTokenFormat: null,
    expiresAt: null,
  });
  render(<OAuthTokenDisplayPage />);

  const cards = await screen.findAllByTestId("token-card");
  expect(cards.map((c) => c.textContent)).toEqual(["User Access Token"]);
  expect(screen.getByText(/No \(this session has no refresh token\)/)).toBeInTheDocument();
});
