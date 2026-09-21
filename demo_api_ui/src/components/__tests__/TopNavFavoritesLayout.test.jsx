import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import TopNav from "../TopNav";

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/dashboard" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("../../context/SessionTokenContext", () => ({
  useSessionToken: () => ({
    tokenSecondsLeft: null,
    tokenLoading: false,
    sessionType: null,
    staleSession: false,
    hasActiveToken: false,
    openTokenModal: null,
  }),
}));

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));

vi.mock("../../hooks/useRoleSwitch", () => ({
  useRoleSwitch: () => ({ switching: false, switchRole: vi.fn() }),
}));

vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({ pageManifest: { identity: { displayName: "Test" } } }),
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

describe("TopNav Favorites dropdown", () => {
  it("renders the Ping Identity logo at the far left of the main header", () => {
    render(<TopNav user={null} onLogout={vi.fn()} />);

    const logo = screen.getByRole("img", { name: "Ping Identity" });
    expect(logo).toHaveAttribute("src", "/assets/ping-identity-logo.png");
    expect(logo.parentElement).toHaveClass("topnav-ping-identity");
  });

  it("renders outside the horizontal scroll container so the dropdown is not clipped", () => {
    render(<TopNav user={null} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));

    const favoritesRoot = document.querySelector(".fav-menu");
    expect(document.querySelector(".fav-menu-dropdown")).toBeInTheDocument();
    expect(favoritesRoot?.parentElement).toHaveClass("topnav-right");
    expect(favoritesRoot?.parentElement).not.toHaveClass("topnav-right-scroll");
  });
});
