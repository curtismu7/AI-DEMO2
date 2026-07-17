// demo_llm_proxy/modelCatalog.js — single source of truth for local LLM tier GGUFs.
// Consumed by start-local-models.sh (via Node helpers), BFF download UI, and router pins.
//
// Three tiers (US-origin):
//   Tier 1 — Microsoft Phi-4-mini-instruct (3.8B): small/teaching/classification.
//   Tier 3 — Meta/Groq Llama-3-Groq-8B-Tool-Use (8B): experimental mid-size
//     tool-calling option — being evaluated as a faster alternative to Tier 5
//     for agent tool loops; Groq itself deprecated this model's hosted-API
//     preview in favor of larger models, so treat its tool-call reliability
//     as unproven until tested against this app's real tool schemas.
//   Tier 5 — OpenAI gpt-oss-20b (20B MoE): vibe coding / reasoning / agent brain.

const fs = require('fs');
const path = require('path');
const os = require('os');

const MODELS_DIR = process.env.MODELS_DIR || path.join(os.homedir(), 'models');

/** @type {Array<{tier:number,port:number,pinName:string,file:string,label:string,repo:string,sizeBytes:number}>} */
const TIERS = [
  {
    tier: 1,
    port: 8091,
    pinName: 'phi-4-mini-instruct',
    file: 'microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
    label: 'Phi-4-mini-instruct (3.8B) — small, fast, US-origin',
    repo: 'bartowski/microsoft_Phi-4-mini-instruct-GGUF',
    sizeBytes: 2_490_000_000,
  },
  {
    tier: 3,
    port: 8093,
    pinName: 'llama-3-groq-8b-tool-use',
    file: 'Llama-3-Groq-8B-Tool-Use-Q4_K_M.gguf',
    label: 'Llama-3-Groq-8B-Tool-Use (8B) — experimental, tool-calling, US-origin',
    repo: 'bartowski/Llama-3-Groq-8B-Tool-Use-GGUF',
    sizeBytes: 4_920_000_000,
    // Opt-in only: the router/tier-manager know this tier and will route to it if
    // it is running, but the default local stack does NOT start it, pin it in the
    // UI, or map it in langchainConfig (its GGUF is not part of the standard
    // download set). Machine-readable so the tier-drift guard can compare the
    // default set against those consumers instead of demanding they carry it.
    experimental: true,
  },
  {
    tier: 5,
    port: 8096,
    pinName: 'gpt-oss-20b',
    file: 'gpt-oss-20b-mxfp4.gguf',
    label: 'gpt-oss-20B (20B MoE) — vibe coding / reasoning, US-origin',
    repo: 'ggml-org/gpt-oss-20b-GGUF',
    sizeBytes: 11_000_000_000,
  },
];

/** Resolve the on-disk path for a tier GGUF (follows aliasFile when the canonical name is absent). */
function resolveModelPath(tierDef, modelsDir = MODELS_DIR) {
  const direct = path.join(modelsDir, tierDef.file);
  if (fs.existsSync(direct)) return { path: direct, viaAlias: false };
  if (tierDef.aliasFile) {
    const alias = path.join(modelsDir, tierDef.aliasFile);
    if (fs.existsSync(alias)) return { path: alias, viaAlias: true, aliasFile: tierDef.aliasFile };
  }
  return { path: direct, viaAlias: false, missing: true };
}

function hfRepoUrl(repo) {
  return `https://huggingface.co/${repo}`;
}

module.exports = {
  MODELS_DIR,
  TIERS,
  resolveModelPath,
  hfRepoUrl,
};
