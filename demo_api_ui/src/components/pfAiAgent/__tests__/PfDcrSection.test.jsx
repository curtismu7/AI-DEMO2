import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "../../../services/apiClient";
import PfDcrSection from "../PfDcrSection";

vi.mock("../../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../FlowDiagram", () => ({ default: () => null }));

const trace = [
  { id: "initial-access-token", title: "Get an initial access token (scope dcr:register)", request: { method: "POST", url: "https://pf.example.test/as/token.oauth2" }, response: { status: 200, body: {} } },
  { id: "register-anonymous", title: "Register with no initial access token", request: { method: "POST", url: "https://pf.example.test/as/clients.oauth2" }, response: { status: 401, body: { error: "invalid_access_token" } } },
];

describe("PfDcrSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is disabled until DCR is configured", () => {
    render(<PfDcrSection ready={false} />);
    expect(screen.queryByRole("button", { name: /register, use and delete/i })).toBeNull();
    expect(screen.getByText(/Enable PF dynamic client registration/)).toBeInTheDocument();
  });

  it("runs the four steps in order and shows what PingFederate refused", async () => {
    apiClient.post
      .mockResolvedValueOnce({ data: { trace: trace.slice(0, 1) } })
      .mockResolvedValueOnce({ data: { trace, clientId: "dc-abc", anonymousRefused: true } })
      .mockResolvedValueOnce({ data: { trace, forbiddenRefused: true } })
      .mockResolvedValueOnce({ data: { trace, deletedRefused: true } });
    render(<PfDcrSection ready />);
    fireEvent.click(screen.getByRole("button", { name: /register, use and delete/i }));

    expect(await screen.findByTestId("dcr-proof")).toBeInTheDocument();
    expect(apiClient.post.mock.calls.map(([url]) => url)).toEqual([
      "/api/pf-ai-agent/dcr/initial-token", "/api/pf-ai-agent/dcr/register", "/api/pf-ai-agent/dcr/token", "/api/pf-ai-agent/dcr/delete",
    ]);
    expect(screen.getByText(/refused the registration that carried no initial access token/)).toBeInTheDocument();
    expect(screen.getByText(/registered client dc-abc/)).toBeInTheDocument();
    expect(screen.getByText(/its credentials were refused/)).toBeInTheDocument();
  });

  it("names the BFF's reason when a step fails", async () => {
    apiClient.post.mockRejectedValueOnce({ response: { data: { error: "PF_AI_DCR_IAT_REFUSED", detail: "PingFederate refused the initial access token request (HTTP 401, invalid_client)" } } });
    render(<PfDcrSection ready />);
    fireEvent.click(screen.getByRole("button", { name: /register, use and delete/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("PF_AI_DCR_IAT_REFUSED"));
    expect(screen.getByRole("alert")).toHaveTextContent("invalid_client");
  });
});
