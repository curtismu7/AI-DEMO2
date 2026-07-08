#!/usr/bin/env node
// scripts/publish-agent-guardrails-page.mjs
//
// Publishes ping_agent_guardrails_diagram.html to the public GitHub Pages
// mirror (curtismu7/llama-vscode-setup-guide -> learning/agent-guardrails.html).
//
// Usage:
//   node scripts/publish-agent-guardrails-page.mjs [--dry-run]

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const SOURCE_HTML = path.join(REPO_ROOT, "ping_agent_guardrails_diagram.html");
const OUTPUT_FILE = "agent-guardrails.html";
const PUBLIC_URL =
  "https://curtismu7.github.io/llama-vscode-setup-guide/learning/agent-guardrails.html";
const MIRROR_DIR =
  process.env.LEARNING_HUB_MIRROR_DIR ||
  path.join(os.homedir(), ".cache", "learning-hub-mirror");
const MIRROR_REMOTE = "https://github.com/curtismu7/llama-vscode-setup-guide.git";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");

const INDEX_CARD =
  '<a class="lx-card" href="agent-guardrails.html"><div class="lx-t">Agent Guardrails</div><div class="lx-b">interactive diagram →</div></a>';

const BREADCRUMB_STYLE = `<style>
.snap-top{display:flex;align-items:center;gap:8px;max-width:1180px;margin:0 auto;padding:14px 24px 0;font:600 .9rem -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#5a6271}
.snap-top a{color:#6b46ff;text-decoration:none}
.snap-top a:hover{text-decoration:underline}
.snap-top .crumb{color:#5a6271}
</style>`;

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

/** Clone or pull the GitHub Pages mirror repo. */
function syncMirror() {
  if (fs.existsSync(path.join(MIRROR_DIR, ".git"))) {
    execFileSync("git", ["-C", MIRROR_DIR, "pull", "--ff-only"], {
      stdio: "inherit",
    });
    return;
  }
  fs.mkdirSync(path.dirname(MIRROR_DIR), { recursive: true });
  execFileSync("git", ["clone", MIRROR_REMOTE, MIRROR_DIR], {
    stdio: "inherit",
  });
}

/** Build the public page HTML from the repo source file. */
async function buildPublicPage() {
  let html = await fsp.readFile(SOURCE_HTML, "utf8");

  html = html.replace(
    /<title>[^<]*<\/title>/,
    "<title>Agent Guardrails — AI Demo Learning Hub</title>",
  );

  if (!html.includes("snap-top")) {
    html = html.replace(
      "</head>",
      `${BREADCRUMB_STYLE}</head>`,
    );
    html = html.replace(
      "<body>",
      `<body>
<div class="snap-top"><a href="index.html">← Learning Hub</a><span class="crumb">/ Agent Guardrails</span></div>`,
    );
  }

  if (!html.includes('id="backToTop"')) {
    html = html.replace("</body>", `${BACK_TO_TOP_BLOCK}\n</body>`);
  }

  return html;
}

/** Add the Agent Guardrails card to learning/index.html when missing. */
async function ensureIndexCard() {
  const indexPath = path.join(MIRROR_DIR, "learning", "index.html");
  let indexHtml = await fsp.readFile(indexPath, "utf8");

  if (indexHtml.includes("agent-guardrails.html")) {
    return false;
  }

  const archSection =
    '<section class="lx-cat"><h2>🏗️ Architecture</h2><div class="lx-grid">';
  if (indexHtml.includes(archSection)) {
    indexHtml = indexHtml.replace(
      archSection,
      `${archSection}${INDEX_CARD}`,
    );
  } else {
    indexHtml = indexHtml.replace(
      '<div class="lx-foot">',
      `<section class="lx-cat"><h2>🏗️ Architecture</h2><div class="lx-grid">${INDEX_CARD}</div></section><div class="lx-foot">`,
    );
  }

  const countMatch = indexHtml.match(/(\d+) topic pages/);
  if (countMatch) {
    const next = Number(countMatch[1]) + 1;
    indexHtml = indexHtml.replace(
      countMatch[0],
      `${next} topic pages`,
    );
  }

  await fsp.writeFile(indexPath, indexHtml, "utf8");
  return true;
}

/** Commit and push mirror changes unless this is a dry run. */
function commitAndPush(changedFiles) {
  if (DRY_RUN || changedFiles.length === 0) {
    console.log(
      DRY_RUN
        ? `[dry-run] Would publish: ${changedFiles.join(", ") || "(no changes)"}`
        : "No changes to publish.",
    );
    return;
  }

  for (const file of changedFiles) {
    execFileSync("git", ["-C", MIRROR_DIR, "add", file], { stdio: "inherit" });
  }

  execFileSync(
    "git",
    [
      "-C",
      MIRROR_DIR,
      "commit",
      "-m",
      "chore: publish agent guardrails diagram page",
    ],
    { stdio: "inherit" },
  );
  execFileSync("git", ["-C", MIRROR_DIR, "push", "origin", "main"], {
    stdio: "inherit",
  });
  console.log(`Published ${PUBLIC_URL}`);
}

async function main() {
  if (!fs.existsSync(SOURCE_HTML)) {
    throw new Error(`Source HTML not found: ${SOURCE_HTML}`);
  }

  syncMirror();
  const pageHtml = await buildPublicPage();
  const outPath = path.join(MIRROR_DIR, "learning", OUTPUT_FILE);
  const prev = fs.existsSync(outPath)
    ? await fsp.readFile(outPath, "utf8")
    : null;

  await fsp.writeFile(outPath, pageHtml, "utf8");

  const changedFiles = [];
  if (prev !== pageHtml) {
    changedFiles.push(`learning/${OUTPUT_FILE}`);
  }

  const indexChanged = await ensureIndexCard();
  if (indexChanged) {
    changedFiles.push("learning/index.html");
  }

  commitAndPush(changedFiles);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
