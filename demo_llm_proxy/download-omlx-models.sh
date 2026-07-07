#!/bin/bash
# download-omlx-models.sh — verify / fetch MLX-format models for oMLX
#
# Usage: bash demo_llm_proxy/download-omlx-models.sh [fetch]
#
# oMLX expects model subdirectories under OMLX_MODEL_DIR (not flat GGUF files).
# These map to the demo's llama.cpp tiers for parity testing.

set -euo pipefail

OMLX_MODEL_DIR="${OMLX_MODEL_DIR:-$HOME/.omlx/models}"
mkdir -p "$OMLX_MODEL_DIR"

# tier|local_dir_name|label|hf_repo
MODELS=(
  "1|Phi-4-mini-instruct-4bit|Phi-4-mini-instruct (3.8B) — BFF NL intent|mlx-community/Phi-4-mini-instruct-4bit"
  "5|gpt-oss-20b-MXFP4-Q4|gpt-oss-20B (20B MoE) — agent reasoning|mlx-community/gpt-oss-20b-MXFP4-Q4"
)

model_present() {
  local dir="$1"
  [[ -d "${OMLX_MODEL_DIR}/${dir}" ]] && [[ -n "$(ls -A "${OMLX_MODEL_DIR}/${dir}" 2>/dev/null)" ]]
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔷 oMLX model setup — checking ${OMLX_MODEL_DIR}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

missing=0
for entry in "${MODELS[@]}"; do
  IFS='|' read -r tier dir label repo <<< "$entry"
  if model_present "$dir"; then
    echo "  ✅ Tier ${tier}: ${label}"
    echo "       ${OMLX_MODEL_DIR}/${dir}/"
  else
    missing=$((missing + 1))
    echo "  ❌ Tier ${tier}: ${label}"
    echo "       need: ${OMLX_MODEL_DIR}/${dir}/"
    echo "       from: https://huggingface.co/${repo}"
  fi
done
echo ""

if [[ $missing -eq 0 ]]; then
  echo "✅ All MLX models present. Start with:"
  echo "     LLM_BACKEND=omlx bash demo_llm_proxy/start-omlx.sh start"
  exit 0
fi

if [[ "${1:-}" == "fetch" ]]; then
  command -v hf >/dev/null 2>&1 || { echo "❌ hf CLI not found — brew install huggingface-cli"; exit 1; }
  echo "Downloading ${missing} missing model(s) into ${OMLX_MODEL_DIR}..."
  echo "  (MLX repos are larger than single GGUF files — allow ~15GB total)"
  echo ""
  for entry in "${MODELS[@]}"; do
    IFS='|' read -r tier dir label repo <<< "$entry"
    if model_present "$dir"; then
      continue
    fi
    echo "  ⬇️  Tier ${tier}: ${repo} → ${dir}/"
    hf download "$repo" --local-dir "${OMLX_MODEL_DIR}/${dir}" || exit 1
  done
  echo ""
  echo "✅ Download complete."
  echo ""
  echo "Next:"
  echo "  1. LLM_BACKEND=omlx bash demo_llm_proxy/start-omlx.sh start"
  echo "  2. Open http://127.0.0.1:8090/admin — pin Phi-4, set aliases:"
  echo "       phi-4-mini-instruct  (BFF)"
  echo "       gpt-oss-20b          (agent-service)"
  exit 0
fi

echo "⚠️  ${missing} model(s) missing."
echo "     bash demo_llm_proxy/download-omlx-models.sh fetch"
echo ""
echo "  Tier 1 alone is enough for BFF NL intent smoke tests."
echo "  GGUF files in ~/models/ are NOT used by oMLX — MLX format only."
echo ""
