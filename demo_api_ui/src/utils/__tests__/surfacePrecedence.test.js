import {
  getSurfacePrecedence,
  isEmbeddedSurfaceDisabled,
  surfaceHasEmbedded,
} from "../surfacePrecedence";

describe("surface precedence", () => {
  it("uses Sequence as the timeline when its embedded surface is active", () => {
    expect(getSurfacePrecedence({ sequenceSurface: "both", movieReelEnabled: true })).toEqual({
      timeline: "sequence",
      sequenceEmbedded: true,
    });
  });

  it("keeps Movie Reel as the timeline when Sequence is pop-out only", () => {
    expect(getSurfacePrecedence({ sequenceSurface: "popout", movieReelEnabled: true })).toEqual({
      timeline: "movie-reel",
      sequenceEmbedded: false,
    });
  });

  it("disables competing embedded surfaces only while Sequence is embedded", () => {
    expect(isEmbeddedSurfaceDisabled("both", "embedded")).toBe(true);
    expect(isEmbeddedSurfaceDisabled("embedded", "both")).toBe(true);
    expect(isEmbeddedSurfaceDisabled("popout", "both")).toBe(false);
    expect(isEmbeddedSurfaceDisabled("both", "popout")).toBe(false);
  });

  it("recognizes the three selectable surface modes", () => {
    expect(surfaceHasEmbedded("embedded")).toBe(true);
    expect(surfaceHasEmbedded("both")).toBe(true);
    expect(surfaceHasEmbedded("popout")).toBe(false);
    expect(surfaceHasEmbedded("none")).toBe(false);
  });
});
