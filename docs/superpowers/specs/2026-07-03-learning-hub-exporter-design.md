# Learning Hub Auto-Export (Design)

**Date:** 2026-07-03
**Status:** Approved by user (brainstorming session); push+merge pre-authorized.

## Goal

When the in-app education panels change in the local main checkout, automatically
regenerate and push the public GitHub Pages mirror
(`curtismu7/llama-vscode-setup-guide` → `learning/*.html`), so the public site
stops drifting from the app.

## Decisions (from brainstorming)

- **Where it runs:** the user's machine, capturing from the running stack at
  `https://api.ping.demo:4000` (Playwright). No CI build.
- **Trigger:** git hooks (husky `post-merge` + `post-checkout` in AI-DEMO2),
  firing only when the operation changed
  `demo_api_ui/src/components/education/`. Runs in the background; never blocks
  or fails the git operation. Manual escape hatch: `npm run export:learning`.
  Known gap (accepted): the "landing via `git show origin/main: > file`" flow
  performs no git operation and will not fire the hook — the landing procedure
  notes are updated to run the export manually afterward.
- **Approach:** Playwright capture (mechanizes the manual CIBA/CIMD process),
  chosen over server-side React rendering (context/style divergence risk) and
  live embedding (impossible + licensing risk).

## Components

### 1. Manifest — `scripts/learning-hub-manifest.json`

One entry per generated public page:

```json
{
  "file": "mcp-server-discovery.html",
  "title": "MCP Server Discovery",
  "card": "MCP Server Discovery",            // Learning Hub card label to click
  "tabs": ["Available tools", "Server discovery", "Live inspector"],  // subset; omit = all tabs
  "skipTabs": ["▶ Try It"],                   // interactive tabs, never captured
  "intro": "<p>...link to mcp-protocol.html...</p>",  // optional lead-in HTML
  "drawer": ".ciba-drawer"                    // optional custom drawer selector (CIBA/CIMD)
}
```

Top-level: `pages[]`, `exclude[]` (education ids never exported — starts with
`machine-iam-survey` for Gartner licensing), `siteDir` defaults.
Tab subsets preserve the intentionally-trimmed pages (mcp-server-discovery,
mcp-mfa-gate-on-tools, pkce-deep-dive). Non-panel pages (index.html,
architecture.html, pingone-mcp-tools.html, assets) are never touched.

### 2. Exporter — `scripts/export-learning-hub.mjs`

`node scripts/export-learning-hub.mjs [--dry-run] [--only <file.html>]`
(root `package.json` script `export:learning`; Playwright resolved from
`demo_api_ui/node_modules`).

1. Preflight: stack reachable (GET /learning) else log + exit 0 ("stack not
   running — export skipped").
2. For each manifest page: open `/learning`, click the card, wait for the
   drawer, click each tab (skipping `skipTabs`), serialize the tab body HTML.
3. Freeze live-state artifacts: strip `token-chain-spinner` elements, rewrite
   "Acquiring…"/in-flight badges to static "Pending" (same as the manual CIBA
   fix).
4. Compose the page in the existing snapshot format: `snap-top` breadcrumb,
   `snap-title`, `snap-toc` ("On this page — N sections", `sec-<slug>` ids),
   stacked `snap-tab` sections, `snap-foot` ("The AI Demo Learning Hub · back
   to index"), the standard `#backToTop` style/button/script block.
5. Licensing guard: refuse (hard error, nothing pushed) if any generated page
   matches /gartner/i or belongs to `exclude`.
6. Mirror sync: clone-or-pull `~/.cache/learning-hub-mirror` (via `gh`/git
   credentials already on the machine). Write generated pages; `git status` the
   mirror; if changes and not `--dry-run`: commit
   ("chore: auto-export learning hub (<n> pages)") and push to `main`.
7. Report: per-page OK/changed/failed; warn on panels/cards with no manifest
   entry (no auto index editing — YAGNI); one page failing does not block the
   others; failed pages are not written.
8. Log to `logs/learning-hub-export.log` when run from the hook.

### 3. Hooks — `.husky/post-merge`, `.husky/post-checkout`

Guard: `git diff --name-only <old> <new> | grep -q '^demo_api_ui/src/components/education/'`
(post-merge: ORIG_HEAD..HEAD; post-checkout: $1..$2, branch checkouts only).
On match: `nohup npm run export:learning >> logs/learning-hub-export.log 2>&1 &`.
Never exits non-zero.

### 4. Process note

Update memory/landing notes: after landing education-panel files into the main
checkout, run `npm run export:learning`.

## Acceptance

- `--dry-run` generates every manifest page from the running stack; diff vs the
  live site is reviewed — small serialization deltas are acceptable and get
  baselined by the first real push; content must match the app.
- Gartner guard verified: adding a fake "Gartner" string to a captured page in
  a test run aborts the push.
- Hook fires on a merge touching education files; skips cleanly when the stack
  is down.

## Out of scope

- CI builds; auto-editing `learning/index.html` (new topics warn only);
  exporting non-panel pages; Google Docs sync.
