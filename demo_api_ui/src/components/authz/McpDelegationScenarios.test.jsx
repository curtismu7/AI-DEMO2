import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/apiClient", () => ({ default: { post: vi.fn() } }));

import apiClient from "../../services/apiClient";
import McpDelegationScenarios from "./McpDelegationScenarios";

describe("McpDelegationScenarios", () => {
  beforeEach(() => apiClient.post.mockReset());

  test("renders the 6 MCP scenario cards", () => {
    render(<McpDelegationScenarios configured />);
    expect(screen.getByText("Valid tool call")).toBeInTheDocument();
    expect(screen.getByText("Invalid token audience")).toBeInTheDocument();
    expect(screen.getByText("Missing user id")).toBeInTheDocument();
    expect(screen.getByText("Invalid actor chain")).toBeInTheDocument();
    expect(screen.getByText("Not in required group")).toBeInTheDocument();
    expect(screen.getByText("Consent-gated tool")).toBeInTheDocument();
  });

  test("not configured disables the Run buttons", () => {
    render(<McpDelegationScenarios configured={false} />);
    for (const b of screen.getAllByRole("button", { name: /Run live/i })) expect(b).toBeDisabled();
  });

  test("bad-audience card posts overridden TokenAudience and renders DENY + statement", async () => {
    apiClient.post.mockResolvedValue({ data: { ok: true, engine: "pingone", decision: "DENY", statements: ["mcp-invalid-audience"], raw: {} } });
    render(<McpDelegationScenarios configured />);
    const card = screen.getByText("Invalid token audience").closest(".mds-card");
    fireEvent.click(card.querySelector("button"));
    await waitFor(() => expect(screen.getByText("DENY")).toBeInTheDocument());
    expect(screen.getByText("mcp-invalid-audience")).toBeInTheDocument();
    const [url, body] = apiClient.post.mock.calls[0];
    expect(url).toBe("/api/authorize/test-mcp-live");
    expect(body.parameters.TokenAudience).toBe("https://attacker.example");
    expect(body.parameters.DecisionContext).toBe("McpFirstTool");
  });
});
