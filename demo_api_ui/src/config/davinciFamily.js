// The DaVinci demo family: one canonical path per surface, in teaching order.
// DaVinciFamilyNav renders this list; navPagePaths / AdminSideNav /
// educationalPages / diagramsIndex must point at these paths, never at an alias.
export const DAVINCI_FAMILY = [
  { id: "explainer", label: "Explainer", path: "/davinci-sdk", hint: "What the SDK is" },
  { id: "widget", label: "Widget", path: "/davinci-widget", hint: "Flow renders in-page" },
  { id: "sdk", label: "SDK live", path: "/davinci-orchestration-sdk", hint: "You render the collectors" },
  { id: "pf-kit", label: "PingFederate kit", path: "/pingfederate-davinci-kit", hint: "Flow behind PingFederate" },
];

// Old URLs that must keep working. Each is a <Navigate> redirect in App.js to
// the canonical path named here.
export const DAVINCI_ALIASES = [
  { from: "/orchestration-sdk", to: "/davinci-sdk" },
  { from: "/davinci-orchestration", to: "/davinci-sdk" },
  { from: "/davinci-sdk-login", to: "/davinci-orchestration-sdk" },
  { from: "/davinci-login-guide", to: "/davinci-widget" },
];
