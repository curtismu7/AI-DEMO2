import { describe, it, expect } from "vitest";
import { appRendersSideNav, shellRendersSideNav } from "../sideNavOwner";

const user = { id: "demoUser" };

/**
 * The invariant: for any (route, user), exactly ONE of App.js / AppShell
 * renders the side nav. Before the fix both did, so every AppShell route
 * (/use-cases, /oauth-academy, …) painted two sidebars.
 */
describe("side-nav ownership", () => {
  const cases = [
    // [pathname, user, who should own it]
    ["/use-cases", user, "app"], // was the visible double-sidebar bug
    ["/oauth-academy", user, "app"],
    ["/privilege-demo", user, "app"],
    ["/dashboard", user, "app"],
    ["/learning/", user, "app"], // trailing slash normalizes
    ["/api-traffic", user, "shell"], // no-chrome route: App.js opts out
    ["/logs", user, "shell"], // no-chrome route: App.js opts out
    ["/agent", user, "shell"],
    ["/sdk-login", user, "shell"],
    ["/", user, "shell"], // home is full-bleed: App.js opts out
    ["/use-cases", null, "shell"], // logged out: App.js opts out
    ["/self-service", null, "shell"],
  ];

  it.each(cases)("%s (user=%s) is owned by %s", (pathname, u, owner) => {
    expect(appRendersSideNav({ pathname, user: u })).toBe(owner === "app");
    expect(shellRendersSideNav({ pathname, user: u })).toBe(owner === "shell");
  });

  it("never lets both render one (no duplicate sidebar)", () => {
    for (const [pathname, u] of cases) {
      const both =
        appRendersSideNav({ pathname, user: u }) &&
        shellRendersSideNav({ pathname, user: u });
      expect(both).toBe(false);
    }
  });

  it("CIBA approve page has no side nav from App or Shell", () => {
    expect(appRendersSideNav({ pathname: "/ciba-approve", user })).toBe(false);
    expect(shellRendersSideNav({ pathname: "/ciba-approve", user })).toBe(false);
  });
});
