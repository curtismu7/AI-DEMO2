#!/usr/bin/env node
// export-drawio.mjs — convert Mermaid flowchart sources to draw.io XML.
//
// Lucidchart's import dialog accepts draw.io (.drawio/.xml) files and turns
// them into fully draggable shapes, so this is the "editable in Lucid" export
// path for the architecture diagrams (the .mmd source itself covers Lucid's
// diagram-as-code paste route). The emitted mxGraphModel cell structure
// mirrors buildDrawio() in ArchitectureCanvasPage.jsx, which is the format
// already verified to import into Lucidchart.
//
// Scope: flowchart diagrams only. Sequence diagrams (i4ai-ref-arch.mmd,
// ciba-stepup-sequence.mmd) have no shape-level draw.io equivalent — for
// those, paste the .mmd into Lucid's Mermaid diagram-as-code editor instead.
//
// Usage: node scripts/export-drawio.mjs
// Runs as the last step of scripts/build-diagrams.sh.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "docs", "diagrams");
const OUT_DIR = path.join(ROOT, "demo_api_ui", "public", "architecture");

const SOURCES = [
  { mmd: "architecture-simple.mmd", out: "architecture-simple.drawio", name: "Architecture (clean view)" },
  { mmd: "architecture.mmd", out: "architecture.drawio", name: "Architecture (full)" },
];

const NODE_W = 220;
const NODE_H = 90;
const GAP_X = 60;
const GAP_Y = 50;
const COLS = 5;

const escX = (str) =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Mermaid label → plain multi-line text for a draw.io cell value.
const cleanLabel = (label) =>
  label
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();

// Parse a Mermaid flowchart: nodes (incl. cylinder [( )] shapes), subgraph
// membership, and edges. Tolerant by design — lines it does not recognise
// (classDef/class/Note/%% comments) are skipped, never fatal.
function parseFlowchart(src) {
  const nodes = new Map(); // id -> {id, label, group}
  const groups = new Map(); // id -> {id, label}
  const edges = []; // {from, to, label, dashed}
  const groupStack = [];

  const nodeDefRe = /^([A-Za-z0-9_]+)\s*\[\(?"([\s\S]*?)"\)?\]/;
  const subgraphRe = /^subgraph\s+([A-Za-z0-9_]+)\s*(?:\["?([\s\S]*?)"?\])?\s*$/;
  const edgeRe =
    /^([A-Za-z0-9_]+)\s*(-->|-\.->|<-->)\s*(?:\|"?([\s\S]*?)"?\|\s*)?([A-Za-z0-9_]+)/;

  const ensureNode = (id) => {
    if (!nodes.has(id) && !groups.has(id)) {
      nodes.set(id, { id, label: id, group: null });
    }
  };

  for (const rawLine of src.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("%%") || line.startsWith("---") || line.startsWith("title")) continue;
    if (/^flowchart\b/.test(line) || /^direction\b/.test(line)) continue;

    const sg = line.match(subgraphRe);
    if (sg) {
      groups.set(sg[1], { id: sg[1], label: cleanLabel(sg[2] || sg[1]) });
      groupStack.push(sg[1]);
      continue;
    }
    if (line === "end") {
      groupStack.pop();
      continue;
    }

    const nd = line.match(nodeDefRe);
    if (nd && !line.includes("-->") && !line.includes("-.->")) {
      nodes.set(nd[1], {
        id: nd[1],
        label: cleanLabel(nd[2]),
        group: groupStack[groupStack.length - 1] || null,
      });
      continue;
    }

    const ed = line.match(edgeRe);
    if (ed) {
      ensureNode(ed[1]);
      ensureNode(ed[4]);
      edges.push({
        from: ed[1],
        to: ed[4],
        label: ed[3] ? cleanLabel(ed[3]) : "",
        dashed: ed[2] === "-.->",
      });
    }
  }
  return { nodes: [...nodes.values()], groups, edges };
}

