// Parses the subset of Mermaid `sequenceDiagram` text the Diagrams pages use into a
// plain model, so the .mmd stays the exported/uploaded source while React Flow draws it.
//
// Supported: participant/actor [as Label], box [colour] Label ... end, A->>B / A-->>B: text,
// Note over A[,B]: text, alt/else/opt/loop/par/rect ... end, autonumber. Anything else is ignored.

const br = (s) => s.replace(/<br\s*\/?>/gi, "\n").replace(/\\n/g, "\n").trim();
const BOX_COLOUR = /^(rgba?\([^)]*\)|#[0-9a-f]{3,8}|transparent)\s*/i;

export function parseSequence(source = "") {
  const participants = [];
  const boxes = [];
  const items = [];
  let autonumber = false;
  let openBox = null;
  const fragments = [];

  const ensure = (id, label) => {
    let p = participants.find((x) => x.id === id);
    if (!p) {
      p = { id, label: label ?? id, box: openBox ? openBox.label : null };
      participants.push(p);
      if (openBox) openBox.ids.push(id);
    } else if (label) {
      p.label = label;
    }
    return p;
  };

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || line === "sequenceDiagram") continue;
    let m;
    if (line === "autonumber") {
      autonumber = true;
    } else if ((m = line.match(/^box\s*(.*)$/i))) {
      const rest = m[1].replace(BOX_COLOUR, "");
      openBox = { label: br(rest), ids: [] };
      boxes.push(openBox);
      fragments.push("box");
    } else if ((m = line.match(/^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i))) {
      ensure(m[2], m[3] ? br(m[3]) : undefined);
    } else if (/^rect\b/i.test(line)) {
      fragments.push("rect"); // background band: no item, but its `end` must balance
    } else if ((m = line.match(/^(alt|opt|loop|par|critical)\s*(.*)$/i))) {
      fragments.push(m[1]);
      items.push({ type: "fragment", kind: m[1].toLowerCase(), text: br(m[2]) });
    } else if ((m = line.match(/^(else|and)\s*(.*)$/i))) {
      items.push({ type: "fragment", kind: m[1].toLowerCase(), text: br(m[2]) });
    } else if (line === "end") {
      if (fragments.pop() === "box") openBox = null;
    } else if ((m = line.match(/^Note\s+(?:over|left of|right of)\s+([^:]+):\s*(.*)$/i))) {
      const over = m[1].split(",").map((s) => s.trim());
      over.forEach((id) => ensure(id));
      items.push({ type: "note", over, text: br(m[2]) });
    } else if ((m = line.match(/^(\S+?)\s*(--?>>|--?>|--?x)\s*[+-]?(\S+?)\s*:\s*(.*)$/))) {
      ensure(m[1]);
      ensure(m[3]);
      items.push({ type: "message", from: m[1], to: m[3], text: br(m[4]), dashed: m[2].startsWith("--") });
    }
  }
  return { participants, boxes, items, autonumber };
}
