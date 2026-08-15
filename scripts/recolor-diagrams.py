#!/usr/bin/env python3
"""
Recolor mermaid sequence diagram SVGs with per-actor colors.

Usage:
  python3 scripts/recolor-diagrams.py

Reads:  privilege/diagrams/privilege-mcp-flow1.svg, privilege/diagrams/privilege-mcp-flow2.svg  (raw mmdc output)
Writes: privilege/diagrams/privilege-mcp-flow1.svg, privilege/diagrams/privilege-mcp-flow2.svg  (recolored, in-place)

To regenerate the raw SVGs first:
  npx @mermaid-js/mermaid-cli -i privilege/diagrams/privilege-mcp-lucid-flow.md ... (split per diagram)
  or use render-diagrams.sh in this directory.
"""
import re
from pathlib import Path

ACTOR_COLORS = {
    'B':   ('#0d2b4a', '#4a90d9'),  # Browser — blue
    'BFF': ('#0d3d2a', '#27ae60'),  # BFF Relay — green
    'P1':  ('#4a2e00', '#e6952a'),  # PingOne — amber
    'MCP': ('#2e0d4a', '#9b59b6'),  # MCP server — purple
}

HERE = Path(__file__).parent.parent


def recolor(svg_path: Path) -> None:
    svg = svg_path.read_text()

    # Remove fill from the CSS .actor rule so inline style wins
    svg = re.sub(r'(\.actor\{[^}]*?)fill:[^;]+;', r'\1', svg)

    # Recolor each actor rect by its name attribute
    def replace_rect(m):
        r = m.group()
        name_m = re.search(r'name="([^"]+)"', r)
        if not name_m or name_m.group(1) not in ACTOR_COLORS:
            return r
        fill, stroke = ACTOR_COLORS[name_m.group(1)]
        r = re.sub(r'fill="[^"]*"', f'fill="{fill}"', r)
        r = re.sub(r'stroke="[^"]*"', f'stroke="{stroke}"', r)
        r = r.rstrip('/>').rstrip() + f' style="fill:{fill} !important;stroke:{stroke} !important"/>'
        return r

    svg = re.sub(r'<rect[^/]*/>', replace_rect, svg)
    svg_path.write_text(svg)
    print(f'Recolored: {svg_path.name}')


if __name__ == '__main__':
    import glob
    svgs = sorted(glob.glob(str(HERE / 'privilege/diagrams/privilege-mcp-flow*.svg')))
    if not svgs:
        print('No privilege-mcp-flow*.svg files found')
    for f in svgs:
        recolor(Path(f))
