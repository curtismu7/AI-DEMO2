# Your steps: status as of 2026-10-20

Check each box as you finish it. Everything here needs you: your Mac, the SE cluster, the shared PingFederate, a browser sign-in, or a decision. Nothing in this list contains a secret; never paste a token or key into a chat or a PR.

Repos: working repo = the mirror `curtismu7/AI-DEMO2`. Source repo = `cmuir_pingcorp/AI-DEMO2`. Work and merges happen on the mirror; the merge-back is Section 4.

---

## 1. Unstick CI (do this first, everything else queues behind it)

Why: `ci.yml` and `build-images.yml` run on self-hosted runners. Your first mirror runner works. One runner is slow because it also builds images.

- [ ] **1.1 Register a second runner on the mirror.**
  1. Open https://github.com/curtismu7/AI-DEMO2/settings/actions/runners/new and pick macOS. Copy the download commands from that page (they match your chip and the current version).
  2. `mkdir ~/actions-runner-mirror-2 && cd ~/actions-runner-mirror-2`. (Do not reuse `~/actions-runner-2`; it already exists and may belong to the source repo. Check with `cat ~/actions-runner-2/.runner` if you are curious.)
  3. Run the `curl` and `tar` commands from the page.
  4. `./config.sh --url https://github.com/curtismu7/AI-DEMO2 --token <fresh token> --name mirror-mac-2` (generate a new token on that page; they expire in about an hour and work once). Accept the defaults.
  5. Start it in a second terminal tab: `./run.sh`.
  6. Check the runners page: both runners should show Idle or Active.
  - If a job dies with "Could not inspect worker RSS" or an out-of-memory error, the Mac ran out of memory with two heavy jobs at once: stop the second runner.
  - If a job fails with "address already in use", two suites share a fixed port: tell me the job and port.
- [ ] **1.2 Set the public-repo safety option.** In https://github.com/curtismu7/AI-DEMO2/settings/actions (General), set "Fork pull request workflows from outside collaborators" to require approval for all outside collaborators. A self-hosted runner on a public repo would otherwise run other people's PR code on your Mac.
- [ ] **1.3 Merge PR #3355** (https://github.com/curtismu7/AI-DEMO2/pull/3355). It changes the nine `ci.yml` jobs to `runs-on: self-hosted`, so any self-hosted runner can take them. Do this early.
- [ ] **1.4 Watch the queue drain.** https://github.com/curtismu7/AI-DEMO2/actions. The "Build images" run for the newest `main` is the one that matters. Cancel any older queued "Build images" runs for commits that are no longer the tip.
- [ ] **1.5 Decide what to do with the old runner folder** if `~/actions-runner-2` is unused: leave it alone unless `.runner` shows it is dead.

---

## 2. Merge decisions on open pull requests

Merge with "Create a merge commit" (not squash or rebase), so mirror and source histories stay joinable. Wait for green CI where you can.

- [ ] **#3346** Delegation pages in Ping style. Numbers lost in a restart; no measured crossings. Look at the 4 pages first.
- [ ] **#3347** Observability, MCP Observability, Agent Onboarding. Lowers two ratchet pins. Look at the pages first.
- [ ] **#3351** Docs: PF claims to Cedar, decision "group or user".
- [ ] **#3352** Script that provisions the SAML objects on PingFederate. Merging it does not run it (Section 3).
- [ ] **#3353** Playground UI: OIDC | SAML toggle, secrets template, docs.
- [ ] **#3354** Server: SAML assertion and `/issue`. Merge before #3353 for the toggle to do anything.
- [ ] **#3357** Docs only: Cloudflare plan research (see Section 7).
- [ ] **#3358** Two-line CSS fix: ID-JAG implementation page diagram height.
- [ ] **Coming: four PRs** converting the 10 chosen use-case configs (`UC-LEARN11`, `UC-LEARN15`, `UC8`, `UC20`, `UC23`, `UC29`, `UC30`, `UC31`, `UC32`, `UC39`). Review each page on the use-case screen in light and dark. Quality bar you set: 0 crossings at rest and after one box drag.

Already merged this session: #3344, #3349, #3350, #3356, #3345, #3348.

---

## 3. Real SAML in the demo (your steps, in this order)

Everything in the repo is written but none of it has run against a live PingFederate. The plan says these are your steps because they write to the shared SE PingFederate and the cluster.

- [ ] **3.1 Read PR #3352's body.** It has the exact port-forward and `node` commands.
- [ ] **3.2 Port-forward to the PingFederate admin** that issues the demo's ID-JAGs (the shared one, `cmuir-pf.ping-devops.com`, namespace `ping-devops-curtismuir` per the hand-off; confirm in the PR body).
- [ ] **3.3 Dry run first** (reads only):
  `node scripts/pingfederate/configure-saml-idjag.js --ns=<ns> --dry-run`
  It lists the SP connections and exits before any write. Note the two entity ids it prints: the one for `oauth-mcp` mode (the plan says `pf_id_jag_audience`) and the one for `pf-pf` mode (the local PF issuer). Confirm they look right.
