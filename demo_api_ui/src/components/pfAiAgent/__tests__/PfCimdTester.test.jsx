import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "../../../services/apiClient";
import PfCimdTester from "../PfCimdTester";

vi.mock("../../../services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe("PfCimdTester", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks PingFederate discovery on the server side", async () => {
    apiClient.post.mockResolvedValueOnce({ data: { issuer: "https://pf.example.test", checks: [{ name: "client_id_metadata_document_supported", ok: true, value: true }], trace: [] } });
    render(<PfCimdTester ready />);
    fireEvent.click(screen.getByRole("button", { name: /check pingfederate discovery/i }));
    expect(await screen.findByTestId("cimd-tester-server")).toHaveTextContent("Pass client_id_metadata_document_supported");
    expect(apiClient.post).toHaveBeenCalledWith("/api/pf-ai-agent/cimd/tester/server", {});
    expect(screen.getByRole("link", { name: /sign in with cimd/i })).toHaveAttribute("href", "/api/pf-ai-agent/cimd/start");
  });

  it("sends a pasted document as text and shows the findings", async () => {
    apiClient.post.mockResolvedValueOnce({ data: { source: "pasted", valid: false, errors: [{ path: "token_endpoint_auth_method", message: "needs a shared secret" }], warnings: [] } });
    render(<PfCimdTester ready />);
    fireEvent.click(screen.getByRole("tab", { name: /test a document/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: '{"client_id":"x"}' } });
    fireEvent.click(screen.getByRole("button", { name: /check the pasted document/i }));
    expect(await screen.findByTestId("cimd-tester-findings")).toHaveTextContent("Not a valid client ID metadata document");
    expect(apiClient.post).toHaveBeenCalledWith("/api/pf-ai-agent/cimd/tester/client", { document: '{"client_id":"x"}' });
  });

  it("shows PingFederate's own verdict for each probe", async () => {
    apiClient.post.mockResolvedValueOnce({ data: { results: [
      { id: "valid", title: "This app's document", expect: "accept", pfSays: "Sign-in page shown: client accepted", asExpected: true, trace: { id: "probe-valid", title: "x" } },
      { id: "redirect-not-listed", title: "Unlisted redirect", expect: "refuse", pfSays: "400 - Invalid redirect_uri", asExpected: true, trace: { id: "probe-r", title: "y" } },
    ] } });
    render(<PfCimdTester ready />);
    fireEvent.click(screen.getByRole("tab", { name: /test a document/i }));
    fireEvent.click(screen.getByRole("button", { name: /ask pingfederate/i }));
    expect(await screen.findByText("400 - Invalid redirect_uri")).toBeInTheDocument();
  });

  it("says when CIMD is not configured", () => {
    render(<PfCimdTester ready={false} />);
    expect(screen.getByText(/Enable PF CIMD to run the tester/)).toBeInTheDocument();
  });
});
