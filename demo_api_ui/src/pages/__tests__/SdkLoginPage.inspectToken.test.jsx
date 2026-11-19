import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SdkLoginPage from "../SdkLoginPage";
import { getSdkClient, isSdkError } from "../../lib/oidcSdkClient";

vi.mock("../../lib/oidcSdkClient", () => ({
  getSdkClient: vi.fn(),
  isSdkError: vi.fn((result) => !result || Boolean(result?.error)),
}));

function fakeJwt(payload) {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
}

const ACCESS_TOKEN = fakeJwt({ sub: "demo-user", aud: "banking-gateway" });
const ID_TOKEN = fakeJwt({ sub: "demo-user", id_token_marker: "only-in-id-token" });

describe("SdkLoginPage — Inspect token", () => {
  afterEach(() => window.localStorage.removeItem("ai-demo.json.view"));

  beforeEach(() => {
    vi.clearAllMocks();
    // The decoded claims are read as JSON text; the shared JsonPane opens on Form, so save the JSON choice.
    window.localStorage.setItem("ai-demo.json.view", "json");
    isSdkError.mockImplementation((result) => !result || Boolean(result?.error));
    getSdkClient.mockResolvedValue({
      token: {
        get: vi.fn().mockResolvedValue({
          accessToken: ACCESS_TOKEN,
          idToken: ID_TOKEN,
          // no refreshToken — this app is a public SPA client, opaque refresh
          // tokens aren't always issued/stored client-side.
        }),
      },
      user: { info: vi.fn().mockResolvedValue({ sub: "demo-user", name: "Demo User" }) },
    });
  });

  it("shows a tab per token present, and decodes the selected one", async () => {
    const user = userEvent.setup();
    render(<SdkLoginPage />);

    const inspectBtn = await screen.findByRole("button", { name: /^inspect token$/i });
    await user.click(inspectBtn);

    // Only tabs for tokens actually returned should appear.
    expect(screen.getByRole("button", { name: "Access Token" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ID Token" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh Token" })).not.toBeInTheDocument();

    // Defaults to Access Token: encoded shows the raw JWT, decoded shows its claims.
    expect(screen.getByText(ACCESS_TOKEN)).toBeInTheDocument();
    // Rule 24b: the decoded copy under the pane shows aud too; assert at least one (raw + decoded both present).
    expect(screen.getAllByText(/"banking-gateway"/).length).toBeGreaterThanOrEqual(1);

    // Switching tabs swaps both the encoded and decoded views.
    await user.click(screen.getByRole("button", { name: "ID Token" }));
    expect(screen.getByText(ID_TOKEN)).toBeInTheDocument();
    expect(screen.getAllByText(/only-in-id-token/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(ACCESS_TOKEN)).not.toBeInTheDocument();
  });
});