- [ ] **3.4 Dry run with the entities:** add `--oauth-mcp-entity=<id> --pf-pf-entity=<id>` and read the plan it prints. If it reports an unfamiliar PingFederate payload field (the script marks five shapes UNVERIFIED), stop and paste the output (no secrets) to me.
- [ ] **3.5 Apply** (same command without `--dry-run`). It is idempotent: `ok / keep / FAIL` per object. To undo: `--remove`.
  - It creates: CA `aidemosamlca`, SAML processor `aiDemoSaml`, policy `aiDemoSamlPolicy`, client `ai-demo-pf-saml`, and one mapping on each SP connection.
  - It writes the client secret to `demo_api_server/.env` (0600) and, only if the signing key is not already set, a new key pair to `deploy-local/saml/signer.env` (0600). Nothing is printed. `deploy-local/` is now git-ignored.
- [ ] **3.6 Put the three secrets into `ai-demo-secrets`:** `SAML_SIGNING_KEY_PEM_B64`, `SAML_SIGNING_CERT_PEM_B64`, `PF_SAML_CLIENT_SECRET`. Copy the first two from `deploy-local/saml/signer.env` into the env file `create-secrets.sh` reads, then run `k8s/create-secrets.sh` as in the `se-k8-deploy` notes. Never print the values.
- [ ] **3.7 Merge #3354, then #3353** on the mirror, then do the merge-back (Section 4).
- [ ] **3.8 Build and deploy from the source repo** after merge-back (Section 4.4).
- [ ] **3.9 Test in a browser on SE, both modes** (`oauth-mcp` and `pf-pf`): sign in, choose SAML, Request ID-JAG (the token header should show `typ oauth-id-jag+jwt`, `sub` = your email), Redeem (HTTP 200).
  - If you were already signed in at the SE PingFederate, sign out and in again first: the callback now stores your email, and SAML gives `403 saml_subject_invalid` until you do.
- [ ] **3.10 Tell me what you saw.** I write only what you report.

---

## 4. Merge the mirror back into `cmuir_pingcorp/AI-DEMO2`

Mirror-only commits so far (more will be added): `16b5a93a`, `91c841b1`, #3344 merge `cd55a0d6`, `68528b93`, #3349 merge `bc14411a`, #3350 merge `f14c7560`, #3356 merge `66671b90`, #3345 merge `f9134c06`, #3348 merge `5da69e1c`.

