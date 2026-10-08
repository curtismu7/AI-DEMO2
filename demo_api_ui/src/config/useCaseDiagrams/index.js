/**
 * Registry of use-case diagram configs. A new diagram = a new file here + one
 * line below. The drift test (useCaseDiagrams.drift.test.js) fails when a
 * demo-script use case has no config, so this list cannot go stale silently.
 */
import UC1 from "./UC1";
import UC6 from "./UC6";
import UC7 from "./UC7";

export const CONFIGS = [UC1, UC7, UC6];

export function getConfig(id) {
  return CONFIGS.find((c) => c.id === String(id || "").toUpperCase()) || null;
}
