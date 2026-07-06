#!/bin/bash
# download-models.sh — verify the GGUF models the 2-tier LLM proxy needs.
#
# Usage: bash demo_llm_proxy/download-models.sh [fetch]
#
# The exact filenames below MUST match the MODELS list in start-local-models.sh
# (that script launches these files by name on ports 8091 and 8096). All are
# quantized GGUF, optimized for llama.cpp. Both models are US-origin.

set -e

MODELS_DIR="${MODELS_DIR:-$HOME/models}"
mkdir -p "$MODELS_DIR"

model_present() {
  local file="$1"
  [ -f "$MODELS_DIR/$file" ]
}

# tier|exact filename|human label|hf repo (for `fetch`)
MODELS=(
  "1|microsoft_Phi-4-mini-instruct-Q4_K_M.gguf|Phi-4-mini-instruct (3.8B) — small, fast, US-origin|bartowski/microsoft_Phi-4-mini-instruct-GGUF"
  "5|gpt-oss-20b-mxfp4.gguf|gpt-oss-20B (20B MoE) — vibe coding / reasoning, US-origin|ggml-org/gpt-oss-20b-GGUF"
)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔷 2-Tier LLM Setup — checking $MODELS_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

missing=0
for entry in "${MODELS[@]}"; do
  IFS='|' read -r tier file label repo <<< "$entry"
  if model_present "$file"; then
    echo "  ✅ Tier $tier: $label"
  else
    missing=$((missing + 1))
    echo "  ❌ Tier $tier: $label"
    echo "       need: $MODELS_DIR/$file"
    echo "       from: https://huggingface.co/${repo}"
  fi
done
echo ""

if [ "$missing" -eq 0 ]; then
  echo "✅ All models present. Start them with:"
  echo "     bash demo_llm_proxy/start-local-models.sh start"
  exit 0
fi

if [ "${1:-}" = "fetch" ]; then
  command -v hf >/dev/null 2>&1 || { echo "❌ hf CLI not found — run: brew install huggingface-cli"; exit 1; }
  echo "Downloading $missing missing model(s) into $MODELS_DIR (~13GB total)..."
  echo ""
  for entry in "${MODELS[@]}"; do
    IFS='|' read -r tier file label repo <<< "$entry"
    [ -f "$MODELS_DIR/$file" ] && continue
    echo "  ⬇️  Tier $tier: $file"
    hf download "$repo" "$file" --local-dir "$MODELS_DIR" || exit 1
  done
  echo ""
  echo "✅ Download complete. Start tiers with:"
  echo "     bash demo_llm_proxy/start-local-models.sh start"
  exit 0
fi

echo "⚠️  $missing model(s) missing — download into $MODELS_DIR, then start tiers:"
echo "     bash demo_llm_proxy/download-models.sh fetch"
echo "     bash demo_llm_proxy/start-local-models.sh start"
echo ""
echo "    Tier 1 alone (~2.5GB) is enough for ./run-docker.sh swap mode (smallest model)."
echo ""
