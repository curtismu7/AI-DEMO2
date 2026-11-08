import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PingFederateConfigByUseCasePage from "../PingFederateConfigByUseCasePage";

const renderPage = () => render(<MemoryRouter><PingFederateConfigByUseCasePage /></MemoryRouter>);

describe("PingFederate config by use case (Ping UI Standard)", () => {
  it("keeps the page testid on the root and adds no second main landmark", () => {
    const { container } = renderPage();
    const root = screen.getByTestId("pingfederate-config-by-use-case");
    expect(root).toHaveClass("pu-page", "pfconfig");
    expect(container.querySelector("main")).toBeNull();
  });

  it("puts a banner first that says the page is static and never calls PingFederate", () => {
    const { container } = renderPage();
    const banner = screen.getByTestId("pfconfig-banner");
    expect(banner).toHaveAttribute("role", "note");
    expect(banner.textContent).toMatch(/never calls PingFederate/i);
    expect(banner.textContent).toMatch(/UNVERIFIED/);
    expect(container.querySelector(".pu-page").firstElementChild.contains(banner)).toBe(true);
  });

  it("renders every group as a labelled section with its script and one card per object", () => {
    const { container } = renderPage();
    const groups = container.querySelectorAll("section[aria-labelledby^='pfconfig-']");
    // intro + 5 groups + caveats
    expect(groups.length).toBe(7);
    const core = container.querySelector("section[aria-labelledby='pfconfig-core']");
    expect(within(core).getByText("scripts/pingfederate/provision-core.js")).toBeInTheDocument();
    expect(core.querySelectorAll(".pu-card")).toHaveLength(5);
  });

  it("gives every chip a word and marks only the two scripts that say UNVERIFIED", () => {
    const { container } = renderPage();
    container.querySelectorAll(".pu-chip").forEach((chip) => {
      expect(chip.textContent.trim().length).toBeGreaterThan(0);
    });
    const idjag = container.querySelector("section[aria-labelledby='pfconfig-idjag']");
    const warned = [...idjag.querySelectorAll(".pu-card--warn")].map((c) => c.querySelector("h3").textContent);
    expect(warned).toHaveLength(2);
    expect(warned[0]).toMatch(/^PF-to-PF/);
    expect(warned[1]).toMatch(/^SAML path/);
    const core = container.querySelector("section[aria-labelledby='pfconfig-core']");
    expect(core.querySelector(".pu-card--warn")).toBeNull();
    expect(within(core).getAllByText("From script")).toHaveLength(5);
    expect(within(idjag).getAllByText("Unverified")).toHaveLength(2);
  });

  it("has exactly one primary, the ID-JAG hub link, in the Ping Red primary class", () => {
    const { container } = renderPage();
    const primaries = container.querySelectorAll(".pu-btn--primary");
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveAttribute("href", "/pingfederate-id-jag");
    expect(screen.getByRole("link", { name: "ID-JAG hub" })).toBe(primaries[0]);
  });

  it("uses no inline styles", () => {
    const { container } = renderPage();
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
