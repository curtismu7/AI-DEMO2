import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import IdJagPathBar, { ID_JAG_PATH } from "../IdJagPathBar";

const renderBar = (current) => render(<MemoryRouter><IdJagPathBar current={current} /></MemoryRouter>);

describe("ID-JAG learning path bar", () => {
  it("lists the four stops in order and marks the current one", () => {
    renderBar("run");
    const links = screen.getAllByRole("link").filter((a) => a.closest(".idjag-path__stops"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(ID_JAG_PATH.map((s) => s.to));
    expect(screen.getByRole("link", { name: /Run it/ })).toHaveAttribute("aria-current", "step");
  });

  it("offers Back and Next to the neighbouring stops", () => {
    renderBar("protocol");
    expect(screen.getByRole("link", { name: "Back: Run it" })).toHaveAttribute("href", "/pingfederate-id-jag/demo");
    expect(screen.getByRole("link", { name: "Next: See how we built it" })).toHaveAttribute("href", "/pingfederate-id-jag/implementation");
  });

  it("has no Back on the first stop and no Next on the last", () => {
    const { unmount } = renderBar("explain");
    expect(screen.queryByRole("link", { name: /^Back:/ })).toBeNull();
    unmount();
    renderBar("play");
    expect(screen.queryByRole("link", { name: /^Next:/ })).toBeNull();
  });

  it("opens the diagram stops in a new tab and keeps the others in this tab", () => {
    renderBar("explain");
    const stop = (name) => screen.getAllByRole("link").filter((a) => a.closest(".idjag-path__stops")).find((a) => a.textContent.includes(name));
    expect(stop("See the protocol")).toHaveAttribute("target", "_blank");
    expect(stop("See how we built it")).toHaveAttribute("target", "_blank");
    expect(stop("Run it")).not.toHaveAttribute("target");
    expect(stop("Explain it")).not.toHaveAttribute("target");
  });
});
