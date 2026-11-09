import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PingOnePlatformConfigPage from "../PingOnePlatformConfigPage";

const renderPage = () => render(<MemoryRouter><PingOnePlatformConfigPage /></MemoryRouter>);

describe("PingOne platform config (Ping UI Standard)", () => {
  it("keeps the page testid on the root and adds no second main landmark", () => {
    const { container } = renderPage();
    const root = screen.getByTestId("pingone-platform-config");
    expect(root).toHaveClass("pu-page", "p1platform");
    expect(container.querySelector("main")).toBeNull();
  });

  it("puts a banner first that says the page is static and never calls PingOne", () => {
    const { container } = renderPage();
    const banner = screen.getByTestId("p1platform-banner");
    expect(banner).toHaveAttribute("role", "note");
    expect(banner.textContent).toMatch(/never calls PingOne/i);
    expect(banner.textContent).not.toMatch(/\bconfigured\b/i);
    expect(container.querySelector(".pu-page").firstElementChild.contains(banner)).toBe(true);
  });

  it("renders four groups plus caveats as labelled sections, one card per object", () => {
    const { container } = renderPage();
    const sections = container.querySelectorAll("section[aria-labelledby^='p1platform-']");
    expect(sections).toHaveLength(5);
    const resources = container.querySelector("section[aria-labelledby='p1platform-resources']");
    expect(resources.querySelectorAll(".pu-card")).toHaveLength(8);
    expect(within(resources).getByRole("heading", { level: 3, name: "Demo API" })).toBeInTheDocument();
    const apps = container.querySelector("section[aria-labelledby='p1platform-apps']");
    expect(apps.querySelectorAll(".pu-card")).toHaveLength(13);
  });

  it("shows audience and type as a key-value pair, and nothing for the groups without a key", () => {
    const { container } = renderPage();
    const resources = container.querySelector("section[aria-labelledby='p1platform-resources']");
    const firstKv = resources.querySelector(".pu-card .pu-kv");
    expect(firstKv.querySelector("dt").textContent).toBe("Audience");
    expect(firstKv.querySelector("dd code").textContent).toBe("enduser.ping.demo");
    const apps = container.querySelector("section[aria-labelledby='p1platform-apps']");
    expect(apps.querySelector(".pu-kv dt").textContent).toBe("Type");
    const users = container.querySelector("section[aria-labelledby='p1platform-users-groups']");
    expect(users.querySelector(".pu-kv")).toBeNull();
  });

  it("gives every chip a word, and says so where a row is flag-gated or not provisioned", () => {
    const { container } = renderPage();
    container.querySelectorAll(".pu-chip").forEach((chip) => {
      expect(chip.textContent.trim().length).toBeGreaterThan(0);
    });
    const dv = container.querySelector("section[aria-labelledby='p1platform-davinci-protect']");
    const chipFor = (title) =>
      within(within(dv).getByRole("heading", { level: 3, name: title }).closest(".pu-card")).getByText(/.+/, {
        selector: ".pu-chip",
      }).textContent;
    expect(chipFor("PingOne Protect")).toBe("Not provisioned");
    expect(chipFor("DaVinci orchestration showcase (flag off by default)")).toBe("Flag off by default");
    // Rows the provisioning code does NOT create must not carry the "From provisioning code" word.
    expect(chipFor("DaVinci CIBA flow policies")).toBe("Set up in console");
    // No chip claims a live "configured" or "present" state: the page never calls PingOne.
    expect([...container.querySelectorAll(".pu-chip--ok")]).toHaveLength(0);
  });

  it("does not say 'From provisioning code' on rows the provisioning code does not create", () => {
    const { container } = renderPage();
    const chipByTitle = (title) =>
      [...container.querySelectorAll(".pu-card")]
        .find((c) => c.querySelector(".pu-h3, h3")?.textContent === title)
        ?.querySelector(".pu-chip")?.textContent;
    expect(chipByTitle("Autonomous agents (Fraud Watch, Balance Sweep)")).toBe("Opt-in script");
    expect(chipByTitle("Demo AI App - CIBA (+ CIBA SMS)")).toBe("Set up in console");
    expect(chipByTitle("Admin role \u2014 NOT groups")).toBe("Resolver, not an object");
    expect(chipByTitle("PingOne Verify / MFA / Recognize")).toBe("Flag-gated or external");
    // The default rows still say where they come from.
    expect(chipByTitle("Demo API")).toBe("From provisioning code");
    for (const c of container.querySelectorAll(".pu-chip")) expect(c.className).not.toMatch(/pu-chip--(ok|good|success)/);
  });

  it("does not claim that everything is created by bootstrapPingOne", () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/Everything is created by bootstrapPingOne/);
    expect(container.textContent).toMatch(/Most of it is created by bootstrapPingOne/);
  });

  it("keeps list semantics on the card grids (list-style none drops them in Safari/VoiceOver)", () => {
    const { container } = renderPage();
    const lists = container.querySelectorAll("ul.p1platform__rows");
    expect(lists).toHaveLength(4);
    lists.forEach((ul) => expect(ul).toHaveAttribute("role", "list"));
  });

  it("has exactly one primary, the PingOne setup link, in the Ping Red primary class", () => {
    const { container } = renderPage();
    const primaries = container.querySelectorAll(".pu-btn--primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveAttribute("href", "/pingone-setup");
    expect(screen.getByRole("link", { name: "PingOne setup" })).toBe(primaries[0]);
  });

  it("uses no inline styles", () => {
    const { container } = renderPage();
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
