// Parses the subset of Mermaid `flowchart` text the architecture pages use into a plain
// model (nodes, nested groups, edges, classDef colours) so React Flow can draw it and the
// .mmd stays the single source. Anything unrecognised (style, linkStyle, click) is ignored.
//
// Supported: `A["label"]` / `A[label]` / `A(label)` / `A((label))` / `A{label}` / `A[(label)]`,
// `subgraph ID["Title"] ... end` (nested), `-->`, `---`, `-.->`, `==>`, `-->|text|`,
// `-- text -->`, `-. "text" .->`, chains (`A --> B --> C`), `A & B --> C`, `classDef`,
// `class A,B name`, `style A fill:...,stroke:...`.

const ID_RE = /^[A-Za-z0-9_]+/;
const OPENERS = "[({";
const CLOSERS = "])}";
// -- text -->  /  -. text .->  (label between the dashes)
const INLINE_LABEL_RE = /^(-{2}|-\.)\s+(.+?)\s+(-{2}>|\.->|-{3})/;
const OP_RE = /^(<?)(-{2,}>?|-\.+->?|={2,}>?)/;

// A label can carry a real embedded newline; fold any line with an unterminated quote
// into the next so every statement is on one physical line.
export function joinMultilineLabels(source) {
  const joined = [];
  let buffer = null;
  for (const line of source.split("\n")) {
    buffer = buffer === null ? line : `${buffer} ${line.trim()}`;
    if (((buffer.match(/"/g) || []).length) % 2 === 0) {
      joined.push(buffer);
      buffer = null;
    }
  }
  if (buffer !== null) joined.push(buffer);
  return joined.join("\n");
}

const cleanLabel = (s) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, "")
    .trim();

function readNode(s, start) {
  const m = s.slice(start).match(ID_RE);
  if (!m) return null;
  let i = start + m[0].length;
  const id = m[0];
  let label;
  let shape = "rect";
  if (OPENERS.includes(s[i])) {
    const open = s[i];
    shape = open === "{" ? "diamond" : open === "(" ? "round" : "rect";
    while (OPENERS.includes(s[i])) i += 1;
    while (s[i] === " ") i += 1;
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1);
      label = s.slice(i + 1, end);
      i = end + 1;
    } else {
      const from = i;
      while (i < s.length && !CLOSERS.includes(s[i])) i += 1;
      label = s.slice(from, i);
    }
    while (i < s.length && (CLOSERS.includes(s[i]) || s[i] === " ")) i += 1;
  }
  return { id, label: label === undefined ? undefined : cleanLabel(label), shape, end: i };
}

export function parseFlowchart(source = "") {
  const text = joinMultilineLabels(source).replace(/^---[\s\S]*?\n---\n/, "");
  const groups = new Map();
  const nodes = new Map();
  const edges = [];
  const classDefs = {};
  const classOf = {};
  const styles = {};
  const stack = [];

  const touch = (ref) => {
    if (groups.has(ref.id)) return;
    const parent = stack.length ? stack[stack.length - 1] : null;
    const prev = nodes.get(ref.id);
    if (!prev) nodes.set(ref.id, { id: ref.id, label: ref.label ?? ref.id, shape: ref.shape, parent });
    else if (ref.label !== undefined) prev.label = ref.label;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || /^(flowchart|graph)\b/.test(line) || /^direction\b/.test(line)) continue;
    let m;
    if ((m = line.match(/^subgraph\s+([A-Za-z0-9_]+)\s*(?:\[\s*"?(.*?)"?\s*\])?\s*$/))) {
      groups.set(m[1], { id: m[1], label: cleanLabel(m[2] ?? m[1]), parent: stack.length ? stack[stack.length - 1] : null });
      nodes.delete(m[1]);
      stack.push(m[1]);
      continue;
    }
    if (line === "end") {
      stack.pop();
      continue;
    }
    if ((m = line.match(/^classDef\s+(\S+)\s+(.+)$/))) {
      const css = Object.fromEntries(
        m[2].split(",").map((kv) => kv.split(":").map((x) => x.trim())).filter((kv) => kv.length === 2),
      );
      classDefs[m[1]] = { fill: css.fill, stroke: css.stroke, color: css.color, dashed: Boolean(css["stroke-dasharray"]) };
      continue;
    }
    if ((m = line.match(/^class\s+([A-Za-z0-9_,]+)\s+(\S+)\s*$/))) {
      m[1].split(",").forEach((id) => {
        classOf[id] = m[2];
      });
      continue;
    }
    if ((m = line.match(/^style\s+([A-Za-z0-9_]+)\s+(.+)$/))) {
      const css = Object.fromEntries(
        m[2].split(",").map((kv) => kv.split(":").map((x) => x.trim())).filter((kv) => kv.length === 2),
      );
      styles[m[1]] = { fill: css.fill, stroke: css.stroke, color: css.color, dashed: Boolean(css["stroke-dasharray"]) };
      continue;
    }
    if (/^(linkStyle|click|accTitle|accDescr)\b/.test(line)) continue;

    // node declaration or edge chain
    let i = 0;
    let prev = null; // array of ids on the left of the next operator
    const readList = () => {
      const ids = [];
      for (;;) {
        while (line[i] === " ") i += 1;
        const ref = readNode(line, i);
        if (!ref) return ids;
        touch(ref);
        ids.push(ref.id);
        i = ref.end;
        while (line[i] === " ") i += 1;
        if (line[i] === "&") i += 1;
        else return ids;
      }
    };
    prev = readList();
    while (prev.length && i < line.length) {
      while (line[i] === " ") i += 1;
      const rest = line.slice(i);
      let label = "";
      let dashed = false;
      const inline = rest.match(INLINE_LABEL_RE);
      if (inline) {
        label = inline[2].replace(/^"|"$/g, "");
        dashed = inline[1] === "-.";
        i += inline[0].length;
      } else {
        const op = rest.match(OP_RE);
        if (!op) break;
        dashed = op[2].includes(".");
        i += op[0].length;
        while (line[i] === " ") i += 1;
        if (line[i] === "|") {
          const end = line.indexOf("|", i + 1);
          label = line.slice(i + 1, end).replace(/^"|"$/g, "");
          i = end + 1;
        }
      }
      const next = readList();
      if (!next.length) break;
      prev.forEach((from) => next.forEach((to) => edges.push({ from, to, label: cleanLabel(label), dashed })));
      prev = next;
    }
  }
  return { groups: [...groups.values()], nodes: [...nodes.values()], edges, classDefs, classOf, styles };
}
