#!/usr/bin/env python3
"""Convert one page of a Lucid "Visio (VSDX)" export into the Digital Worker diagram's JSON.

The output is the same shape as the page's "Download JSON", so load it with the page's "Load JSON".

    python3 -I scripts/lucid-vsdx-to-diagram.py export.vsdx --list
    python3 -I scripts/lucid-vsdx-to-diagram.py export.vsdx --page "V2 Agent - GW/Authorize" -o diagram.json
    # keep only the area around the diagram containing the box named "agent1" (drops unrelated
    # clusters elsewhere on the Lucid page):
    python3 -I scripts/lucid-vsdx-to-diagram.py export.vsdx --page "V2 Agent - GW/Authorize" \
        --component agent1 -o diagram.json

Positions, sizes, text, fills and arrows come from the VSDX (the Lucid JSON export has no geometry).
Fill colors snap to the nearest of the page's own box colors. Python stdlib only.
"""
import argparse
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

V = "{http://schemas.microsoft.com/office/visio/2012/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PX_PER_INCH = 90  # Lucid boxes are ~1.4in wide; at 90 px/in their text fits at the page's font size

# Box colors the page already has (DigitalWorkerPage.css .dw-kind--*): kind -> fill.
PALETTE = {
    "blue": "#cfe2ff", "red": "#e8706a", "orange": "#f0952a", "green": "#d5e8d4",
    "lgreen": "#c8f2c8", "dgreen": "#5cb85c", "grey": "#d0d0d0", "purple": "#d6d0ea",
    "white": "#ffffff", "note": "#fcefc7", "pink": "#e873d3",
}
ZONE_CLASSES = ("RectangleContainerBlock", "AdvancedSwimLaneBlock", "SparkFrameBlock")
BEGIN_PART, END_PART = "9", "12"  # Visio Connect.FromPart for a connector's two ends


def rgb(hex_color):
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def nearest_kind(fill):
    if not fill or not re.fullmatch(r"#[0-9a-fA-F]{6}", fill):
        return "blue"
    r, g, b = rgb(fill)
    return min(PALETTE, key=lambda k: sum((a - c) ** 2 for a, c in zip((r, g, b), rgb(PALETTE[k]))))


def cell(shape, name):
    for c in shape.findall(V + "Cell"):
        if c.get("N") == name:
            return c.get("V")
    return None


def num(shape, name, default=0.0):
    try:
        return float(cell(shape, name))
    except (TypeError, ValueError):
        return default


def text_of(shape):
    t = shape.find(V + "Text")
    return "".join(t.itertext()).strip() if t is not None else ""


def fill_of(shape):
    """A Lucid block is a group whose first child carries the fill."""
    fill = cell(shape, "FillForegnd")
    if fill:
        return fill
    inner = shape.find(V + "Shapes")
    if inner is not None:
        for child in inner.findall(V + "Shape"):
            fill = cell(child, "FillForegnd")
            if fill:
                return fill
    return None


