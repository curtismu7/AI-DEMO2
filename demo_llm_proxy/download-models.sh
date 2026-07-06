#!/bin/bash
# download-models.sh — verify the GGUF models the multi-model LLM proxy needs.
#
# Usage: bash demo_llm_proxy/download-models.sh
#
# The exact filenames below MUST match the MODELS list in start-local-models.sh
# (that script launches these files by name on ports 8091-8096). All are
# quantized GGUF, optimized for llama.cpp.

set -e

MODELS_DIR="${MODELS_DIR:-$HOME/models}"
mkdir -p "$MODELS_DIR"

# tier|exact filename|human label|hf repo (for `fetch`)
MODELS=(
  "1|gemma-3-4b-it-qat-Q4_0.gguf|Gemma-3-4B (4B) — simple, fast|unsloth/gemma-3-4b-it-qat-GGUF"
  "2|gemma-3-12b-it-qat-UD-Q4_K_XL.gguf|Gemma-3-12B qat (12B) — moderate|unsloth/gemma-3-12b-it-qat-GGUF"
  "3|starcoder2-15b-instruct-v0.1-Q4_K_M.gguf|StarCoder2-15B-Instruct (15B) — complex|bartowski/starcoder2-15b-instruct-v0.1-GGUF"
  "4|gemma-3-12b-it-UD-Q4_K_XL.gguf|Gemma-3-12B (12B) — fallback|unsloth/gemma-3-12b-it-GGUF"
  "5|gpt-oss-20b-mxfp4.gguf|gpt-oss-20B (20B) — top tier / overflow|ggml-org/gpt-oss-20b-GGUF"
)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔷 Multi-Model LLM Setup — checking $MODELS_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

missing=0
for entry in "${MODELS[@]}"; do
  IFS='|' read -r tier file label repo <<< "$entry"
  if [ -f "$MODELS_DIR/$file" ]; then
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
  echo "Downloading $missing missing model(s) into $MODELS_DIR (~35GB total)..."
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
echo "    Tier 1 alone (~2.2GB) is enough for ./run-docker.sh swap mode (smallest model)."
echo ""
