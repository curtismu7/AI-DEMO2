// Every alternate sign-in screen offers the app's main sign-in pop-up, which can
// send a device code or an approval link. Clicking it must call openSignIn
// (which opens PiFlowSignInModal when drivable, else redirects).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openSignIn } from "../../utils/signInService";
import SdkLoginPage from "../../pages/SdkLoginPage";
import DavinciSdkLoginPage from "../../pages/DavinciSdkLoginPage";
import DavinciLoginWidget from "../../pages/DavinciLoginWidget";
import DavinciLoginGuidePage from "../../pages/DavinciLoginGuidePage";
import AicLoginToggle from "../AicLoginToggle";
import bffAxios from "../../services/bffAxios";

vi.mock("../../utils/signInService", () => ({ openSignIn: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../lib/oidcSdkClient", () => ({
  getSdkClient: vi.fn().mockResolvedValue({ token: { get: vi.fn().mockResolvedValue({ error: "no_tokens" }) } }),
  isSdkError: (r) => !r || Boolean(r?.error),
}));
vi.mock("../../lib/davinciSdkClient", () => ({
  fetchSdkConfig: vi.fn().mockResolvedValue({ clientId: "c", nonce: "n", flowPolicyId: "p" }),
  initClient: vi.fn().mockReturnValue(new Promise(() => {})),
  postCallback: vi.fn(),
  takePkceVerifier: vi.fn(),
  signOutOfPingOne: vi.fn(),
}));
vi.mock("../../lib/davinciWidgetClient", () => ({
  fetchWidgetConfig: vi.fn().mockReturnValue(new Promise(() => {})),
  loadWidget: vi.fn(),
  postWidgetSession: vi.fn(),
  refreshWidgetSessionIfNeeded: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../services/bffAxios", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const LINK = { name: /sign in with a device or an approval link/i };

describe("Sign in with a device or an approval link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bffAxios.get.mockResolvedValue({ data: { config: { oauth_provider: "pingone", aic_login_enabled: "true" } } });
  });

  it.each([
    ["SdkLoginPage", () => <SdkLoginPage />],
    ["DavinciSdkLoginPage", () => <DavinciSdkLoginPage />],
    ["DavinciLoginWidget", () => <DavinciLoginWidget />],
    ["DavinciLoginGuidePage", () => <DavinciLoginGuidePage />],
    ["AicLoginToggle", () => <AicLoginToggle />],
  ])("%s offers it and opens the main sign-in", async (_name, ui) => {
    const user = userEvent.setup();
    render(ui());
    await user.click(await screen.findByRole("button", LINK));
    await waitFor(() => expect(openSignIn).toHaveBeenCalledWith({ returnTo: "/", force: true }));
  });

  it("AicLoginToggle hides the link once signed in", async () => {
    render(<AicLoginToggle signedIn />);
    await screen.findByRole("button", { name: /toggle aic customer sign-in/i });
    expect(screen.queryByRole("button", LINK)).toBeNull();
  });
});