// Simple grid layout: grouped nodes are laid out group-by-group (each group a
// horizontal band with its own container cell), ungrouped nodes fill a grid
// band at the top. Recipients re-layout in Lucid/draw.io; this only needs to
// be untangled enough to start from.
function layout(nodes, groups) {
  const placed = new Map(); // id -> {x, y}
  const containers = []; // {id, label, x, y, w, h}
  let cursorY = 40;

  const gridPlace = (list, startX, startY) => {
    list.forEach((n, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      placed.set(n.id, {
        x: startX + col * (NODE_W + GAP_X),
        y: startY + row * (NODE_H + GAP_Y),
      });
    });
    const rows = Math.ceil(list.length / COLS) || 1;
    return rows * (NODE_H + GAP_Y);
  };

  const ungrouped = nodes.filter((n) => !n.group);
  if (ungrouped.length) {
    cursorY += gridPlace(ungrouped, 40, cursorY) + GAP_Y;
  }

  for (const [gid, g] of groups) {
    const members = nodes.filter((n) => n.group === gid);
    if (!members.length) continue;
    const bandH = gridPlace(members, 80, cursorY + 40);
    const cols = Math.min(members.length, COLS);
    containers.push({
      id: `group_${gid}`,
      label: g.label,
      x: 40,
      y: cursorY,
      w: cols * (NODE_W + GAP_X) + 80,
      h: bandH + 60,
    });
    cursorY += bandH + 60 + GAP_Y;
  }
  return { placed, containers };
}

function buildDrawio(name, { nodes, groups, edges }) {
  const { placed, containers } = layout(nodes, groups);

  let cells = '<mxCell id="0"/><mxCell id="1" parent="0"/>';
  containers.forEach((c) => {
    cells +=
      `<mxCell id="${escX(c.id)}" value="${escX(c.label)}" ` +
      `style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#94a3b8;dashed=1;verticalAlign=top;fontSize=12;fontStyle=1;" ` +
      `vertex="1" parent="1">` +
      `<mxGeometry x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" as="geometry"/>` +
      `</mxCell>`;
  });
  nodes.forEach((n) => {
    const pos = placed.get(n.id);
    if (!pos) return;
    cells +=
      `<mxCell id="${escX(n.id)}" value="${escX(n.label)}" ` +
      `style="rounded=1;whiteSpace=wrap;html=1;arcSize=8;fillColor=#eff6ff;strokeColor=#2563eb;fontColor=#1e3a5f;fontSize=11;" ` +
      `vertex="1" parent="1">` +
      `<mxGeometry x="${pos.x}" y="${pos.y}" width="${NODE_W}" height="${NODE_H}" as="geometry"/>` +
      `</mxCell>`;
  });
  edges.forEach((e, i) => {
    if (!placed.has(e.from) || !placed.has(e.to)) return;
    const dash = e.dashed ? "dashed=1;" : "";
    cells +=
      `<mxCell id="edge_${i}" value="${escX(e.label)}" ` +
      `style="edgeStyle=orthogonalEdgeStyle;rounded=0;${dash}fontSize=9;" ` +
      `edge="1" source="${escX(e.from)}" target="${escX(e.to)}" parent="1">` +
      `<mxGeometry relative="1" as="geometry"/>` +
      `</mxCell>`;
  });

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mxfile><diagram name="${escX(name)}">` +
    `<mxGraphModel><root>${cells}</root></mxGraphModel>` +
    `</diagram></mxfile>`
  );
}

let failed = false;
for (const { mmd, out, name } of SOURCES) {
  const srcPath = path.join(SRC_DIR, mmd);
  if (!fs.existsSync(srcPath)) {
    console.error(`  [skip] ${out}: source not found (${mmd})`);
    continue;
  }
  try {
    const parsed = parseFlowchart(fs.readFileSync(srcPath, "utf8"));
    if (!parsed.nodes.length || !parsed.edges.length) {
      throw new Error(`parsed ${parsed.nodes.length} nodes / ${parsed.edges.length} edges`);
    }
    const xml = buildDrawio(name, parsed);
    fs.writeFileSync(path.join(OUT_DIR, out), xml);
    console.log(
      `  [drawio] ${mmd} -> ${out} (${parsed.nodes.length} nodes, ${parsed.edges.length} edges)`,
    );
  } catch (err) {
    failed = true;
    console.error(`  [fail]  ${out}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
