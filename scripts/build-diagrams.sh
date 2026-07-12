#!/usr/bin/env bash
#
# build-diagrams.sh — regenerate architecture diagram PNGs from .mmd sources.
#
# Usage:
#   npm run build:diagrams              (renders all)
#   bash scripts/build-diagrams.sh      (same)
#   bash scripts/build-diagrams.sh overview   (just the named one)
#
# Requirements:
#   - mermaid-cli (pulled via npx -y; first run downloads Puppeteer + Chromium ~150 MB)
#   - macOS / Linux with a Chromium-compatible environment
#
# If mermaid-cli fails (sandbox, no Chrome, network blocked, etc.), the
# error message points you at https://mermaid.live as a manual fallback.

set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")/.." && pwd)"
# Canonical .mmd sources live under docs/diagrams/ (moved there in 1b9cf3ab).
SRC_DIR="${BASEDIR}/docs/diagrams"
OUT_DIR="${BASEDIR}/demo_api_ui/public/architecture"

mkdir -p "${OUT_DIR}"

# Source-to-output map. To add a new diagram: drop a .mmd at the repo root
# and add a row here. WIDTH governs the rendered pixel width; 2400 is a
# good sweet spot — readable when displayed at 100% on a 1920px screen and
# still sharp on retina at 50%.
#
# Format: "<friendly-name> <source.mmd> <output.png> <width>"
ENTRIES=(
  "overview          architecture-simple.mmd  ${OUT_DIR}/overview.png      2400"
  "overview-full     architecture.mmd         ${OUT_DIR}/overview2.png     2800"
  "overview-full-svg architecture.mmd         ${OUT_DIR}/overview2.svg     2800"
  "token-flow        i4ai-ref-arch.mmd        ${OUT_DIR}/token-flow.png    2800"
  "mcp-gateway       mcp-security-gateway.mmd ${OUT_DIR}/token-flow2.png   2400"
  "ciba-stepup       ciba-stepup-sequence.mmd ${OUT_DIR}/ciba-stepup.png   2400"
)

FILTER="${1:-}"

render_one() {
  local name="$1" src_rel="$2" out="$3" width="$4"
  local src="${SRC_DIR}/${src_rel}"

  if [[ ! -f "${src}" ]]; then
    echo "  [skip] ${name}: source not found (${src_rel})" >&2
    return 0
  fi

  echo "  [render] ${name}: ${src_rel} -> $(basename "${out}") (${width}px)"
  if ! npx -y @mermaid-js/mermaid-cli@11 \
        -i "${src}" -o "${out}" -w "${width}" -b transparent >/dev/null 2>&1; then
    echo "    [fail]  ${name}: mermaid-cli could not render." >&2
    echo "            Manual fallback: open https://mermaid.live, paste ${src_rel}," >&2
    echo "            click Actions -> Download PNG, save as $(basename "${out}")." >&2
    return 1
  fi
  # Publish the .mmd next to its PNG so the UI can show the exact Mermaid
  # source without a second copy of the file living in the repo. Single
  # source of truth: the repo-root .mmd. Static asset (no admin route) so
  # /sequence-diagram and the public Architecture group stay anon-safe.
  cp "${src}" "${OUT_DIR}/${src_rel}"
  echo "    [ok]    $(basename "${out}") ($(du -h "${out}" | cut -f1)) + ${src_rel}"
}

echo ""
echo "Rendering architecture diagrams to ${OUT_DIR}"
echo ""

FAILED=0
for entry in "${ENTRIES[@]}"; do
  # shellcheck disable=SC2086
  set -- ${entry}
  name="$1"; src="$2"; out="$3"; width="$4"

  if [[ -n "${FILTER}" ]] && [[ "${FILTER}" != "${name}" ]]; then
    continue
  fi

  render_one "${name}" "${src}" "${out}" "${width}" || FAILED=$((FAILED + 1))
done

echo ""
echo "Exporting draw.io files (Lucidchart-importable) from flowchart sources"
node "${BASEDIR}/scripts/export-drawio.mjs" || FAILED=$((FAILED + 1))

echo ""
if [[ ${FAILED} -eq 0 ]]; then
  echo "Done. Refresh /architecture/overview to see the updated image."
else
  echo "Finished with ${FAILED} failure(s) — see lines above."
  exit 1
fi
