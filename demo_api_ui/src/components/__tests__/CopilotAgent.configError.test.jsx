/**
 * A config-load failure was collapsed into the same empty object used for
 * "feature not configured" -- `loadPublicConfig().catch(() => setCfg({}))`.
 * isCopilotConfigured({}) is false either way, so a transient fetch failure
 * rendered the permanent "not configured" message, even if Copilot Studio is
 * fully configured server-side.
 */
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const loadPublicConfig = vi.fn();
vi.mock("../../services/configService", () => ({
  loadPublicConfig: (...a) => loadPublicConfig(...a),
}));
vi.mock("../../copilot/copilotClient", () => ({
  conversationIdFrom: vi.fn(),
  isCopilotConfigured: (cfg) => !!(cfg && cfg.copilot_entra_client_id),
  messageTextsFrom: vi.fn(() => []),
  signInAndCreateClient: vi.fn(),
}));

import CopilotAgent from "../CopilotAgent";

beforeEach(() => {
  loadPublicConfig.mockReset();
});

describe("CopilotAgent — config load failure vs genuinely unconfigured", () => {
  it("shows a retryable error, not the permanent 'not configured' message, when the config fetch fails", async () => {
    loadPublicConfig.mockRejectedValue(new Error("Network request failed"));
    render(<CopilotAgent />);

    await waitFor(() => expect(screen.getByText(/Could not load configuration/i)).toBeInTheDocument());
    expect(screen.queryByText(/not configured yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("retry re-fetches and shows the real (configured) surface on success", async () => {
    loadPublicConfig
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce({ copilot_entra_client_id: "x" });
    render(<CopilotAgent />);

    const retryBtn = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retryBtn);

    await waitFor(() => expect(screen.getByText(/Sign in with Microsoft/i)).toBeInTheDocument());
  });

  it("still shows the permanent 'not configured' message when the config genuinely loads empty", async () => {
    loadPublicConfig.mockResolvedValue({});
    render(<CopilotAgent />);

    await waitFor(() => expect(screen.getByText(/not configured yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/Could not load configuration/i)).not.toBeInTheDocument();
  });
});
