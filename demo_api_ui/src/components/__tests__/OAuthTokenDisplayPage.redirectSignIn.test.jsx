import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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

test("signed-out page offers a redirect sign-in that returns to this page", async () => {
  bffAxios.get.mockResolvedValue({ data: { authenticated: false } });
  const originalLocation = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, pathname: "/oauth/token-display", assign },
  });

  try {
    render(<OAuthTokenDisplayPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^sign in with pingone$/i }));
    expect(assign).toHaveBeenCalledWith(
      "/api/auth/oauth/user/login?return_to=%2Foauth%2Ftoken-display",
    );
  } finally {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  }
});
