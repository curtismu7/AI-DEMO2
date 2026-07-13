// demo_api_ui/src/components/__tests__/BankingChips.fallback.test.jsx
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BankingChips from "../BankingChips";

// Mock the vertical context
let mockPageManifest = {
  identity: { displayName: "TestUser" },
  dashboard: {
    chips10: [
      { id: "m1", label: "Manifest Chip", message: "manifest chip action", mode: "both", tool: "test_tool", useCaseId: "test_use_case" },
    ],
  },
};

vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    pageManifest: mockPageManifest,
  }),
}));

// Mock the session token context
let mockToken = { hasActiveToken: true, tokenLoading: false, staleSession: false };
vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => mockToken,
}));

describe("BankingChips fallback resolution", () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mockToken = { hasActiveToken: true, tokenLoading: false, staleSession: false };
    mockPageManifest = {
      identity: { displayName: "TestUser" },
      dashboard: {
        chips10: [
          { id: "m1", label: "Manifest Chip", message: "manifest chip action", mode: "both", tool: "test_tool", useCaseId: "test_use_case" },
        ],
      },
    };
  });

  it("should render manifest chips when dashboard.chips10 is available", async () => {
    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        onChipClick={() => {}}
        userPrompt="test prompt"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Manifest Chip")).toBeInTheDocument();
    });

    // Should NOT call fetch when manifest is available
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should use fallback resolver when dashboard.chips10 is missing", async () => {
    mockPageManifest.dashboard = {}; // Remove chips10

    const fallbackChips = [
      { id: "fb1", label: "Fallback Chip", message: "fallback action", mode: "both", tool: "fallback_tool", useCaseId: "fallback_use_case" },
    ];

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chips: fallbackChips,
        verticalId: "banking",
        isFallback: true,
        detectionMethod: "default",
      }),
    });

    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        onChipClick={() => {}}
        userPrompt="show my accounts"
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/fallback/chips"),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Fallback Chip")).toBeInTheDocument();
    });
  });

  it("should show FallbackBadge when using fallback chips", async () => {
    mockPageManifest.dashboard = {}; // Remove chips10

    const fallbackChips = [
      { id: "fb1", label: "Fallback Chip", message: "fallback action", mode: "both", tool: "fallback_tool", useCaseId: "fallback_use_case" },
    ];

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chips: fallbackChips,
        verticalId: "retail",
        isFallback: true,
        detectionMethod: "parsed",
      }),
    });

    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        onChipClick={() => {}}
        userPrompt="show my orders"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Fallback mode/i)).toBeInTheDocument();
    });
  });

  it("should pass userPrompt to fallback API endpoint", async () => {
    mockPageManifest.dashboard = {}; // Remove chips10

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chips: [],
        verticalId: "banking",
        isFallback: true,
      }),
    });

    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        onChipClick={() => {}}
        userPrompt="transfer $100"
      />,
    );

    await waitFor(() => {
      const fetchUrl = global.fetch.mock.calls[0][0];
      expect(fetchUrl).toContain("prompt=");
      expect(fetchUrl).toContain("transfer");
    });
  });

  it("should use default to 'hello' when userPrompt is empty", async () => {
    mockPageManifest.dashboard = {}; // Remove chips10

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chips: [],
        verticalId: "banking",
        isFallback: true,
      }),
    });

    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        onChipClick={() => {}}
        userPrompt=""
      />,
    );

    await waitFor(() => {
      const fetchUrl = global.fetch.mock.calls[0][0];
      expect(fetchUrl).toContain("prompt=hello");
    });
  });

  it("should fall back to banking chips when API call fails", async () => {
    mockPageManifest.dashboard = {}; // Remove chips10

    global.fetch.mockRejectedValueOnce(new Error("Network error"));

    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        onChipClick={() => {}}
        userPrompt="test"
      />,
    );

    await waitFor(() => {
      // Should render the default banking chips
      expect(screen.getByText("My accounts")).toBeInTheDocument();
    });
  });

  it("should ensure all chips have useCaseId field", async () => {
    mockPageManifest.dashboard = {}; // Remove chips10

    const fallbackChips = [
      { id: "fb1", label: "Chip 1", message: "action 1", mode: "both", tool: "tool1", useCaseId: "use_case_1" },
      { id: "fb2", label: "Chip 2", message: "action 2", mode: "both", tool: "tool2", useCaseId: "use_case_2" },
    ];

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chips: fallbackChips,
        verticalId: "banking",
        isFallback: true,
      }),
    });

    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        onChipClick={() => {}}
        userPrompt="test"
      />,
    );

    await waitFor(() => {
      const chip1 = screen.getByText("Chip 1").closest("button");
      const chip2 = screen.getByText("Chip 2").closest("button");
      expect(chip1).toBeInTheDocument();
      expect(chip2).toBeInTheDocument();
    });
  });

  it("should allow dismissing the fallback badge", async () => {
    mockPageManifest.dashboard = {}; // Remove chips10

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chips: [
          { id: "fb1", label: "Fallback Chip", message: "action", mode: "both", tool: "tool", useCaseId: "uc" },
        ],
        verticalId: "banking",
        isFallback: true,
      }),
    });

    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        onChipClick={() => {}}
        userPrompt="test"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Fallback mode/i)).toBeInTheDocument();
    });

    const closeBtn = screen.getByRole("button", { name: /dismiss/i });
    await userEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Fallback mode/i)).not.toBeInTheDocument();
    });
  });

  it("should update fallback chips when userPrompt changes", async () => {
    mockPageManifest.dashboard = {}; // Remove chips10

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chips: [
          { id: "fb1", label: "Banking Chip", message: "transfer", mode: "both", tool: "tool", useCaseId: "uc" },
        ],
        verticalId: "banking",
        isFallback: true,
      }),
    });

    const { rerender } = render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        onChipClick={() => {}}
        userPrompt="transfer $100"
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Clear and set up new mock for second call
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chips: [
          { id: "fb2", label: "Retail Chip", message: "show orders", mode: "both", tool: "tool", useCaseId: "uc" },
        ],
        verticalId: "retail",
        isFallback: true,
      }),
    });

    // Rerender with new userPrompt
    rerender(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        onChipClick={() => {}}
        userPrompt="show my orders"
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
