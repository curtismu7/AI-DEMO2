// Parses src/data/pageCatalog.md ("## Group" / "### Label" / "- **Field:** text")
// into [{ label, pages: [{ label, route, does, teaches, demos }] }].
const FIELDS = {
  Route: "route",
  "What it does": "does",
  "What it teaches": "teaches",
  "What it demos": "demos",
};

export function parsePageCatalog(md) {
  const groups = [];
  let group = null;
  let page = null;
  for (const line of md.split("\n")) {
    let m = line.match(/^## (.+)/);
    if (m) {
      group = { label: m[1].trim(), pages: [] };
      groups.push(group);
      page = null;
      continue;
    }
    m = line.match(/^### (.+)/);
    if (m && group) {
      page = { label: m[1].trim() };
      group.pages.push(page);
      continue;
    }
    m = line.match(/^- \*\*(Route|What it does|What it teaches|What it demos):\*\* (.*)/);
    if (m && page) page[FIELDS[m[1]]] = m[2].replace(/[`*]/g, "").trim();
  }
  return groups;
}