def page_files(zf):
    """Map page name -> part path, via pages.xml and its rels."""
    pages = ET.fromstring(zf.read("visio/pages/pages.xml"))
    rels = ET.fromstring(zf.read("visio/pages/_rels/pages.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels}
    out = {}
    for p in pages.findall(V + "Page"):
        rid = p.find(V + "Rel").get(R + "id")
        out[p.get("Name")] = "visio/pages/" + target[rid]
    return out


def keep_component(nodes, edges, needle, margin_in=2.5):
    """Keep the region around the diagram containing a box whose text has `needle`: every box whose
    centre lies within `margin_in` inches of that diagram's outline (so notes and neighbouring
    boxes come along, far-away clusters do not), and the zones that lie inside that region and enclose a kept box."""
    boxes = [n for n in nodes if n["type"] == "box"]
    want = needle.strip().lower()
    degree = {n["id"]: 0 for n in nodes}
    for e in edges:
        degree[e["source"]] += 1
        degree[e["target"]] += 1
    # exact text beats a substring match; among equals take the best-connected box
    exact = [n for n in boxes if n["data"]["label"].strip().lower() == want]
    found = exact or [n for n in boxes if want in n["data"]["label"].lower()]
    if not found:
        raise SystemExit(f"no box on that page has text containing {needle!r}")
    seed = max(found, key=lambda n: degree[n["id"]])
    parent = {n["id"]: n["id"] for n in nodes}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for e in edges:
        parent[find(e["source"])] = find(e["target"])
    comp = [n for n in boxes if find(n["id"]) == find(seed["id"])]

    def rect(n):
        return (n["position"]["x"], n["position"]["y"], n["position"]["x"] + n["style"]["width"], n["position"]["y"] + n["style"]["height"])

    margin = margin_in * PX_PER_INCH
    x0 = min(rect(n)[0] for n in comp) - margin
    y0 = min(rect(n)[1] for n in comp) - margin
    x1 = max(rect(n)[2] for n in comp) + margin
    y1 = max(rect(n)[3] for n in comp) + margin

    def centre(n):
        r = rect(n)
        return (r[0] + r[2]) / 2, (r[1] + r[3]) / 2

    keep = {n["id"] for n in comp}
    for n in boxes:
        cx, cy = centre(n)
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            keep.add(n["id"])
    kept_centres = [centre(n) for n in boxes if n["id"] in keep]
    for z in (n for n in nodes if n["type"] == "zone"):  # zones that enclose a kept box
        zx0, zy0, zx1, zy1 = rect(z)
        inside_region = zx0 >= x0 and zy0 >= y0 and zx1 <= x1 and zy1 <= y1
        if inside_region and any(zx0 <= cx <= zx1 and zy0 <= cy <= zy1 for cx, cy in kept_centres):
            keep.add(z["id"])
    return ([n for n in nodes if n["id"] in keep],
            [e for e in edges if e["source"] in keep and e["target"] in keep])


def convert_page(page_xml, component=None, margin_in=2.5):
    """Return ({nodes, edges}, warnings) for one page's XML."""
    root = ET.fromstring(page_xml)
    shapes = root.find(V + "Shapes")
    top = shapes.findall(V + "Shape") if shapes is not None else []
    warnings = []

    blocks, lines = {}, []
    for sh in top:
        cls = (sh.get("Name") or "").rsplit(".", 1)[-1]
        if cls == "Line":
            lines.append(sh)
        else:
            blocks[sh.get("ID")] = (cls, sh)

    # Visio y points up; the page's y points down. Shift so the drawing starts near 0,0.
    boxes = {}
    for sid, (cls, sh) in blocks.items():
        w, h = num(sh, "Width"), num(sh, "Height")
        boxes[sid] = (num(sh, "PinX") - w / 2, num(sh, "PinY") + h / 2, w, h)  # left, top(y-up), w, h
    if not boxes:
        return {"nodes": [], "edges": []}, ["no shapes found on this page"]
    min_left = min(b[0] for b in boxes.values())
    max_top = max(b[1] for b in boxes.values())

    zones, nodes = [], []
    for sid, (cls, sh) in blocks.items():
        left, top_y, w, h = boxes[sid]
        label = text_of(sh)
        node = {
            "id": f"n{sid}",
            "position": {"x": round((left - min_left) * PX_PER_INCH), "y": round((max_top - top_y) * PX_PER_INCH)},
            "style": {"width": round(w * PX_PER_INCH), "height": round(h * PX_PER_INCH)},
        }
        if cls in ZONE_CLASSES:
            node.update(type="zone", zIndex=-1, data={"label": label, "kind": "mcp", "bottom": False})
            zones.append(node)
            continue
        if cls == "DecisionBlock":
            kind = "pink"
        elif cls == "AutoGrowTextBlock":
            kind = "text"
        else:
            kind = nearest_kind(fill_of(sh))
        node.update(type="box", data={"label": label, "kind": kind})
        nodes.append(node)

    ends = {}
    for c in root.iter(V + "Connect"):
        ends.setdefault(c.get("FromSheet"), {})[c.get("FromPart")] = c.get("ToSheet")

    edges = []
    for ln in lines:
        lid = ln.get("ID")
        src, dst = ends.get(lid, {}).get(BEGIN_PART), ends.get(lid, {}).get(END_PART)
        if src not in boxes or dst not in boxes:
            warnings.append(f"arrow {lid} skipped: an end is not attached to a box")
            continue
        begin_arrow, end_arrow = num(ln, "BeginArrow") > 0, num(ln, "EndArrow") > 0
        if begin_arrow and not end_arrow:  # draw the arrowhead at the target end
            src, dst = dst, src
        sx, sy = boxes[src][0] + boxes[src][2] / 2, boxes[src][1] - boxes[src][3] / 2
        dx_, dy_ = boxes[dst][0] + boxes[dst][2] / 2, boxes[dst][1] - boxes[dst][3] / 2
        ddx, ddy = dx_ - sx, sy - dy_  # screen-space delta (y flipped)
        horizontal = abs(ddx) * boxes[src][3] >= abs(ddy) * boxes[src][2]
        sh_, th_ = (("r", "l") if ddx >= 0 else ("l", "r")) if horizontal else (("b", "t") if ddy >= 0 else ("t", "b"))
        arrow = {"type": "arrowclosed"}
        edge = {
            "id": f"e{lid}", "source": f"n{src}", "sourceHandle": sh_, "target": f"n{dst}", "targetHandle": th_,
            "label": re.sub(r"\s*\n\s*", " ", text_of(ln)), "type": "smoothstep", "markerEnd": arrow,
            "labelBgStyle": {"fillOpacity": 0.9},
        }
        if begin_arrow and end_arrow:
            edge["markerStart"] = arrow
        edges.append(edge)

    all_nodes = zones + nodes
    if component:
        all_nodes, edges = keep_component(all_nodes, edges, component, margin_in)
    return {"nodes": all_nodes, "edges": edges}, warnings


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("vsdx")
    ap.add_argument("--list", action="store_true", help="list the pages in the file and exit")
    ap.add_argument("--page", help="page name to convert")
    ap.add_argument("--component", help="keep only the diagram containing a box whose text has this (case-insensitive)")
    ap.add_argument("--margin", type=float, default=2.5, help="inches around the --component diagram to keep (default 2.5)")
    ap.add_argument("-o", "--out", help="output file (default: stdout)")
    args = ap.parse_args(argv)

    with zipfile.ZipFile(args.vsdx) as zf:
        pages = page_files(zf)
        if args.list or not args.page:
            print("\n".join(pages), file=sys.stderr if args.page is None and not args.list else sys.stdout)
            return 0 if args.list else 2
        if args.page not in pages:
            print(f"no page named {args.page!r}. Pages: {', '.join(pages)}", file=sys.stderr)
            return 2
        diagram, warnings = convert_page(zf.read(pages[args.page]), args.component, args.margin)

    for w in warnings:
        print("warning:", w, file=sys.stderr)
    payload = json.dumps(diagram, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(payload + "\n")
    else:
        print(payload)
    print(f"{len(diagram['nodes'])} boxes, {len(diagram['edges'])} arrows, {len(warnings)} skipped", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
