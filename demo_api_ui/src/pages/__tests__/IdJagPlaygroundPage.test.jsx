import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../services/bffAxios", () => ({ default: { get, post } }));

import IdJagPlaygroundPage from "../IdJagPlaygroundPage";

const config = (over = {}) => ({
  provider: "pingfederate", enabled: true, signedIn: true,
  idp: { name: "PingFederate", issuer: "https://pf.test", tokenEndpoint: "https://pf.test/as/token.oauth2", jwksUrl: "https://pf.test/pf/JWKS", exchangeClientId: "ai-demo-pf-user" },
  resourceAs: { name: "oauth-mcp", issuer: "https://as.test", tokenEndpoint: "https://as.test/token", clientId: "demo-bff-mcp-client" },
  request: { resource: "https://as.test/mcp", scope: "mcp:invoke" },
  ...over,
});

function mount(cfg) {
  get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/config") ? cfg : [] }));
  return render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
}

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe("ID-JAG playground page", () => {
  it("explains that ID-JAG needs PingFederate when the provider is PingOne", async () => {
    mount(config({ provider: "pingone", signedIn: false }));
    expect(await screen.findByText(/ID-JAG only exists on PingFederate/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request ID-JAG" })).toBeDisabled();
  });

  it("shows a message instead of crashing when the BFF has no playground API", async () => {
    mount("<!doctype html><html></html>");
    expect(await screen.findByText(/does not have the ID-JAG playground API/)).toBeInTheDocument();
  });

  it("issues an ID-JAG and shows the spec check table", async () => {
    mount(config());
    post.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/issue")
        ? { request: { grant_type: "token-exchange" }, response: { issued_token_type: "id-jag" }, token: { header: { typ: "oauth-id-jag+jwt" }, claims: { client_id: "demo-bff-mcp-client" } } }
        : { checks: [
            { id: "typ", label: "Header typ", status: "pass", expected: "oauth-id-jag+jwt", actual: "oauth-id-jag+jwt", rule: "4.1" },
            { id: "lifetime", label: "Lifetime", status: "warn", expected: "<= 300s", actual: "3600s", rule: "4.1" },
          ] },
    }));
    fireEvent.click(await screen.findByRole("button", { name: "Request ID-JAG" }));
    const table = await screen.findByTestId("ijp-checks");
    expect(table).toHaveTextContent("Spec check: 1 of 2 pass");
    expect(table).toHaveTextContent("Header typ");
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/id-jag-playground/inspect", {}));
  });
});
