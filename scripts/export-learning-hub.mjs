#!/usr/bin/env node
// scripts/export-learning-hub.mjs
//
// Captures the in-app Learning Hub education panels (via Playwright, from the
// running local stack) and mirrors them as static pages into the public
// GitHub Pages repo (curtismu7/llama-vscode-setup-guide -> learning/*.html).
//
// Usage:
//   node scripts/export-learning-hub.mjs [--dry-run] [--only <file.html>]
//
// See docs/superpowers/specs/2026-07-03-learning-hub-exporter-design.md for
// the full design.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import https from "node:https";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const LEARNING_URL = "https://api.ping.demo:4000/learning";
const MANIFEST_PATH = path.join(__dirname, "learning-hub-manifest.json");
const MIRROR_DIR =
  process.env.LEARNING_HUB_MIRROR_DIR ||
  path.join(os.homedir(), ".cache", "learning-hub-mirror");
const MIRROR_REMOTE = "https://github.com/curtismu7/llama-vscode-setup-guide.git";

// Pages/dirs in the mirror that this exporter must NEVER touch, even
// defensively (belt-and-suspenders on top of the manifest never listing them).
const PROTECTED_FILES = new Set([
  "index.html",
  "architecture.html",
  "pingone-mcp-tools.html",
  "machine-iam-for-agentic-ai.html",
]);

// Learning Hub cards that navigate away or are app-only — expected to have no
// manifest entry. Anything else missing a manifest entry gets a warning.
const KNOWN_APP_ONLY_CARDS = new Set([
  "Guided Demo Tour",
  "Enterprise-Managed Auth (EMA)",
  "WebMCP (Google)",
  "Agentic Trust",
  "OWASP Agentic",
  "Gartner Machine IAM Survey",
]);

const CUSTOM_DRAWER_MAP = {
  ".ciba-drawer": { tabButtons: ".ciba-tabs button", body: ".ciba-body" },
  ".cimd-drawer": { tabButtons: '.cimd-tabs button[role="tab"]', body: ".cimd-body" },
};
const DEFAULT_DRAWER = { tabButtons: ".edu-drawer-tab", body: ".edu-drawer-body" };

const BACK_TO_TOP_BLOCK = `<style>
#backToTop{position:fixed;right:22px;bottom:22px;z-index:50;background:#1c2230;color:#fff;border:0;border-radius:999px;padding:10px 18px;font:600 .9rem -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(28,34,48,.35);opacity:0;visibility:hidden;transform:translateY(8px);transition:opacity .2s,transform .2s,visibility .2s}
#backToTop.show{opacity:1;visibility:visible;transform:translateY(0)}
#backToTop:hover{background:#39435c}
</style>
<button id="backToTop" type="button" aria-label="Back to top">↑ Top</button>
<script>
(function(){
  var btn=document.getElementById('backToTop');
  window.addEventListener('scroll',function(){btn.classList.toggle('show',window.scrollY>400);},{passive:true});
  btn.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});
})();
</script>`;

// ── CLI args ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const onlyIdx = argv.indexOf("--only");
const ONLY_FILE = onlyIdx !== -1 ? argv[onlyIdx + 1] : null;
// Hidden test flag used only to verify the Gartner licensing guard aborts the
// run (see acceptance criteria in the design doc). Never used in real runs.
const TEST_INJECT_GARTNER = argv.includes("--test-inject-gartner");

// ── Playwright resolution ───────────────────────────────────────────────────

