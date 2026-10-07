// demo_api_ui/src/utils/a2aSectionFold.js
/** Remember which A2A learning-page sections the viewer folded. Per-browser only. */

export const A2A_SECTION_FOLD_STORAGE_NAME = "a2l_folded_sections";

/** Section ids on the page, in order. A test fails if the page uses one that is missing here. */
export const A2A_SECTION_IDS = [
  "layers",
  "card",
  "gate",
  "run",
  "identity",
  "wire",
  "caveats",
  "latest-guidance",
];

/** @returns {string[]} the folded section ids; unknown ids from an older page are dropped */
export function readFoldedSections() {
  try {
    const parsed = JSON.parse(localStorage.getItem(A2A_SECTION_FOLD_STORAGE_NAME) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => A2A_SECTION_IDS.includes(id)) : [];
  } catch {
    return [];
  }
}

/** @param {string[]} ids folded section ids */
export function persistFoldedSections(ids) {
  try {
    localStorage.setItem(A2A_SECTION_FOLD_STORAGE_NAME, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}
