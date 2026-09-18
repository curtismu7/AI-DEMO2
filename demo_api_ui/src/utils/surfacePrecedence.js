export const SURFACE_VALUES = ["none", "embedded", "popout", "both"];

export function surfaceHasEmbedded(surface) {
  return surface === "embedded" || surface === "both";
}

export function isEmbeddedSurfaceDisabled(surface, sequenceSurface) {
  return surfaceHasEmbedded(sequenceSurface) && surfaceHasEmbedded(surface);
}

export function getSurfacePrecedence({ sequenceSurface = "none", movieReelEnabled = true } = {}) {
  const sequenceEmbedded = surfaceHasEmbedded(sequenceSurface);
  return {
    timeline: sequenceEmbedded ? "sequence" : movieReelEnabled ? "movie-reel" : "none",
    sequenceEmbedded,
  };
}
