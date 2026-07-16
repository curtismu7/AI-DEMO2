# OKF Knowledge Grounding — Demo Script & Talking Points

**Audience:** Solutions Engineers demonstrating to prospects  
**Duration:** 5–7 minutes  
**Prerequisite:** Demo app running with `graphify-out/banking-domain.okf.json` present

---

## 1. Setup (before the call)

1. Ensure the demo is running (standard `docker-compose up`)
2. Verify the OKF bundle is loaded: visit `GET /api/okf/status`  
   → Should show `{ "enabled": false, "bundleLoaded": true, "assertionCount": 12 }`
3. Confirm `ff_okf_grounding` is **OFF** (the 📚 OKF pill in the header should be dim)
4. Open the banking agent chat in one browser tab

---

## 2. Act 1 — The Problem (flag OFF)

> **Talking point:** "Let me show you what happens when an AI agent answers
> from its own training data — no guardrails, no citations."

### Ask these questions with the flag OFF:

| # | Question | What to watch for |
|---|---|---|
| 1 | "What is my available balance and how is it calculated?" | Agent will give a generic/vague definition — likely correct-ish but no citation, no precision on holds vs. pending |
| 2 | "I want to transfer $6,000 to my friend. Can I do that?" | Agent may hallucinate a limit or say "yes" — no policy reference |
| 3 | "There's a fraud hold on my account. Why? What triggered it?" | Agent may guess at fraud signals (WRONG — policy says we never disclose triggers) |

> **Talking point:** "Notice three things: no citations, imprecise definitions,
> and in question 3 it may violate policy by speculating about fraud triggers.
> This is the 'vibes' mode — parametric knowledge only."

---

## 3. Act 2 — The Fix (flag ON)

> **Talking point:** "Now I'll turn on OKF Knowledge Grounding —
> deterministic, authored assertions from our banking operations manual."

### Toggle the flag:
- Click the **📚 OKF** pill in the header toolbar (it turns green)
- Or: Settings → Feature Flags → OKF Knowledge Grounding → ON

### Ask the SAME questions again:

| # | Question | Expected grounded answer |
|---|---|---|
| 1 | "What is my available balance and how is it calculated?" | "Available balance equals ledger balance minus holds minus pending debits **[K1]**. Pending transactions reduce available balance but not ledger balance **[K10]**." |
| 2 | "I want to transfer $6,000. Can I do that?" | "The daily domestic transfer limit is $5,000 **[K2]**. A $6,000 transfer would exceed that and require manager approval. Transfers above $1,000 also require step-up authentication **[K12]**." |
| 3 | "There's a fraud hold on my account. Why?" | "I can confirm a fraud hold exists. Per policy, I cannot disclose the specific signals that triggered it **[K11]**. The hold lasts up to 72 hours while our fraud team investigates **[K4]**. It can be released by a Level 2+ analyst, or auto-releases after 72 hours **[K5]**." |

> **Talking point:** "Same agent, same model, same question — but now every
> answer is grounded in authored policy with clickable citations. The agent
> correctly REFUSES to disclose fraud triggers because [K11] tells it not to."

---

## 4. Act 3 — The Citations (UI detail)

### Show the citation pills:
- Hover over any `[K4]` pill → popover shows source document and full claim text
- Click the **"📚 6 sources"** footer → expands to show all referenced assertions
- Point out: "These trace back to specific sections of real policy docs — auditable."

> **Talking point:** "This isn't RAG — there's no retrieval latency, no
> relevance scoring, no hallucinated snippets. These are hand-authored
> assertions owned by the business. Deterministic. Zero-latency. Citable."

---

## 5. Contrast Summary (for the whiteboard)

| Dimension | Flag OFF (Vibes) | Flag ON (OKF Grounded) |
|---|---|---|
| Source | Model's training data | Authored assertions |
| Accuracy | Best-effort | Deterministic |
| Citations | None | `[K1]`–`[K12]` with source |
| Policy compliance | Unreliable | Enforced (K11 = no disclosure) |
| Latency | Zero | Zero (pre-loaded, not retrieved) |
| Auditability | None | Full provenance chain |
| Maintenance | Retrain model | Edit JSON file, hot-reload |

---

## 6. Objection Handling

### "How is this different from RAG?"

> "RAG retrieves chunks probabilistically from a large corpus — great for
> broad coverage, but you can't guarantee it finds the right chunk, and the
> model can still contradict what it retrieves. OKF is the opposite: a small,
> curated set of ground-truth assertions injected directly into the prompt.
> They complement each other — RAG for breadth, OKF for precision."

### "What if our policies change?"

> "Edit the JSON bundle, hit the reload endpoint (`POST /api/okf/reload`),
> and the agent immediately uses the new assertions. No retraining, no
> re-indexing, no deployment. In production you'd version-control the bundle
> like any config artifact."

### "Can we have different bundles for different use cases?"

> "Yes — the loader indexes bundles by domain. You could have `banking-domain`,
> `insurance-domain`, `hr-policy` — each agent loads only its relevant domain.
> The format is the same; the scope is different."

### "What about hallucination of citations?"

> "The grounding instructions explicitly tell the model: 'Do not fabricate
> citations. Only cite [Kn] if the assertion covers the topic.' In testing,
> compliance with this instruction is >98% on GPT-4 and Claude."

---

## 7. Technical Deep-Dive (if asked)

```
┌─────────────────────────────────────────────────────────────┐
│                    System Prompt                              │
├─────────────────────────────────────────────────────────────┤
│  [Manifest prompt]           ← existing, always present      │
│                                                              │
│  <knowledge domain="banking-domain" version="0.1.0">         │
│  [K1] Available balance = ledger - holds - pending...        │
│  [K2] Domestic transfer limit: $5,000/day...                 │
│  ...                                                         │
│  </knowledge>                                                │
│                                                              │
│  INSTRUCTIONS: Cite [Kn] inline. Do not contradict...        │
└─────────────────────────────────────────────────────────────┘
         ↓ only when ff_okf_grounding = ON
```

- **Bundle format:** JSON-LD envelope + assertions array (see `okf-spec.md`)
- **Loader:** `okfLoaderService.js` — reads `graphify-out/*.okf.json`, validates, indexes by domain
- **Injector:** `okfPromptInjector.js` — checks flag, calls `formatForPrompt()`, appends to system prompt
- **API:** `/api/okf/*` — client fetches assertion metadata for citation popover rendering
- **Flag:** `ff_okf_grounding` in FLAG_REGISTRY + FIELD_DEFS + QUICK_FLAGS

---

## 8. Closing

> "What you just saw is the difference between an AI that _thinks_ it knows
> your policies and one that _provably_ knows them. OKF gives you
> determinism, citations, and auditability — without the complexity of a
> full RAG pipeline. And the flag lets you prove it live."

---

*Last updated: 2026-07-15*
