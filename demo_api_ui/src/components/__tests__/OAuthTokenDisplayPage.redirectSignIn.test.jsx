import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import bffAxios from "../../services/bffAxios";
import OAuthTokenDisplayPage from "../OAuthTokenDisplayPage";
import { PI_FLOW_SIGNIN_EVENT } from "../../utils/authUi";

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

test("signed-out page opens the pi.flow modal and returns to this page", async () => {
  bffAxios.get.mockResolvedValue({ data: { authenticated: false } });
  const originalLocation = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, pathname: "/oauth/token-display", href: "", assign },
  });
  const handled = vi.fn((e) => { e.detail.handled = true; });
  window.addEventListener(PI_FLOW_SIGNIN_EVENT, handled);

  try {
    render(<OAuthTokenDisplayPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^sign in with pingone$/i }));
    expect(handled).toHaveBeenCalled();
    expect(handled.mock.calls[0][0].detail.returnTo).toBe("/oauth/token-display");
    expect(window.location.href).toBe("");
  } finally {
    window.removeEventListener(PI_FLOW_SIGNIN_EVENT, handled);
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  }
});
