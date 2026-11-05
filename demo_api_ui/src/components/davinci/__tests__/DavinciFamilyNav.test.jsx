import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import DavinciFamilyNav from "../DavinciFamilyNav";
import { DAVINCI_FAMILY, DAVINCI_ALIASES } from "../../../config/davinciFamily";

const appSource = fs.readFileSync(path.resolve(__dirname, "../../../App.js"), "utf8");
const routePaths = new Set([...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));

describe("DavinciFamilyNav", () => {
  it("lists the four demos in teaching order with real hrefs", () => {
    render(<DavinciFamilyNav current="widget" />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/davinci-sdk", "/davinci-widget", "/davinci-orchestration-sdk", "/pingfederate-davinci-kit",
    ]);
  });

  it("marks only the current page with aria-current", () => {
    render(<DavinciFamilyNav current="sdk" />);
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/davinci-orchestration-sdk");
  });

  it("has a nav landmark", () => {
    render(<DavinciFamilyNav current="pf-kit" />);
    expect(screen.getByRole("navigation", { name: "DaVinci demos" })).toBeInTheDocument();
  });
});

describe("DaVinci routes", () => {
  it.each(DAVINCI_FAMILY.map((f) => [f.path]))("switcher link %s is a registered route", (p) => {
    expect(routePaths.has(p)).toBe(true);
  });

  it.each(DAVINCI_ALIASES.map((a) => [a.from, a.to]))("alias %s redirects to canonical %s", (from, to) => {
    const canonical = DAVINCI_FAMILY.map((f) => f.path);
    expect(canonical).toContain(to);
    expect(appSource).toMatch(new RegExp(`<Route path="${from}" element=\\{<Navigate to="${to}" replace />\\}`));
  });

  it("no alias path is also a canonical path", () => {
    const canonical = new Set(DAVINCI_FAMILY.map((f) => f.path));
    DAVINCI_ALIASES.forEach((a) => expect(canonical.has(a.from)).toBe(false));
  });
});

describe("nav surfaces use canonical DaVinci paths only", () => {
  const aliases = DAVINCI_ALIASES.map((a) => a.from);
  const files = [
    "../../../config/navPagePaths.js",
    "../../../components/AdminSideNav.jsx",
    "../../../utils/educationalPages.js",
    "../../../config/diagramsIndex.js",
    "../../AIAgent.js",
  ];
  it.each(files)("%s has no alias path", (rel) => {
    const src = fs.readFileSync(path.resolve(__dirname, rel), "utf8");
    aliases.forEach((a) => {
      expect(src).not.toMatch(new RegExp(`["'\`]${a}["'\`]`));
    });
  });
});
