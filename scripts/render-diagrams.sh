#!/bin/bash
# Full pipeline: md → extract mmd → SVG → recolor → PNG
# Run from anywhere: bash scripts/render-diagrams.sh

set -e
cd "$(dirname "$0")/.."

# 1. Extract mermaid blocks from the md file into temp .mmd files
python3 - <<'PY'
import re
from pathlib import Path
md = Path("privilege/diagrams/privilege-mcp-lucid-flow.md").read_text()
blocks = re.findall(r'```mermaid\n(.*?)```', md, re.DOTALL)
for i, block in enumerate(blocks, 1):
    Path(f"privilege/diagrams/privilege-mcp-flow{i}.mmd").write_text(block.strip() + "\n")
    print(f"Extracted flow {i}")
PY

# 2. Render all extracted flows to SVG
FLOWS=$(ls privilege/diagrams/privilege-mcp-flow*.mmd 2>/dev/null | wc -l | tr -d ' ')
for i in $(seq 1 "$FLOWS"); do
  npx @mermaid-js/mermaid-cli -i "privilege/diagrams/privilege-mcp-flow${i}.mmd" -o "privilege/diagrams/privilege-mcp-flow${i}.svg" --backgroundColor '#0a1628'
done

# 3. Recolor actor boxes
python3 scripts/recolor-diagrams.py

# 4. Convert to PNG and copy SVGs to ~/Documents
OUT=~/Documents
for i in $(seq 1 "$FLOWS"); do
  node scripts/svg2png.js "privilege/diagrams/privilege-mcp-flow${i}.svg" "$OUT/privilege-mcp-flow${i}.png"
  cp "privilege/diagrams/privilege-mcp-flow${i}.svg" "$OUT/privilege-mcp-flow${i}.svg"
done

echo "Done. $FLOWS flows output in $OUT/"
