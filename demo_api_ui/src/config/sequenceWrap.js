// SequenceFlowDiagram sizes each row from the explicit line breaks in a message but also wraps long labels on its own
// (about 45 characters), which makes a long label overrun the next row. wrapMessages breaks every `A->>B:` / `A-->>B:`
// message of a Mermaid sequenceDiagram so row heights come out right.
const WRAP = 44;
const wrap = (text) => {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > WRAP) { lines.push(line); line = word; } else { line = line ? line + ' ' + word : word; }
  }
  if (line) lines.push(line);
  return lines.join('<br/>');
};

export const wrapMessages = (src) => src.replace(/^(\s*\w+--?>>\w+: )(.*)$/gm, (_, head, text) => head + wrap(text));
