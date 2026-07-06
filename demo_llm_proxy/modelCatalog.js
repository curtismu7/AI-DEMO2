// demo_llm_proxy/modelCatalog.js — single source of truth for local LLM tier GGUFs.
// Consumed by start-local-models.sh (via Node helpers), BFF download UI, and router pins.

const fs = require('fs');
const path = require('path');
const os = require('os');

const MODELS_DIR = process.env.MODELS_DIR || path.join(os.homedir(), 'models');

/** @type {Array<{tier:number,port:number,pinName:string,file:string,label:string,repo:string,sizeBytes:number}>} */
const TIERS = [
  {
    tier: 1,
    port: 8091,
    pinName: 'gemma-3-4b-it',
    file: 'gemma-3-4b-it-qat-Q4_0.gguf',
    label: 'Gemma-3-4B (4B) — simple, fast',
    repo: 'unsloth/gemma-3-4b-it-qat-GGUF',
    sizeBytes: 2_360_000_000,
  },
  {
    tier: 2,
    port: 8092,
    pinName: 'gemma-4-12b-it',
    file: 'gemma-3-12b-it-qat-UD-Q4_K_XL.gguf',
    label: 'Gemma-3-12B qat (12B) — moderate',
    repo: 'unsloth/gemma-3-12b-it-qat-GGUF',
    sizeBytes: 6_900_000_000,
  },
  {
    tier: 3,
    port: 8093,
    pinName: 'starcoder2-15b-instruct',
    file: 'starcoder2-15b-instruct-v0.1-Q4_K_M.gguf',
    label: 'StarCoder2-15B-Instruct (15B) — complex',
    repo: 'bartowski/starcoder2-15b-instruct-v0.1-GGUF',
    sizeBytes: 9_200_000_000,
  },
  {
    tier: 4,
    port: 8094,
    pinName: 'gemma-4-12b',
    file: 'gemma-3-12b-it-UD-Q4_K_XL.gguf',
    label: 'Gemma-3-12B (12B) — fallback',
    repo: 'unsloth/gemma-3-12b-it-GGUF',
    sizeBytes: 6_900_000_000,
    aliasFile: 'gemma-3-12b-it-qat-UD-Q4_K_XL.gguf',
  },
  {
    tier: 5,
    port: 8096,
    pinName: 'gpt-oss-20b',
    file: 'gpt-oss-20b-mxfp4.gguf',
    label: 'gpt-oss-20B (20B) — top tier',
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
