// Diagram pages always open in a new browser tab, so the page the user was on
// (a run, a lesson, a nav choice) is never lost. One place decides what counts as
// a diagram; every link to one spreads diagramLinkProps(path).

const DIAGRAM_PATHS = [
  /^\/architecture\//,
  /^\/demo-arch-slides\//,
  /^\/use-case-diagrams(\/|$)/,
  /^\/diagrams$/,
  /^\/sequence-diagram$/,
  /^\/digital-worker$/,
  /^\/demo-map$/,
  /^\/invest-dual-auth$/,
  /^\/gateway-enforcement-map$/,
  /^\/resource-server-placement$/,
  /^\/demo-steps-lifeline-audit$/,
  /^\/pingfederate-id-jag\/(diagram|implementation)$/,
  /-diagram(\/|$)/,
];

export function isDiagramPath(path) {
  if (typeof path !== "string") return false;
  const clean = path.split(/[?#]/)[0];
  return DIAGRAM_PATHS.some((re) => re.test(clean));
}

/** Props for a <Link>/<a> to `path`: new tab for a diagram, nothing otherwise. */
export function diagramLinkProps(path) {
  return isDiagramPath(path) ? { target: "_blank", rel: "noopener noreferrer" } : {};
}

/** For navigate()-style callers (buttons and handlers that are not links). */
export function openDiagram(path) {
  window.open(path, "_blank", "noopener,noreferrer");
}
