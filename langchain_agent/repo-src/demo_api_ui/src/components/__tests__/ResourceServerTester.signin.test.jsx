// ResourceServerTester.signin.test.jsx
// Covers the Sign In CTA added for 401s in the tester results:
//   1. Probe verdict HTTP 401 -> "rejected, sign in to retry" row + Sign in button
//   2. Session-expired 401 from the gated route -> Sign in button beside the error
//   3. Non-401 failure -> error shown WITHOUT a Sign in button
//   4. Clicking Sign in invokes navigateToCustomerOAuthLogin
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import bffAxios from "../../services/bffAxios";
import { navigateToCustomerOAuthLogin } from "../../utils/authUi";
import ResourceServerTester from "../ResourceServerTester";

vi.mock("../../services/bffAxios", () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

// notifySessionExpiredIfNeeded is a side-effecting no-op here; navigateToCustomerOAuthLogin
// is the click target we assert on.
vi.mock("../../utils/authUi", () => ({
  __esModule: true,
  notifySessionExpiredIfNeeded: jest.fn(),
  navigateToCustomerOAuthLogin: jest.fn(),
}));

// Open the outer "Test this Resource Server" collapsible, then the named inner panel.
function openPanel(panelNameRe) {
  fireEvent.click(screen.getByRole("button", { name: /Test this Resource Server/i }));
  fireEvent.click(screen.getByRole("button", { name: panelNameRe }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("probe verdict 401 renders the rejected/sign-in row with a Sign in button", async () => {
  bffAxios.post.mockResolvedValueOnce({
    data: { status: 401, statusText: "Unauthorized", body: { error: "invalid_token" } },
  });

  render(<ResourceServerTester />);
  openPanel(/Live request probe/i);
  fireEvent.click(screen.getByRole("button", { name: /Send request/i }));

  expect(await screen.findByText(/HTTP 401 Unauthorized/i)).toBeInTheDocument();
  expect(screen.getByText(/sign in to retry with a fresh session token/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
  expect(navigateToCustomerOAuthLogin).toHaveBeenCalledTimes(1);
});

test("session-expired 401 error renders a Sign in button beside the message", async () => {
  bffAxios.post.mockRejectedValueOnce({
    response: { status: 401, data: { error: "session_expired" } },
  });

  render(<ResourceServerTester />);
  openPanel(/Real RS validation/i);
  fireEvent.click(screen.getByRole("button", { name: /Run validation/i }));

  expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
});

test("non-401 failure shows the error but no Sign in button", async () => {
  bffAxios.post.mockRejectedValueOnce({
    response: { status: 500, data: { message: "Internal error" } },
  });

  render(<ResourceServerTester />);
  openPanel(/Real RS validation/i);
  fireEvent.click(screen.getByRole("button", { name: /Run validation/i }));

  expect(await screen.findByText(/Internal error/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^sign in$/i })).not.toBeInTheDocument();
});
