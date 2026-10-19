import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { get, post, openSignIn } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), openSignIn: vi.fn() }));
vi.mock("../../services/bffAxios", () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock("../../utils/signInService", () => ({ openSignIn }));

import IdJagPlaygroundPage from "../IdJagPlaygroundPage";

const config = {
  provider: "pingfederate", enabled: true, signedIn: false,
  idp: { name: "PingFederate", issuer: "https://pf.test", tokenEndpoint: "https://pf.test/as/token.oauth2", jwksUrl: "", exchangeClientId: "c" },
  resourceAs: { name: "oauth-mcp", issuer: "https://as.test", tokenEndpoint: "https://as.test/token", clientId: "d" },
  request: { resource: "https://as.test/mcp", scope: "mcp:invoke" },
};

it("sign-in goes through the app's sign-in service (pi.flow modal), never forcing the redirect page", async () => {
  get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/config") ? config : url.endsWith("/preflight") ? { ok: true, checks: [] } : [] }));
  post.mockResolvedValue({ data: {} });
  render(<MemoryRouter><IdJagPlaygroundPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with PingFederate" }));
  await vi.waitFor(() => expect(openSignIn).toHaveBeenCalled());
  const args = openSignIn.mock.calls[0][0];
  expect(args).toEqual({ returnTo: "/pingfederate-id-jag/playground", force: true });
  expect(args.redirect).toBeUndefined();
});
