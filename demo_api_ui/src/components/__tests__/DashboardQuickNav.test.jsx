import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DashboardQuickNav from "../DashboardQuickNav";

/**
 * The stack height is owned by CSS: `--quick-nav-stack-height` resolves to
 * `calc(7 * var(--stack-fab-height))`. That multiplier must match the number of
 * buttons a non-admin actually renders. This test locks that count at 7 so that
 * adding or removing a quick-nav button fails here — a reminder to update the
 * CSS multiplier in App.css alongside the JSX.
 */
function renderNav(user, path = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DashboardQuickNav user={user} />
    </MemoryRouter>,
  );
}

test("non-admin renders exactly 7 quick-nav buttons (matches the CSS 7x stack)", () => {
  renderNav({ role: "user" });
  const nav = screen.getByRole("navigation", { name: /quick navigation/i });
  const buttons = nav.querySelectorAll(".dashboard-quick-nav__btn");
  expect(buttons).toHaveLength(7);
  expect(Array.from(buttons).map((b) => b.textContent.trim())).toEqual([
    "Home",
    "Dashboard",
    "Agent",
    "Settings",
    "Learning Log",
    "API",
    "Logs",
  ]);
});

test("admin does not render the quick nav (AdminSideNav is used instead)", () => {
  renderNav({ role: "admin" }, "/admin");
  expect(
    screen.queryByRole("navigation", { name: /quick navigation/i }),
  ).not.toBeInTheDocument();
});

// The rail is mounted app-wide (App.js) gated on a signed-in non-admin being on
// a DashboardQuickNav route. These lock the render contract App.js relies on.
test("renders the rail for a signed-in non-admin on a gated route", () => {
  renderNav({ role: "user" }, "/dashboard");
  expect(
    screen.getByRole("navigation", { name: /quick navigation/i }),
  ).toBeInTheDocument();
});

test("does not render on a non-gated route", () => {
  renderNav({ role: "user" }, "/self-service");
  expect(
    screen.queryByRole("navigation", { name: /quick navigation/i }),
  ).not.toBeInTheDocument();
});

test("does not render when signed out (no user)", () => {
  renderNav(null, "/dashboard");
  expect(
    screen.queryByRole("navigation", { name: /quick navigation/i }),
  ).not.toBeInTheDocument();
});
