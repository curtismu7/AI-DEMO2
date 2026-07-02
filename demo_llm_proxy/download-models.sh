#!/bin/bash
# download-models.sh — verify the GGUF models the multi-model LLM proxy needs.
#
# Usage: bash demo_llm_proxy/download-models.sh
#
# The exact filenames below MUST match the MODELS list in start-local-models.sh
# (that script launches these files by name on ports 8091-8094). All are
# quantized GGUF, optimized for llama.cpp.

set -e

MODELS_DIR="/Users/cmuir/models"
mkdir -p "$MODELS_DIR"

# tier|exact filename|human label|Hugging Face reference
MODELS=(
  "1|gemma-3-4b-it-qat-Q4_0.gguf|Gemma-3-4B (4B) — simple, fast|https://huggingface.co/google/gemma-3-4b-it-qat-q4_0-gguf"
  "2|gemma-4-12B-it-qat-UD-Q4_K_XL.gguf|Gemma-4-12B qat (12B) — moderate|https://huggingface.co/unsloth/gemma-3-12b-it-qat-GGUF"
  "3|starcoder2-15b-instruct-v0.1-Q4_K_M.gguf|StarCoder2-15B-Instruct (15B) — complex|https://huggingface.co/bartowski/starcoder2-15b-instruct-v0.1-GGUF"
  "4|gemma-4-12b-it-UD-Q4_K_XL.gguf|Gemma-4-12B (12B) — fallback|https://huggingface.co/unsloth/gemma-3-12b-it-GGUF"
)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔷 Multi-Model LLM Setup — checking $MODELS_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

missing=0
for entry in "${MODELS[@]}"; do
  IFS='|' read -r tier file label url <<< "$entry"
  if [ -f "$MODELS_DIR/$file" ]; then
    echo "  ✅ Tier $tier: $label"
  else
    missing=$((missing + 1))
    echo "  ❌ Tier $tier: $label"
    echo "       need: $MODELS_DIR/$file"
    echo "       from: $url"
  fi
done
echo ""

if [ "$missing" -eq 0 ]; then
  echo "✅ All models present. Start them with:"
  echo "     bash demo_llm_proxy/start-local-models.sh start"
  exit 0
fi

echo "⚠️  $missing model(s) missing — download the exact filenames above into $MODELS_DIR,"
echo "    then run: bash demo_llm_proxy/start-local-models.sh start"
echo ""
