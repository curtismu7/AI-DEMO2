import { diagramLinkProps, isDiagramPath, openDiagram } from "../diagramLinks";

describe("diagram links open in a new tab", () => {
  it.each([
    "/architecture/system",
    "/architecture/pingfederate-id-jag",
    "/demo-arch-slides/id-jag",
    "/use-case-diagrams/UC40",
    "/use-case-diagrams",
    "/diagrams",
    "/sequence-diagram",
    "/digital-worker",
    "/demo-map",
    "/pingfederate-id-jag/diagram",
    "/pingfederate-id-jag/implementation",
    "/agent-onboarding-flow-diagram",
    "/architecture/flow?step=2#top",
  ])("treats %s as a diagram", (p) => {
    expect(isDiagramPath(p)).toBe(true);
    expect(diagramLinkProps(p)).toEqual({ target: "_blank", rel: "noopener noreferrer" });
  });

  it.each(["/", "/dashboard", "/pingfederate-id-jag", "/pingfederate-id-jag/demo", "/use-cases", "/admin", "/learning", undefined, null])(
    "leaves %s as a normal link",
    (p) => {
      expect(isDiagramPath(p)).toBe(false);
      expect(diagramLinkProps(p)).toEqual({});
    },
  );

  it("openDiagram opens a new tab without handing it window.opener", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    openDiagram("/architecture/token-flow");
    expect(open).toHaveBeenCalledWith("/architecture/token-flow", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});
