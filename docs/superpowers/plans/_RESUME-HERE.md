# RESUME HERE — first-class verticals (context ran out 2026-05-31)

The previous session hit "prompt too long" (context full). Everything is committed;
nothing is lost. Start a fresh session and continue from this pointer.

## Done (committed on branch `fix/heuristics-vertical-aware`)
- **Plan 1+2:** plugin foundation + healthcare reference vertical (agent path first-class).
- **Plan 3:** retail, sporting-goods, workforce as plugins + curated 10-chip model
  (chips10 in all 5 manifests: 7 heuristic + 3 LLM-only; BankingChips renders + gates LLM-only).
  → **4 of 5 verticals are first-class plugins.** Banking is the only `legacy` one.
- **Agent-runtime parity:** all 4 runtimes (langchain/openai/mastra/pydantic) vertical-aware;
  fixed the `callMcpTool`→`mcpCallTool` crash + agentRun schema gap + agentTool dispatch gap.
- **Consolidation:** regression-clean (fewer failures than baseline, ZERO verticals-related).

## NEXT: execute Plan 4 (banking plugin + generic admin overlay + delete translation)
**Plan file:** `docs/superpowers/plans/2026-05-31-first-class-verticals-plan-4-banking-admin-delete-translation.md`
- Phase A: banking → hybrid plugin (executeTool delegates to MCP via extracted `dispatchBankingAction`).
  **Top risk:** banking chips/agent are live + UI-coupled; SPIKE the kind:'vertical' routing before committing A2.
- Phase B: admin = generic cross-vertical role OVERLAY (not a vertical), 10 curated chips. See [[project_admin_overlay]].
- Phase C: delete THEME_VOCAB/parseTheme/THEME_OVERRIDES/_buildVerticalToolDescription/buildToolSchemasForAgentForVertical.
- KEEP: reseed/relabel infra + router.ts maps + admin MCP tools.

## BLOCKED (do NOT start — waits on the new UI)
- **Dashboard-native data plan:** dashboards for healthcare/workforce/sporting still render
  relabeled banking-store accounts via /api/accounts/my + reseed. Make dashboards render each
  vertical's OWN plugin data AFTER the UI redesign lands (same UserDashboard.js surface). See
  [[project_ui_verticals_parallel]]. The reseed machinery must stay until then.

## Deferred follow-ups (UI-independent, optional)
- E4: setup-page user chips (list existing label→message + add form, auto-wired LLM-only).
- Robustness hardening: VerticalResult $NaN guard, multi-array table arrayKey, action-name mis-route guard.
- Agent live e2e per runtime (blocked on a logged-in session).

## Standing rules (in memory, but repeating the critical one)
- **Model tiering on EVERY agent:** haiku=easy, sonnet=medium, opus=hard. Never omit `model`. ([[feedback_cheap_model_easy_tasks]])
- Use mgrep for searches. Verify `git branch --show-current` before each commit.
