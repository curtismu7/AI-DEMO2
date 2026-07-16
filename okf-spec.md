# Open Knowledge Format (OKF) — Bundle Specification

**Version:** 0.1.0  
**Status:** Draft  
**Last Updated:** 2026-07-15

---

## 1. Overview

An OKF bundle is a self-contained, machine-readable collection of **assertions** — deterministic knowledge claims with provenance — designed to be injected into LLM system prompts for grounded, citable reasoning.

Bundles are JSON files (`.okf.json`) conforming to a JSON-LD-compatible envelope.

---

## 2. Design Principles

| Principle | Rationale |
|---|---|
| Deterministic over probabilistic | Assertions are authored truths, not retrieved guesses |
| Citable | Every assertion traces to a source |
| Domain-scoped | One bundle = one domain; loader indexes by domain |
| Token-efficient | Flat structure; no deep nesting; designed for prompt injection |
| Versionable | Bundles carry semver; consumers can pin |

---

## 3. Envelope Structure

```jsonc
{
  "@context": "https://okf.ping.dev/v0.1",
  "id": "urn:okf:<org>:<domain>:<uuid>",
  "version": "0.1.0",
  "domain": "<domain-slug>",
  "title": "<Human-readable bundle title>",
  "description": "<What this bundle covers>",
  "created": "<ISO 8601 timestamp>",
  "updated": "<ISO 8601 timestamp>",
  "authors": ["<author-id or name>"],
  "assertions": [ /* ... */ ]
}
```

### Required Fields

| Field | Type | Description |
|---|---|---|
| `@context` | `string` | JSON-LD context URI. Must be `https://okf.ping.dev/v0.1` for this version |
| `id` | `string` | URN-style unique identifier: `urn:okf:<org>:<domain>:<uuid>` |
| `version` | `string` | Semver version of the bundle content |
| `domain` | `string` | Kebab-case domain slug (e.g., `banking-ops`, `repo-topology`) |
| `title` | `string` | Human-readable title |
| `assertions` | `array` | Array of Assertion objects (see §4) |

### Optional Fields

| Field | Type | Description |
|---|---|---|
| `description` | `string` | Longer description of bundle scope |
| `created` | `string` | ISO 8601 creation timestamp |
| `updated` | `string` | ISO 8601 last-modified timestamp |
| `authors` | `string[]` | List of author identifiers |

---

## 4. Assertion Structure

Each assertion is a single, atomic knowledge claim.

```jsonc
{
  "id": "K1",
  "claim": "<The deterministic statement>",
  "source": "<Human-readable provenance>",
  "confidence": 1.0,
  "citations": [
    {
      "ref": "<document or section identifier>",
      "uri": "<optional URI to source material>"
    }
  ],
  "tags": ["<optional>", "<categorization>"]
}
```

### Required Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Short identifier, used as citation anchor in prompts (e.g., `K1`, `K2`) |
| `claim` | `string` | The knowledge statement. Must be self-contained and unambiguous |
| `source` | `string` | Human-readable provenance string |
| `confidence` | `number` | `0.0` – `1.0`. For authored facts, typically `1.0` |

### Optional Fields

| Field | Type | Description |
|---|---|---|
| `citations` | `array` | Array of Citation objects linking to source material |
| `tags` | `string[]` | Free-form tags for filtering/grouping |

### Citation Object

| Field | Type | Description |
|---|---|---|
| `ref` | `string` | Document/section reference (e.g., `compliance-policy §4.1`) |
| `uri` | `string` | Optional URI to the source |

---

## 5. Prompt Injection Format

When injected into an LLM system prompt, a bundle is rendered as:

```
<knowledge domain="banking-ops" version="0.1.0">
[K1] "Available balance" equals ledger balance minus holds minus pending debits. Source: banking-ops-manual §3.2
[K2] Domestic transfer limit: $5,000/day per account. Source: compliance-policy v2.4 §4.1
...
</knowledge>
```

**Rules for the LLM:**
- When answering questions covered by a `[Kn]` assertion, cite it inline: `[K1]`
- Do not contradict assertions — they are ground truth
- If a question falls outside the knowledge block, answer normally but do NOT fabricate a citation

---

## 6. File Conventions

| Convention | Value |
|---|---|
| Extension | `.okf.json` |
| Location | `graphify-out/` directory at repo root |
| Naming | `<domain-slug>.okf.json` (matches the `domain` field) |
| Encoding | UTF-8, no BOM |
| Max assertions per bundle | 50 (soft limit for token budget) |

---

## 7. Validation

Bundles MUST validate against `schemas/okf-bundle.schema.json`. The loader rejects invalid bundles at startup with a descriptive error.

---

## 8. Versioning & Evolution

- Bundle `version` follows semver.
- The `@context` URI is versioned (`/v0.1`). Breaking changes to the envelope or assertion schema require a new context version.
- Consumers declare which context versions they support.

---

## 9. Relationship to RAG

OKF and RAG are complementary, not competing:

| Dimension | OKF | RAG |
|---|---|---|
| Source of truth | Authored, deterministic | Retrieved, probabilistic |
| Latency | Zero (pre-loaded) | Query-time retrieval |
| Coverage | Narrow, curated | Broad, indexed |
| Citability | Guaranteed | Best-effort |
| Use case | Policy, definitions, rules | Code search, large corpus |

When both are active, OKF assertions take precedence for covered topics.