function resolvePlaywrightChromium() {
  const candidates = [
    path.join(REPO_ROOT, "demo_api_ui", "package.json"),
  ];
  let lastErr;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const req = createRequire(candidate);
    for (const pkg of ["playwright", "@playwright/test"]) {
      try {
        const mod = req(pkg);
        if (mod && mod.chromium) return mod.chromium;
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw new Error(
    `Could not resolve a Playwright install providing chromium (looked in ` +
      `${candidates.join(", ")}). Last error: ${lastErr?.message}`,
  );
}

// ── Reachability preflight ──────────────────────────────────────────────────

function checkStackReachable(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { rejectUnauthorized: false, timeout: 5000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slugify(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSection(label, innerHtml) {
  const slug = slugify(label);
  return `<section class="snap-tab" id="sec-${slug}"><h3 class="snap-tab-h">${escapeHtml(label)}</h3>${innerHtml}</section>`;
}

function composePage(entry, sections) {
  const title = entry.title;
  const toc = sections
    .map((s) => `<li><a href="#sec-${s.slug}">${escapeHtml(s.label)}</a></li>`)
    .join("");
  const tocLabel = `On this page — ${sections.length} section${sections.length === 1 ? "" : "s"}`;
  const body = (entry.intro || "") + sections.map((s) => s.html).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — AI Demo Learning Hub</title>
<link rel="stylesheet" href="assets/app.css">
<link rel="stylesheet" href="assets/snapshot.css">
</head><body>
<div class="snap-top"><a href="index.html">← Learning Hub</a><span class="crumb">/ ${escapeHtml(title)}</span></div>
<div class="edu-drawer snap-drawer">
<div class="snap-title">${escapeHtml(title)}</div>
<nav class="snap-toc"><span class="snap-toc-label">${tocLabel}</span><ul>${toc}</ul></nav>
<div class="edu-drawer-body">
${body}
</div></div>
<div class="snap-foot">The AI Demo Learning Hub · <a href="index.html">back to index</a></div>
${BACK_TO_TOP_BLOCK}
</body></html>`;
}

function normalize(html) {
  return html.replace(/\r\n/g, "\n").trim() + "\n";
}

// ── Playwright capture ───────────────────────────────────────────────────────

async function clickCard(page, label) {
  const clicked = await page.evaluate((label) => {
    const titles = Array.from(document.querySelectorAll(".learning-hub__card-title"));
    const match = titles.find((el) => el.textContent.trim() === label);
    if (!match) return false;
    const btn = match.closest("button.learning-hub__card");
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`card not found on /learning: "${label}"`);
}

async function waitForDrawer(page, entry) {
  if (entry.drawer) {
    const openClass = `${entry.drawer.slice(1)}--open`;
    await page.waitForSelector(`${entry.drawer}.${openClass}`, {
      state: "visible",
      timeout: 10000,
    });
  } else {
    await page.waitForSelector(".edu-drawer", { state: "visible", timeout: 10000 });
  }
}

async function clickTab(page, tabButtonsSelector, label) {
  const clicked = await page.evaluate(
    ({ sel, label }) => {
      const btns = Array.from(document.querySelectorAll(sel));
      const btn = btns.find((b) => b.textContent.trim() === label);
      if (!btn) return false;
      btn.click();
      return true;
    },
    { sel: tabButtonsSelector, label },
  );
  if (!clicked) throw new Error(`tab not found: "${label}" (selector ${tabButtonsSelector})`);
}

async function captureBodyHtml(page, bodySelector) {
  return page.evaluate((sel) => {
    const bodyEl = document.querySelector(sel);
    if (!bodyEl) return null;
    const clone = bodyEl.cloneNode(true);

    // Freeze live-state artifacts so the static mirror doesn't ship an
    // in-flight spinner or "Acquiring…" state.
    clone.querySelectorAll(".token-chain-spinner").forEach((el) => el.remove());
    clone.querySelectorAll(".token-chain-badge--acquiring").forEach((el) => {
      el.classList.remove("token-chain-badge--acquiring");
      el.classList.add("token-chain-badge--waiting");
      el.textContent = "Pending";
    });
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);
    textNodes.forEach((node) => {
      if (node.nodeValue && node.nodeValue.includes("Acquiring")) {
        node.nodeValue = node.nodeValue.replace(/Acquiring[….]*/g, "Pending");
      }
    });

    return clone.innerHTML;
  }, bodySelector);
}

async function capturePage(page, entry) {
  await page.goto(LEARNING_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".learning-hub__card", { timeout: 15000 });
  await clickCard(page, entry.card);
  await waitForDrawer(page, entry);

  const drawerCfg = entry.drawer ? CUSTOM_DRAWER_MAP[entry.drawer] : DEFAULT_DRAWER;
  if (!drawerCfg) throw new Error(`unknown custom drawer selector in manifest: ${entry.drawer}`);

  await page.waitForSelector(drawerCfg.tabButtons, { timeout: 10000 });
  const allTabs = await page.$$eval(drawerCfg.tabButtons, (els) =>
    els.map((el) => el.textContent.trim()),
  );

  const skip = new Set(entry.skipTabs || []);
  const targetLabels =
    entry.tabs && entry.tabs.length ? entry.tabs : allTabs.filter((t) => !skip.has(t));

  const sections = [];
  for (const label of targetLabels) {
    if (skip.has(label)) continue;
    if (!allTabs.includes(label)) {
      throw new Error(`tab "${label}" not found (available: ${allTabs.join(", ")})`);
    }
    await clickTab(page, drawerCfg.tabButtons, label);
    await page.waitForTimeout(200);
    const innerHtml = await captureBodyHtml(page, drawerCfg.body);
    if (innerHtml == null) {
      throw new Error(`body selector "${drawerCfg.body}" not found after clicking "${label}"`);
    }
    sections.push({ label, slug: slugify(label), html: buildSection(label, innerHtml) });
  }
  if (!sections.length) throw new Error("no tabs captured");

  return composePage(entry, sections);
}

async function warnUnmappedCards(page, manifestCards) {
  try {
    await page.goto(LEARNING_URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector(".learning-hub__card-title", { timeout: 15000 });
    const cards = await page.$$eval(".learning-hub__card-title", (els) =>
      els.map((e) => e.textContent.trim()),
    );
    const unmapped = cards.filter(
      (c) => !manifestCards.has(c) && !KNOWN_APP_ONLY_CARDS.has(c),
    );
    if (unmapped.length) {
      console.warn(
        `[export-learning-hub] WARNING: Learning Hub cards with no manifest entry (new topic?): ${unmapped.join(", ")}`,
      );
    }
  } catch (err) {
    console.warn(`[export-learning-hub] WARNING: could not check for unmapped cards: ${err.message}`);
  }
}

// ── Mirror repo handling ─────────────────────────────────────────────────────

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
}

function ensureMirror() {
  if (!fs.existsSync(path.join(MIRROR_DIR, ".git"))) {
    fs.mkdirSync(path.dirname(MIRROR_DIR), { recursive: true });
    run("git", ["clone", MIRROR_REMOTE, MIRROR_DIR]);
  } else {
    run("git", ["-C", MIRROR_DIR, "fetch", "origin", "main"]);
    run("git", ["-C", MIRROR_DIR, "reset", "--hard", "origin/main"]);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const manifest = JSON.parse(await fsp.readFile(MANIFEST_PATH, "utf8"));
  const exclude = new Set(manifest.exclude || []);
  let pages = manifest.pages.filter(
    (p) => !exclude.has(path.basename(p.file, ".html")),
  );
  if (ONLY_FILE) pages = pages.filter((p) => p.file === ONLY_FILE);

  const reachable = await checkStackReachable(LEARNING_URL);
  if (!reachable) {
    console.log("[export-learning-hub] stack not running — export skipped");
    process.exit(0);
  }

  const chromium = resolvePlaywrightChromium();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await warnUnmappedCards(page, new Set(manifest.pages.map((p) => p.card)));

  const results = [];
  for (const entry of pages) {
    try {
      const html = await capturePage(page, entry);
      results.push({ entry, html, status: "captured" });
    } catch (err) {
      results.push({ entry, status: "failed", error: err.message });
    }
  }

  await browser.close();

  // ── Licensing guard — mandatory, hard-abort before any mirror write ────────
  for (const r of results) {
    if (r.status !== "captured") continue;
    if (TEST_INJECT_GARTNER) {
      r.html = r.html.replace("</body>", "<p>Gartner says hi</p></body>");
    }
    if (/gartner/i.test(r.html) || exclude.has(path.basename(r.entry.file, ".html"))) {
      console.error(
        `[export-learning-hub] ABORT: generated page "${r.entry.file}" matches the Gartner/exclude licensing guard. Nothing written or pushed.`,
      );
      process.exit(1);
    }
  }

  ensureMirror();
  const learningDir = path.join(MIRROR_DIR, manifest.siteDir || "learning");
  const outDir = DRY_RUN
    ? await fsp.mkdtemp(path.join(os.tmpdir(), "learning-hub-export-"))
    : null;

  const report = [];
  const changedFiles = [];

  for (const r of results) {
    if (r.status !== "captured") {
      report.push({ file: r.entry.file, status: "FAILED", detail: r.error });
      continue;
    }
    if (
      PROTECTED_FILES.has(r.entry.file) ||
      r.entry.file.startsWith("assets/") ||
      r.entry.file.startsWith("architecture/")
    ) {
      console.error(`[export-learning-hub] ABORT: refusing to touch protected mirror file "${r.entry.file}".`);
      process.exit(1);
    }

    const targetPath = path.join(learningDir, r.entry.file);
    const newContent = normalize(r.html);
    let oldContent = null;
    try {
      oldContent = normalize(await fsp.readFile(targetPath, "utf8"));
    } catch {
      // file doesn't exist yet in the mirror — treated as NEW
    }
    const changed = oldContent !== newContent;

    if (DRY_RUN) {
      report.push({
        file: r.entry.file,
        status: !changed ? "UNCHANGED" : oldContent === null ? "NEW" : "CHANGED",
      });
      if (changed) {
        await fsp.writeFile(path.join(outDir, r.entry.file), newContent, "utf8");
      }
    } else if (changed) {
      await fsp.writeFile(targetPath, newContent, "utf8");
      changedFiles.push(r.entry.file);
      report.push({ file: r.entry.file, status: oldContent === null ? "NEW" : "CHANGED" });
    } else {
      report.push({ file: r.entry.file, status: "UNCHANGED" });
    }
  }

  if (!DRY_RUN && changedFiles.length > 0) {
    run("git", ["-C", MIRROR_DIR, "add", ...changedFiles.map((f) => path.join("learning", f))]);
    run("git", [
      "-C",
      MIRROR_DIR,
      "commit",
      "-m",
      `chore: auto-export learning hub (${changedFiles.length} pages)`,
    ]);
    run("git", ["-C", MIRROR_DIR, "push", "origin", "main"]);
  }

  // ── Final report ─────────────────────────────────────────────────────────
  console.log(`[export-learning-hub] ${DRY_RUN ? "DRY RUN " : ""}report:`);
  for (const r of report) {
    console.log(`  ${r.status.padEnd(9)} ${r.file}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const failed = report.filter((r) => r.status === "FAILED").length;
  const changed = report.filter((r) => r.status === "CHANGED" || r.status === "NEW").length;
  console.log(
    `[export-learning-hub] ${report.length} pages: ${changed} changed, ${failed} failed.` +
      (DRY_RUN ? ` Diffs (if any) written to ${outDir}` : ""),
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(`[export-learning-hub] fatal error: ${err.stack || err.message}`);
  process.exit(1);
});
