# Agent Privilege: Gateway Release v1.261009

Oct 12, 2026 · @Curtis Muir

## Contents

- [Overview](#overview)
- [What shipped in v1.261009](#what-shipped-in-v1.261009)
- [How this was determined](#how-this-was-determined)
- [The imageID gotcha](#the-imageid-gotcha)
- [What did not ship on Oct 12](#what-did-not-ship-on-oct-12)
- [Demo steps](#demo-steps)

## Overview

Release inventory for the gateway image `public.ecr.aws/s7q1z8z4/privilege-aigw:v1.261009` — the newest build Ping has published as of 12 October 2026. Both of our gateways (gateway-1 in `ping-devops-curtismuir`, gateway-2 in `ping-devops-cmuir`) already run it, deployed 9 October 2026 via helm (revision 71 / revision 24).

The changes in this release are scoped to the LLM gateway (`llmgw`): the Bedrock family grows a second route, the model catalog is refreshed, and response-side policy denials become a distinct classification. Nothing changed in the MCP path, the CLI (`cyctl`), or the command-line flags of `mcpgw` itself.

## What shipped in v1.261009

Diffed against v1.261008 (built 8 October 2026) by comparing the two binaries extracted from the image layers: Go module dependencies (identical), function symbols (identical except below), CLI help text (identical), cyctl help (identical), and embedded string tables.

### 1. bedrock-mantle promoted to a full provider

`bedrock-mantle` was a validation string in v1.261008. In v1.261009 it is a routable LLM provider:

- New route: `/llm/bedrock-mantle` (sits beside `/llm/bedrock` and `/llm/bedrock-runtime/...`)
- New code path: `llmgw.isBedrockFamily` — the gateway now treats `bedrock-runtime` and `bedrock-mantle` as one family for key handling
- Migration message for keys saved with the retired provider name: `llmgw: key %s carries retired provider "bedrock"; re-save it as bedrock-runtime or bedrock-mantle`

Demo value: a second Bedrock surface — worth checking the console's provider dropdown for where it appears, and whether mantle keys take the same allowed-models/budget settings as runtime keys.

### 2. New route: `/llm/bedrock-runtime/openai/deployments/`

An OpenAI-compatible deployments route on Bedrock — the Azure OpenAI `deployments` URL shape, now also accepted on the Bedrock runtime path. Existing code that targets Azure-style `/openai/deployments/<name>/...` URLs can point at the gateway without re-encoding the request.

### 3. Model catalog refresh

New model IDs in the v9 string tables (not in v1.261008):

| Family | Added |
| --- | --- |
| Anthropic (Bedrock) | `anthropic.claude-fable-5-1`, `anthropic.claude-haiku-5-5`, `anthropic.claude-opus-4-8`, `claude-haiku-4-5-20251001-v1:0` |
| Anthropic (direct) | `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-sonnet-4.5` |
| OpenAI | `openai.gpt-5.4-2026-03-05`, `openai.gpt-5.5-2026-04-23`, `gpt-5.4`/`gpt-5.5` snapshots |
| xAI | `grok-4.20-0309-reasoning`, `grok-4.20-multi-agent-0309` |
| Amazon | `amazon.nova-premier-v1:0` |
| Moonshot | `moonshot.kimi-k2-thinking`, `moonshotai/Kimi-K3` |
| DeepSeek | `deepseek-ai/DeepSeek-V4-Pro`, `deepseek-v4-pro` |
| Google | `google.gemma-3-12b-it`, `google.gemma-3-27b-it` |
| Microsoft | Phi-3 vision / 128k variants |
| Writer | `writer.palmyra-vision-7b` |
| NVIDIA | `nvidia.nemotron-nano-3-30b` |
| Perplexity | `sonar-reasoning-pro` |

Retired (present in v1.261008, gone in v1.261009): `claude-3-opus-20240229`, `claude-3-5-haiku-20241022`, `ai21.jamba-instruct`, `amazon.titan-text-lite`, `cohere.command-r`, `cohere.command-r-plus`, `nvidia.nemotron-nano-12b`.

The model list lives in the binary, so a gateway restart picks it up — no console action needed. It governs the allowed-models dropdown and per-model pricing for budgets.

### 4. `llm_policy_response_denied`

A new classified outcome for LLM policy enforcement: a denial raised against the **response** rather than the request. Previously a response-side policy hit did not have its own record. Demo value: a policy that screens responses can now be pointed at in the logs as its own event, next to the request-side denial states.

## How this was determined

1. Tag list from `public.ecr.aws` — newest date tag is `v1.261009`; `latest` resolves to the same index digest
2. Build timestamps from each tag's config blob: v1.261007 = 7 Oct, v1.261008 = 8 Oct, v1.261009 = 9 Oct 03:19 UTC
3. Pod `imageID` compared against the tag index digest (see [the imageID gotcha](#the-imageid-gotcha))
4. Binaries extracted from the amd64 layers of v1.261008 and v1.261009 and diffed: `go version -m` dependency lists, `nm` symbol tables, CLI `-h` output, embedded string tables

Findings above are **static analysis of the binary, not live-tested behaviour**. The console may surface these features differently than the strings suggest — the demo-steps plan exists to convert each claim into a tested one.

## The imageID gotcha

A pod's `imageID` is the OCI **index** digest (the multi-arch wrapper), never a per-architecture manifest digest. It will not match any digest listed *inside* a tag's index, which makes a current pod look stale. To check whether the pod matches a tag, compare:

- the `imageID` against the tag's index **body hash** (sha256 of the exact index JSON bytes), or
- the build timestamp in the image's config blob — same build → same `created` value.

Verified 2026-10-12: pod `imageID 8b2252d5…` = body hash of the `latest`/`v1.261009` index = build 2026-10-09T03:19:09Z. Both gateways current.

## What did not ship on Oct 12

Checked 12 October 2026 and found nothing newer than v1.261009:

| Channel | Newest available |
| --- | --- |
| ECR `s7q1z8z4/privilege-aigw` | v1.261009 (9 Oct) |
| ECR `n2z2g8w6/privilege-aigw` | 8 Sep build (other team's fork) |
| Desktop app update feed (ping-crestone S3) | 2.0.52 (9 Oct) — same as installed |
| Local console API | git `ddfaec9`, built 9 Oct 03:44 — same commit as v1.261009 |

If an announcement promised a release "this morning", it had not reached the public ECR or the desktop update feed when this was checked (~12:45 UTC).

## Demo steps

Planned, not yet executed: [2026-10-12-v1.261009-demo-steps plan](../docs/superpowers/plans/2026-10-12-v1.261009-demo-steps.md) — per-feature demo steps in the live-tested style of [LLM routing & virtual keys](GATEWAY-LLM-ROUTING-AND-VIRTUAL-KEYS.md), split by what our environment can demo today (model catalog, response-denied) versus what needs an AWS Bedrock key provisioned first (bedrock-mantle, the deployments route).
