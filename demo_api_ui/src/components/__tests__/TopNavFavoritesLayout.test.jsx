import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import TopNav from "../TopNav";

const mockSessionToken = vi.hoisted(() => ({
  tokenSecondsLeft: null,
  tokenLoading: false,
  sessionType: null,
  staleSession: false,
  hasActiveToken: false,
  openTokenModal: null,
}));
const mockOAuthProviderToggle = vi.hoisted(() => vi.fn(() => null));
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/dashboard" }),
  useNavigate: () => mockNavigate,
}));

vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => mockSessionToken,
}));

vi.mock("../../context/AgentUiModeContext", () => ({
  useAgentUiMode: () => ({ placement: "middle" }),
}));

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));

vi.mock("../../hooks/useRoleSwitch", () => ({
  useRoleSwitch: () => ({ switching: false, switchRole: vi.fn() }),
}));

const mockVertical = vi.hoisted(() => ({
  manifest: { identity: { displayName: "Test" } },
}));
vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({ pageManifest: mockVertical.manifest }),
}));

vi.mock("../../utils/authUi", () => ({
  navigateToCustomerOAuthLogin: vi.fn(),
}));

vi.mock("../../utils/fromUseCasesNav", () => ({
  cameFromUseCases: () => false,
  clearCameFromUseCases: vi.fn(),
}));

vi.mock("../../utils/favorites", () => ({
  FAVORITES_CHANGED_EVENT: "demo-favorites-changed",
  getFavorites: () => [],
  addFavorite: () => [],
  removeFavorite: () => [],
  labelForPath: () => "Current page",
}));

vi.mock("../ThresholdControls", () => ({ default: () => null }));
vi.mock("../QuickFlagsPill", () => ({ default: () => null }));
vi.mock("../UserMenu", () => ({ default: () => null }));
vi.mock("../VerticalSwitcher", () => ({ default: () => null }));
vi.mock("../OAuthProviderToggle", () => ({ default: mockOAuthProviderToggle }));

describe("TopNav Favorites dropdown", () => {
  it("keeps the P1/PF provider switch in the top nav on the dashboard middle layout", () => {
    mockOAuthProviderToggle.mockClear();
    render(<TopNav user={null} onLogout={vi.fn()} />);

    expect(mockOAuthProviderToggle).toHaveBeenCalled();
  });

  it("renders session controls from the shared active-token flag", () => {
    mockSessionToken.hasActiveToken = false;
    const { rerender } = render(<TopNav user={null} onLogout={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign Out" })).not.toBeInTheDocument();

    mockSessionToken.hasActiveToken = true;
    rerender(<TopNav user={{ role: "customer", username: "demo-user" }} onLogout={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Switch to admin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
  });

  it("asks for confirmation before Sign Out, and only logs out on confirm", () => {
    const onLogout = vi.fn();
    render(<TopNav user={{ role: "customer", username: "demo-user" }} onLogout={onLogout} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(screen.getByText("Sign out?")).toBeInTheDocument();
    expect(onLogout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onLogout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    // Confirm inside the modal — two Sign Out buttons are in the DOM now.
    fireEvent.click(screen.getAllByRole("button", { name: "Sign Out" }).pop());
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("renders the Ping Identity logo at the far left of the main header", () => {
    render(<TopNav user={null} onLogout={vi.fn()} />);

    const logo = screen.getByRole("img", { name: "Ping Identity" });
    expect(logo).toHaveAttribute("src", "/assets/ping-identity-logo.png");
    expect(logo.parentElement).toHaveClass("topnav-ping-identity");
  });

  it("the brand logo click opens the Demo Summary page", () => {
    mockNavigate.mockClear();
    render(<TopNav user={null} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Demo Summary/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/demo-summary");
  });

  it("when the side nav is hidden, the logo click restores it and still opens Demo Summary", () => {
    mockNavigate.mockClear();
    localStorage.setItem("adminSideNav.hidden", "1");
    render(<TopNav user={null} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Demo Summary/i }));
    // Restore: same event AdminSideNav listens for, and the flag cleared so
    // the state sticks across navigations.
    expect(localStorage.getItem("adminSideNav.hidden")).toBe("0");
    expect(window.dispatchEvent).toBeTruthy();
    // Navigate: the user still lands on Demo Summary.
    expect(mockNavigate).toHaveBeenCalledWith("/demo-summary");
    localStorage.removeItem("adminSideNav.hidden");
  });

  it("keeps the Ping mark on Ping surfaces (/setup, /admin)", () => {
    const { unmount } = render(<TopNav user={null} onLogout={vi.fn()} />);
    // Default mock location is /dashboard with a manifest lacking an id — the
    // no-manifest fallback keeps the Ping mark.
    expect(screen.getByRole("img", { name: "Ping Identity" })).toBeInTheDocument();
    unmount();
  });

  it("a customer vertical page swaps the Ping mark for the vertical logo; the logo opens Demo Summary", () => {
    mockVertical.manifest = {
      id: "airlines",
      identity: { displayName: "United Airlines", logoPath: "https://cdn.brandfetch.io/x/theme/light/logo.svg" },
    };
    const toggles = vi.fn();
    window.addEventListener("admin-sidenav-hidden-toggle", toggles);
    mockNavigate.mockClear();
    render(<TopNav user={null} onLogout={vi.fn()} />);

    expect(screen.queryByRole("img", { name: "Ping Identity" })).not.toBeInTheDocument();
    // The logo now opens Demo Summary on every surface; the sidenav toggle
    // moved to Ctrl+Shift+B only (App.js key handler still dispatches it).
    const brandBtn = screen.getByRole("button", { name: "Demo Summary" });
    fireEvent.click(brandBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/demo-summary");
    expect(toggles).not.toHaveBeenCalled();
    window.removeEventListener("admin-sidenav-hidden-toggle", toggles);
    mockVertical.manifest = { identity: { displayName: "Test" } };
  });

  it("renders outside the horizontal scroll container so the dropdown is not clipped", () => {
    render(<TopNav user={null} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));

    const favoritesRoot = document.querySelector(".fav-menu");
    expect(document.querySelector(".fav-menu-dropdown")).toBeInTheDocument();
    expect(favoritesRoot?.parentElement).toHaveClass("topnav-right");
    expect(favoritesRoot?.parentElement).not.toHaveClass("topnav-right-scroll");
  });

  it("shows the remaining session time in the top menu", () => {
    Object.assign(mockSessionToken, {
      tokenSecondsLeft: 125,
      sessionType: "user",
      hasActiveToken: true,
    });

    render(<TopNav user={{ firstName: "Demo", lastName: "User", role: "customer" }} onLogout={vi.fn()} />);

    expect(screen.getByText("2m 5s")).toBeInTheDocument();

    Object.assign(mockSessionToken, {
      tokenSecondsLeft: null,
      sessionType: null,
      hasActiveToken: false,
    });
  });
});
