// AccessIdTokenPathPage.test.jsx
// Phase 266 Plan 04 — Task 1: TDD tests for Path B info page (teal theme, dual-token disposition)
// R2: page consumes /api/resource-server/identity DIRECTLY (NOT /api/path/dualtoken-info)
// Covers: badge string, accessTokenClaims, idTokenClaims, Back to Dashboard button + nav,
//         401 session expired error, 412 id_token_missing error, emoji-free source assertion.
//
// NOTE: react-router-dom v7 + jsdom requires TextEncoder polyfill before import.
import { TextEncoder, TextDecoder } from "util";

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import bffAxios from "../../services/bffAxios";
import AccessIdTokenPathPage from "../AccessIdTokenPathPage";
import fs from "fs";
import path from "path";
if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Mock bffAxios before importing the component
vi.mock("../../services/bffAxios", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

// Mock react-router-dom — only mock what the component uses
const mockNavigate = jest.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

const mockDualTokenResponse = {
  credentialPath: "dual_token",
  badge: "ACCESS + ID-TOKEN PATH",
  color: "teal",
  accessTokenClaims: {
    sub: "user-uuid-alice",
    aud: "mcpserver.ping.demo",
    scope: "banking:read openid",
    exp: 9999999999,
    act: { sub: "gateway-client-id" },
  },
  idTokenClaims: {
    sub: "user-uuid-alice",
    email: "alice@example.com",
    name: "Alice Demo",
  },
  message:
    "banking_resource_server decoded your access token and id_token. Identity only.",
  returnTo: "/dashboard",
  returnLabel: "Back to Dashboard",
};

function renderPage() {
  return render(<AccessIdTokenPathPage />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Test 4: renders the exact badge string "ACCESS + ID-TOKEN PATH"
test('renders the exact badge string "ACCESS + ID-TOKEN PATH"', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: mockDualTokenResponse });
  renderPage();
  await waitFor(() => {
    expect(screen.getByText("ACCESS + ID-TOKEN PATH")).toBeInTheDocument();
  });
});

// Test 5: fetches /api/resource-server/identity (R2 — NOT /api/path/dualtoken-info)
test("fetches /api/resource-server/identity on mount (R2 direct backend call)", async () => {
  bffAxios.get.mockResolvedValueOnce({ data: mockDualTokenResponse });
  renderPage();
  await waitFor(() =>
    expect(bffAxios.get).toHaveBeenCalledWith("/api/resource-server/identity"),
  );
  expect(bffAxios.get).not.toHaveBeenCalledWith("/api/path/dualtoken-info");
});

// Test 6: renders both accessTokenClaims AND idTokenClaims sections
test("renders Access Token Claims section", async () => {
  bffAxios.get.mockResolvedValueOnce({ data: mockDualTokenResponse });
  renderPage();
  await screen.findByText("Access Token Claims");
});

test("renders ID Token Claims section", async () => {
  bffAxios.get.mockResolvedValueOnce({ data: mockDualTokenResponse });
  renderPage();
  await screen.findByText("ID Token Claims");
});

// Test 7: "Back to Dashboard" button has exact label and navigates to /dashboard
test('"Back to Dashboard" button has exact label and calls navigate("/dashboard")', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: mockDualTokenResponse });
  renderPage();
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Back to Dashboard" }),
    ).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to Dashboard" }));
  expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
});

// Test 8: 412 id_token_missing → clear error message about openid scope
test("shows clear error message when BFF returns 412 (id_token_missing)", async () => {
  bffAxios.get.mockRejectedValueOnce({
    response: {
      status: 412,
      data: { error: "id_token_missing" },
    },
  });
  renderPage();
  await screen.findByText(/does not include an id_token/i);
  expect(screen.getByText(/sign in again/i)).toBeInTheDocument();
});

// Test 9: 401 session expired → clear error message
test("shows clear error message when BFF returns 401 (session expired)", async () => {
  bffAxios.get.mockRejectedValueOnce({
    response: {
      status: 401,
      data: { error: "unauthorized" },
    },
  });
  renderPage();
  await screen.findByText(/session has expired/i);
  expect(screen.getByText(/sign in again/i)).toBeInTheDocument();
});

// Test 10 (partial — jsx file emoji check): verify no emoji in source file
test("AccessIdTokenPathPage.jsx source contains no emoji glyphs (REGRESSION §0)", () => {
  const srcPath = path.resolve(__dirname, "..", "AccessIdTokenPathPage.jsx");
  const src = fs.readFileSync(srcPath, "utf8");
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]/u;
  expect(emojiRegex.test(src)).toBe(false);
});

// Test: 412 error state shows a Back to Dashboard button
test("412 error state shows Back to Dashboard button that navigates to /dashboard", async () => {
  bffAxios.get.mockRejectedValueOnce({
    response: {
      status: 412,
      data: { error: "id_token_missing" },
    },
  });
  renderPage();
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Back to Dashboard" }),
    ).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to Dashboard" }));
  expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
});
