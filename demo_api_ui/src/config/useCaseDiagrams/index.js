/**
 * Registry of use-case diagram configs. A new diagram = a new file here + one
 * line below. The drift test (useCaseDiagrams.drift.test.js) fails when a
 * demo-script use case has no config, so this list cannot go stale silently.
 */
import UC1 from "./UC1";
import UC7 from "./UC7";
import UC6 from "./UC6";
import UC24 from "./UC24";
import UC8 from "./UC8";
import UC14b from "./UC14b";
import UC14 from "./UC14";
import UC12 from "./UC12";
import UC2 from "./UC2";
import UC2_5 from "./UC2.5";
import UC2_7 from "./UC2.7";
import UC22 from "./UC22";
import UC5 from "./UC5";
import UC10 from "./UC10";
import UC13 from "./UC13";
import UC11 from "./UC11";
import UC20 from "./UC20";
import UC18 from "./UC18";
import UC30 from "./UC30";
import UC31 from "./UC31";
import UC32 from "./UC32";
import UC40 from "./UC40";
import UC38 from "./UC38";
import UC_TOOL1 from "./UC-TOOL1";
import UC46 from "./UC46";
import UC47 from "./UC47";

export const CONFIGS = [
  UC1, UC7, UC6, UC24, UC8, UC14b, UC14, UC12, UC2, UC2_5, UC2_7, UC22,
  UC5, UC10, UC13, UC11, UC20, UC18, UC30, UC31, UC32, UC40, UC38,
  UC_TOOL1, UC46, UC47,
];

export function getConfig(id) {
  return CONFIGS.find((c) => c.id === String(id || "").toUpperCase()) || null;
}

/** Canonical share URL for a use-case diagram. */
export const useCaseDiagramPath = (id) => `/use-case-diagrams/${id}`;