- [ ] **4.1 Update your local `main` first.** `git switch main && git fetch origin curtismu7 && git merge --ff-only origin/main`. (Your local `main` was stale once and a push overwrote the mirror's `main`.)
- [ ] **4.2 See what is only on the mirror:** `git log --oneline origin/main..curtismu7/main`.
- [ ] **4.3 Bring it in:** `git merge curtismu7/main` then `git push origin main`. Resolve conflicts if any (a conflict means someone also changed that file on the source repo).
- [ ] **4.4 After the push, the source repo's "Build images" workflow runs.** When it succeeds, deploy to SE: `kubectl set image` to `ghcr.io/cmuir_pingcorp/ai-demo-<service>:sha-<merge commit>` for each service you changed (use `kubectl get deploy -n ping-devops-cmuir` for names), then check the pods. You can also use `./run-pingaws.sh` (see the `se-k8-deploy` skill).
- [ ] **4.5 Never force-push to the mirror again** without `git fetch curtismu7` first. In zsh, write `${b}` with braces in loops: `$b:refs` is read as a history modifier.
- [ ] **4.6 Run gitleaks on the history** and tell me the result (the narrow scan's result never reached me): `gitleaks detect --source . --redact`. If it finds anything, rotate it and tell me the rule and file names only.
- [ ] **4.7 Update local `main` again** after the merge-back so it is not stale for next time.

---

## 5. Look at things in a browser (sign in at https://local.ping-devops.com:4000)

Use that host. Other hosts have a different session cookie and passkey `rp.id`.

- [ ] **5.1 Batch 2 diagrams on the live host**, plus the signed-in pages headless checks never rendered: Group Policy, Transaction Consent, AIC Token Exchange.
- [ ] **5.2 Named-page diagrams (#3345, now merged):** Phase 266 has 2 crossings, the DaVinci SDK explainer has 3 after a drag, Dot and Studio were never checked. Look at them and say whether that is acceptable.
- [ ] **5.3 Malicious MCP sign-in click-through** at `/llm-gateway`: Malicious MCP tab, "Sign in with Privilege". Expect to come back to the same tab, signed in. The code trace says yes; nobody has clicked it. If you land on Chat, tell me the host in the address bar and whether you came in through the same browser.
- [ ] **5.4 ID-JAG playground checks on SE** (all still unverified): AIC popup end to end; real password sign-in on the SE PF issuer flow; step 6 (revoke) against the real PF; the Interop panel's kid-workaround rows (needs a kit stack rebuild); and that #1581 is live (the cluster shows it, but no browser check).
- [ ] **5.5 PR #3358 page** (ID-JAG implementation): diagram fits the viewport at desktop and phone width, light and dark.

---

## 6. Decisions only you can make

- [ ] **6.1 PF claims to Cedar.** You chose "group or user". Still needed: which tools map to which groups or users for allow / hold / deny. Send that mapping.
- [ ] **6.2 Tell the Mac session that owns this** (the one that wrote section 0b): "Decision: group or user decides allow/hold/deny. Probe the gateway's Cedar vocabulary; no policy create or PUT without my explicit OK."
- [ ] **6.3 Use-case configs.** After the 10 are reviewed, decide whether to do the remaining ~57.
- [ ] **6.4 Remaining named diagrams:** System Flow (Live), Overview, the hand-built 19-call PF sequence, the crowded PF login figure.
- [ ] **6.5 Connect Claude to the `cmuir_pingcorp` org** (hand-off item 6). Only needed if you want cloud agents on the source repo. It needs an org admin to install the Claude GitHub app.

---

## 7. Cloudflare plan: owner-only questions (answers go into PR #3357)

- [ ] 1. Is the `ping-devops.com` zone on Cloudflare DNS, who administers it, and which preview hostname?
- [ ] 2. Which private names should the Tunnel or Workers VPC expose; what are the tunnel names and account?
- [ ] 3. Who re-tests auth after the edge moves (hosted-access wall, pi.flow, passkey `rp.id` on a new host, PingOne redirect URIs, xaa.dev CORS, bypass routes, e2e storageState)?
- [ ] 4. Which long-lived flows must survive (SSE runs, Code Explorer 300s, MCP host 3600s, the BFF's `ws://mcp-server` link) and for how long?
- [ ] 5. Cost ceiling, and do you have a Workers Paid account?
- [ ] 6. Is Workers VPC (beta) acceptable?
- [ ] 7. Reproduce the hosted-access wall in a Worker, keep it at an ingress, or replace it with Cloudflare Access?
- [ ] 8. Open the Cloudflare doc pages the plan marks UNVERIFIED (the sandbox could not fetch them) and confirm the numbers.
- [ ] 9. Keep or delete branch `plan/cloudflare-hybrid` and the local worktree `.worktrees/cf-plan`.

---

## 8. Privilege remote API probe

- [ ] 8.1 Decide whether to rebuild the browser HAR capture of the cookie path against `privilege.pingone.com`.
- [ ] 8.2 Raise "no headless admin API" with Ping product.
- [ ] 8.3 Post the ready Slack reply from `~/Documents/privilege-remote-api-auth.md` (decided: that file stays in `~/Documents`, not in the repo).
- [ ] 8.4 Skim `~/Documents/privilege-api-probe-2026-10-17.har` before sending it to Ping: it contains user, tenant and device ids.

---

## 9. ID-JAG housekeeping

- [x] `kid` support case sent to Ping.
- [x] Roadmap artifact updated (version 10).
- [x] Stopped the kit port-forwards.
- [ ] 9.1 Remove leftover worktrees. In the repo that owns each: `git worktree list`, then `git worktree remove <path>`. Candidates: kit `id-jag-standalone-wt-interop-panel` and `.worktrees/rt-playground`; demo `.worktrees/idjag-height` (after #3358 merges); `.worktrees/cf-plan`. `git worktree remove` deletes ignored files inside that worktree: keep secrets (like `deploy/local`) in the main kit checkout, and never use `--force` before looking at uncommitted changes.
- [ ] 9.2 When Ping answers the `kid` case, tell me; the roadmap and the kit's `docs/interop-lab.md` need an update.
- [ ] 9.3 One throwaway xaa.dev client, `byora_idjagkit_pf`, remains. xaa.dev cannot delete clients; nothing to do.
- [ ] 9.4 Open a PR from `docs/ui-consistency-review-update` if you want it: https://github.com/curtismu7/AI-DEMO2/compare/main...docs/ui-consistency-review-update

Traps: never run `configure-acme-idp.js` (it would repoint the demo's objects). Every write to `cmuir-pf.ping-devops.com` is a shared-PF write. New kit scripts must be prefixed `idJagKit`.
