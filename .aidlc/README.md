# AI-DLC sidecar (opt-in)

This directory holds the AWS AI-DLC core workflow **without** replacing
`CLAUDE.md`.

| Path | Role |
|------|------|
| `.aidlc/CORE-WORKFLOW.md` | Phase-gated process (from awslabs/aidlc-workflows) |
| `.aidlc/VERSION` | Upstream rules package version |
| `.aidlc-rule-details/` | Stage detail rules (common, inception, construction, extensions) |
| `aidlc-docs/` | Generated artifacts + audit trail (commit with features) |

## Activation

Prefix the request with `Using AI-DLC,`. Without that phrase, agents follow
`CLAUDE.md` / `REGRESSION_PLAN.md` only and must not run the AI-DLC ceremony.

## Priority (this repo)

1. `REGRESSION_PLAN.md` §0–§1, worktrees, emoji allowlist
2. `CLAUDE.md` standing instructions
3. `.aidlc/CORE-WORKFLOW.md` when AI-DLC is activated

The upstream header that says the workflow "OVERRIDES all other built-in
workflows" does **not** override this repo's do-not-break contract.

## Upgrade

```bash
git clone --depth 1 https://github.com/awslabs/aidlc-workflows.git /tmp/aidlc-workflows
cp /tmp/aidlc-workflows/aidlc-rules/aws-aidlc-rules/core-workflow.md .aidlc/CORE-WORKFLOW.md
cp /tmp/aidlc-workflows/aidlc-rules/VERSION .aidlc/VERSION
rsync -a --delete /tmp/aidlc-workflows/aidlc-rules/aws-aidlc-rule-details/ .aidlc-rule-details/
```

Review the diff before committing; re-check the CLAUDE.md AI-DLC pointer still
matches.
