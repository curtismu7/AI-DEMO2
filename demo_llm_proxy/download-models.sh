#!/bin/bash
# download-models.sh — download required GGUF models for multi-model LLM proxy
#
# Usage: bash demo_llm_proxy/download-models.sh
#
# Checks for required models in /Users/cmuir/models and prompts to download if missing.
# All models are quantized GGUF format optimized for llama.cpp.

set -e

MODELS_DIR="/Users/cmuir/models"
mkdir -p "$MODELS_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔷 Multi-Model LLM Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Required models for the 4-tier LLM proxy:"
echo "  1. Phi-2 (2.7B)      — simple explanations, fast"
echo "  2. Phi-3 (3.8B)      — moderate complexity"
echo "  3. Qwen3-8b (8B)     — complex reasoning"
echo "  4. Gemma-4-12B (12B) — advanced, fallback"
echo ""
echo "Models directory: $MODELS_DIR"
echo ""

# Helper to check if model exists (allowing slight name variations)
check_model() {
  local name="$1"
  local dir="$MODELS_DIR"

  case "$name" in
    phi-2)
      [ -f "$dir"/*phi-2*.gguf ] && echo "found" || echo "missing"
      ;;
    phi-3)
      [ -f "$dir"/*phi-3*.gguf ] && echo "found" || echo "missing"
      ;;
    qwen)
      [ -f "$dir"/*qwen*8b*.gguf ] && echo "found" || echo "missing"
      ;;
    gemma)
      [ -f "$dir"/*gemma*4*12*.gguf ] && echo "found" || echo "missing"
      ;;
  esac
}

# Check each model
echo "Checking for required models..."
phi2_status=$(check_model phi-2)
phi3_status=$(check_model phi-3)
qwen_status=$(check_model qwen)
gemma_status=$(check_model gemma)

echo "  Phi-2:        [$phi2_status]"
echo "  Phi-3:        [$phi3_status]"
echo "  Qwen3-8b:     [$qwen_status]"
echo "  Gemma-4-12B:  [$gemma_status]"
echo ""

# Count how many are missing
missing=0
[ "$phi2_status" = "missing" ] && ((missing++))
[ "$phi3_status" = "missing" ] && ((missing++))
[ "$qwen_status" = "missing" ] && ((missing++))
[ "$gemma_status" = "missing" ] && ((missing++))

if [ "$missing" -eq 0 ]; then
  echo "✅ All models are present!"
  echo ""
  exit 0
fi

echo "⚠️  $missing model(s) missing. You can download them manually:"
echo ""

if [ "$phi2_status" = "missing" ]; then
  echo "📥 Phi-2 (2.7B, ~5.5GB):"
  echo "   Download from Hugging Face:"
  echo "   https://huggingface.co/TheBloke/phi-2-GGUF/blob/main/phi-2.Q4_0.gguf"
  echo "   Save to: $MODELS_DIR/phi-2.gguf"
  echo ""
fi

if [ "$phi3_status" = "missing" ]; then
  echo "📥 Phi-3 (3.8B, ~2.3GB):"
  echo "   Download from Hugging Face:"
  echo "   https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/blob/main/Phi-3-mini-4k-instruct-q4.gguf"
  echo "   Save to: $MODELS_DIR/phi-3.gguf"
  echo ""
fi

if [ "$qwen_status" = "missing" ]; then
  echo "📥 Qwen3-8b (8B):"
  echo "   Download from Hugging Face:"
  echo "   https://huggingface.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF/blob/main/Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf"
  echo "   (Note: Use qwen2.5-coder-8b or similar if available)"
  echo "   Save to: $MODELS_DIR/qwen3-8b.gguf"
  echo ""
fi

if [ "$gemma_status" = "missing" ]; then
  echo "📥 Gemma-4-12B (12B):"
  echo "   Download from Hugging Face:"
  echo "   https://huggingface.co/bartowski/gemma-2-27b-it-GGUF"
  echo "   (Use the Q4_K_XL quantized version)"
  echo "   Save to: $MODELS_DIR/gemma-4-12b-it-UD-Q4_K_XL.gguf"
  echo ""
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "After downloading models, run:"
echo "  docker compose up -d llm-phi2 llm-phi3 llm-qwen llm-gemma"
echo ""
