// ApiKeyPathPage.test.jsx
// Phase 266 Plan 04 — Task 1: TDD tests for Path A info page (amber theme, API-key disposition)
// Covers: badge string, masked api-key rendering, Back to Dashboard button + navigation,
//         error state, emoji-free source assertion.
//
// NOTE: react-router-dom v7 + jsdom requires TextEncoder polyfill before import.
// We mock useNavigate and render without MemoryRouter (no router context needed
// since we mock the hook). To test navigation calls, mockNavigate is checked directly.
import { TextEncoder, TextDecoder } from "util";

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import bffAxios from "../../services/bffAxios";
import ApiKeyPathPage from "../ApiKeyPathPage";
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

const mockApiKeyResponse = {
  credentialPath: "api_key",
  badge: "API-KEY PATH",
  color: "amber",
  apiKeyMaskedLast4: "XY7Z",
  message:
    "Gateway used the API-key credential path. No banking data is returned.",
  returnTo: "/dashboard",
  returnLabel: "Back to Dashboard",
};

function renderPage() {
  return render(<ApiKeyPathPage />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Test 1: renders the exact badge string "API-KEY PATH"
test('renders the exact badge string "API-KEY PATH"', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: mockApiKeyResponse });
  renderPage();
  await waitFor(() => {
    expect(screen.getByText("API-KEY PATH")).toBeInTheDocument();
  });
});

// Test 2: renders apiKeyMaskedLast4 from the BFF response
test("renders apiKeyMaskedLast4 from the BFF response", async () => {
  bffAxios.get.mockResolvedValueOnce({ data: mockApiKeyResponse });
  renderPage();
  await waitFor(() => {
    expect(screen.getByText(/XY7Z/)).toBeInTheDocument();
  });
});

// Test 3: "Back to Dashboard" button has the exact label and navigates to /dashboard
test('"Back to Dashboard" button has exact label and calls navigate("/dashboard")', async () => {
  bffAxios.get.mockResolvedValueOnce({ data: mockApiKeyResponse });
  renderPage();
  await waitFor(() => {
    const btn = screen.getByRole("button", { name: "Back to Dashboard" });
    expect(btn).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to Dashboard" }));
  expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
});

// Test: fetches /api/path/apikey-info (Path A info marker — gateway-only)
test("fetches /api/path/apikey-info on mount", async () => {
  bffAxios.get.mockResolvedValueOnce({ data: mockApiKeyResponse });
  renderPage();
  await waitFor(() => {
    expect(bffAxios.get).toHaveBeenCalledWith("/api/path/apikey-info");
  });
});

// Test: renders error state when BFF returns an error
test("renders error state when BFF fetch fails", async () => {
  bffAxios.get.mockRejectedValueOnce({
    response: { data: { error: "fetch_failed" } },
  });
  renderPage();
  await waitFor(() => {
    expect(
      screen.getByText(/Unable to load API-key path info/),
    ).toBeInTheDocument();
  });
});

// Test: error state also shows a Back to Dashboard button that navigates to /dashboard
test("error state shows a Back to Dashboard button that navigates to /dashboard", async () => {
  bffAxios.get.mockRejectedValueOnce({
    response: { data: { error: "fetch_failed" } },
  });
  renderPage();
  await waitFor(() => {
    const btn = screen.getByRole("button", { name: "Back to Dashboard" });
    expect(btn).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to Dashboard" }));
  expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
});

// Test 10 (partial — jsx file emoji check): verify no emoji in source file
test("ApiKeyPathPage.jsx source contains no emoji glyphs (REGRESSION §0)", () => {
  const srcPath = path.resolve(__dirname, "..", "ApiKeyPathPage.jsx");
  const src = fs.readFileSync(srcPath, "utf8");
  // Matches emoji codepoints U+1F300-U+1F9FF
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]/u;
  expect(emojiRegex.test(src)).toBe(false);
});
