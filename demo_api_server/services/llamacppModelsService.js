// demo_api_server/services/llamacppModelsService.js — inventory, HF downloads, and dedupe for local GGUF tiers.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  MODELS_DIR,
  TIERS,
  resolveModelPath,
  hfRepoUrl,
} = require('../../demo_llm_proxy/modelCatalog');

/** @type {Map<string, object>} */
const downloadJobs = new Map();

/** Sum byte size of a directory tree (best-effort). */
function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

/** Return tier inventory with on-disk presence and alias resolution. */
function getInventory() {
  const tiers = TIERS.map((tier) => {
    const resolved = resolveModelPath(tier);
    const stat = !resolved.missing ? fs.statSync(resolved.path) : null;
    const satisfiedByAlias = Boolean(tier.aliasFile && resolved.viaAlias);
    return {
      tier: tier.tier,
      port: tier.port,
      pinName: tier.pinName,
      file: tier.file,
      label: tier.label,
      repo: tier.repo,
      repoUrl: hfRepoUrl(tier.repo),
      sizeBytes: tier.sizeBytes,
      present: !resolved.missing,
      aliased: resolved.viaAlias,
      aliasFile: tier.aliasFile || null,
      bytesOnDisk: stat?.size ?? 0,
      skipDownload: satisfiedByAlias,
    };
  });

  const cacheDir = path.join(MODELS_DIR, '.cache');
  const duplicateCandidates = tiers.filter((t) => {
    if (!t.aliasFile) return false;
    const direct = path.join(MODELS_DIR, t.file);
    const source = path.join(MODELS_DIR, t.aliasFile);
    return fs.existsSync(direct) && fs.existsSync(source) && !fs.lstatSync(direct).isSymbolicLink();
  }).map((t) => t.file);

  return {
    modelsDir: MODELS_DIR,
    tiers,
    cacheBytes: dirSizeBytes(cacheDir),
    duplicateFiles: duplicateCandidates,
    totalBytesOnDisk: tiers.reduce((sum, t) => sum + (t.present && !t.aliased ? t.bytesOnDisk : 0), 0),
  };
}

/** Remove Hugging Face download cache under MODELS_DIR. */
function cleanupHfCache() {
  const cacheDir = path.join(MODELS_DIR, '.cache');
  if (!fs.existsSync(cacheDir)) return 0;
  const freed = dirSizeBytes(cacheDir);
  fs.rmSync(cacheDir, { recursive: true, force: true });
  return freed;
}

/** Symlink duplicate tier files to canonical copies and clear HF cache. */
function dedupeModels() {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  let freedBytes = cleanupHfCache();
  const actions = [];

  for (const tier of TIERS) {
    if (!tier.aliasFile) continue;
    const target = path.join(MODELS_DIR, tier.file);
    const source = path.join(MODELS_DIR, tier.aliasFile);
    if (!fs.existsSync(source)) continue;

    if (fs.existsSync(target)) {
      const link = fs.lstatSync(target);
      if (link.isSymbolicLink()) {
        actions.push({ action: 'already_linked', file: tier.file, target: tier.aliasFile });
        continue;
      }
      const targetSize = fs.statSync(target).size;
      fs.unlinkSync(target);
      freedBytes += targetSize;
      fs.symlinkSync(tier.aliasFile, target);
      actions.push({ action: 'replaced_with_symlink', file: tier.file, target: tier.aliasFile, freedBytes: targetSize });
    } else {
      fs.symlinkSync(tier.aliasFile, target);
      actions.push({ action: 'linked', file: tier.file, target: tier.aliasFile });
    }
  }

  return { freedBytes, actions, modelsDir: MODELS_DIR };
}

/** Poll partial download size for an in-flight job. */
function refreshJobProgress(job) {
  const dest = path.join(MODELS_DIR, job.file);
  if (fs.existsSync(dest)) {
    job.downloadedBytes = fs.statSync(dest).size;
  }
  job.progressPct = job.totalSizeBytes && job.downloadedBytes != null
    ? Math.min(100, Math.round((job.downloadedBytes / job.totalSizeBytes) * 100))
    : null;
}

/** Start downloading a tier GGUF via `hf download`. */
function startDownload(tierNum) {
  const tier = TIERS.find((t) => t.tier === Number(tierNum));
  if (!tier) {
    const err = new Error(`Unknown tier: ${tierNum}`);
    err.code = 'UNKNOWN_TIER';
    throw err;
  }

  const resolved = resolveModelPath(tier);
  if (!resolved.missing) {
    if (resolved.viaAlias) {
      return { status: 'satisfied_by_alias', tier: tier.tier, aliasFile: tier.aliasFile };
    }
    return { status: 'already_present', tier: tier.tier, file: tier.file };
  }

  for (const job of downloadJobs.values()) {
    if (job.tier === tier.tier && job.status === 'running') {
      return { status: 'already_running', jobId: job.id, tier: tier.tier };
    }
  }

  fs.mkdirSync(MODELS_DIR, { recursive: true });

  const jobId = randomUUID();
  const job = {
    id: jobId,
    tier: tier.tier,
    file: tier.file,
    label: tier.label,
    status: 'running',
    downloadedBytes: 0,
    totalSizeBytes: tier.sizeBytes,
    progressPct: 0,
    error: null,
  };
  downloadJobs.set(jobId, job);

  const child = spawn('hf', ['download', tier.repo, tier.file, '--local-dir', MODELS_DIR], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const poll = setInterval(() => {
    if (job.status !== 'running') {
      clearInterval(poll);
      return;
    }
    refreshJobProgress(job);
    if (job.downloadedBytes >= job.totalSizeBytes * 0.995) {
      job.status = 'completed';
      job.progressPct = 100;
      cleanupHfCache();
      clearInterval(poll);
    }
  }, 2000);

  child.on('close', (code) => {
    clearInterval(poll);
    refreshJobProgress(job);
    const dest = path.join(MODELS_DIR, job.file);
    if (code === 0 && fs.existsSync(dest)) {
      job.status = 'completed';
      job.downloadedBytes = fs.statSync(dest).size;
      job.progressPct = 100;
      cleanupHfCache();
      if (tier.aliasFile) dedupeModels();
    } else if (job.status !== 'completed') {
      job.status = 'failed';
      job.error = code === 0 ? 'download finished but file missing' : `hf download exited ${code}`;
    }
  });

  child.on('error', (err) => {
    clearInterval(poll);
    job.status = 'failed';
    job.error = err.message;
  });

  return { status: 'started', jobId, tier: tier.tier, file: tier.file, totalSizeBytes: tier.sizeBytes };
}

/** Return download job status for polling. */
function getDownloadStatus(jobId) {
  const job = downloadJobs.get(jobId);
  if (!job) return null;
  if (job.status === 'running') refreshJobProgress(job);
  return {
    ok: true,
    job_id: job.id,
    tier: job.tier,
    file: job.file,
    status: job.status,
    downloaded_bytes: job.downloadedBytes,
    total_size_bytes: job.totalSizeBytes,
    progress_pct: job.progressPct,
    error: job.error,
  };
}

module.exports = {
  getInventory,
  startDownload,
  getDownloadStatus,
  dedupeModels,
  cleanupHfCache,
  _downloadJobs: downloadJobs,
};
