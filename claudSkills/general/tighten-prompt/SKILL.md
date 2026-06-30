---
name: tighten-prompt
description: >-
  Rewrite a prompt to cut wasted words so it's cheaper (fewer tokens) and
  clearer, without changing what it asks for. Use this skill whenever the user
  wants to shorten, tighten, compress, trim, clean up, or "de-fluff" a prompt;
  reduce a prompt's token/word count or cost; remove filler, hedging, or
  rambling from an instruction; or asks "make this prompt cheaper / tighter /
  more concise / less wordy". Also use it when the user pastes a long, verbose
  prompt and wants a leaner version, or asks you to optimize a system prompt /
  agent instruction for length. Triggers on: tighten prompt, shorten prompt,
  compress prompt, trim the fluff, make this prompt cheaper, reduce tokens,
  cut wordiness, concise rewrite of an instruction.
---

# Tighten Prompt

## Goal

Cut the words that don't change what the model does, and keep every word that
does. The output should cost fewer tokens **and** read more clearly than the
input — those go together more often than people expect, because the same filler
that wastes tokens also buries the actual instruction.

The bar is **meaning-preserving**: someone acting on the tightened prompt should
do exactly what the original asked, no more guessing and no lost requirement.
Brevity that introduces ambiguity is a failure, not a win. When trimming a word
would make the ask even slightly less clear, keep it.

## What to cut

These almost never carry instruction and are safe to remove:

- **Politeness padding & throat-clearing** — "please", "thanks so much", "I was
  wondering if you could", "if it's not too much trouble", "I'd like you to",
  "can you go ahead and".
- **Hedging & filler** — "maybe", "sort of", "kind of", "I think", "just",
  "really", "very", "basically", "actually", "in order to" → "to".
- **Redundant restatement** — the same requirement said twice in different words;
  keep the clearest single phrasing.
- **Meta-commentary about the prompt** — "as I mentioned above", "to be clear",
  "the goal of this prompt is", "what I'm trying to say is".
- **Wind-up narration** that adds no constraint — backstory that doesn't change
  the output, "I've been thinking about this for a while and...".
- **Wordy connectors & nominalizations** — "due to the fact that" → "because",
  "make a decision" → "decide", "is able to" → "can".

## What to preserve (load-bearing — never drop)

If removing it would change, narrow, or make ambiguous what gets produced, it
stays. When unsure whether a phrase is load-bearing, **keep it** — a dropped
constraint costs far more than a few saved tokens.

- Concrete requirements, constraints, and acceptance criteria.
- File paths, function/variable names, URLs, IDs, and any literal identifier.
- Code, commands, and quoted strings — reproduce verbatim, never paraphrase.
- Examples the model is meant to follow or match.
- Numbers, units, limits, dates, versions, thresholds.
- **Negations and exceptions** — "don't", "never", "except", "only if",
  "unless". These are easy to drop and disastrous to lose.
- Output/format specs — "return JSON", "one sentence", "no preamble", schema.
- Role or context that changes behavior ("you are a security reviewer").
- Domain terms of art — don't "simplify" a precise word into a vague one.
- **Explicit "use X, not Y" contrasts.** When the input says to use one thing
  *because another is wrong/deprecated/a common mistake* ("use the status field,
  not the deprecated isActive boolean"), keep both sides. Naming only the right
  option looks sufficient but discards the warning that stops the reader reaching
  for the wrong one — the contrast is the load-bearing part, not redundancy.

## Method

1. Read for **intent**: what must the output be, and what constrains it? Mark the
   load-bearing parts in your head.
2. Drop everything that isn't load-bearing.
3. Tighten what remains: active voice, strong verbs, lists for parallel items.
4. **Re-read the tightened version against the original** and confirm every
   requirement, constraint, negation, and format spec survived. If anything is
   now ambiguous, restore words until it isn't.

Match the input's register: a casual prompt can stay casual, a formal
system-prompt stays formal. You're trimming, not rewriting voice. Keep clarifying
structure (bullets, numbered steps) when it aids the reader — a clear three-line
list beats one dense run-on, even if the run-on is a few tokens shorter.

## Output format

Return the tightened prompt in a fenced code block so it's easy to copy, then a
single stat line. Add nothing else unless the user asked for an explanation.

```
<tightened prompt>
```
_Trimmed ~62% — 140 → 53 words._

If the user asks what changed, add a short bullet list of the categories you cut
(filler, restated requirement, etc.) — but don't volunteer it by default; the
whole point is a lean result, not more text to read.

## Examples

**Example 1**
Input: "Hey, I was hoping you could maybe help me out with something. I have a
CSV file and I'd really like it if you could go ahead and write a Python script
that reads it in and, basically, calculates the average of the values in the
column called 'price'. Thanks so much!"
Output:
```
Write a Python script that reads a CSV and prints the average of the 'price' column.
```
_Trimmed ~80% — 52 → 14 words._

**Example 2 (preserve the load-bearing details)**
Input: "Please review this pull request really carefully. I want you to look for
bugs, and also — this is important — do NOT comment on code style or formatting,
just correctness and security. Return your findings as a numbered list."
Output:
```
Review this PR for correctness and security bugs only — do not comment on style or formatting. Return findings as a numbered list.
```
_Trimmed ~40% — 45 → 23 words._ (Kept the negation, the scope limit, and the format spec — those are the whole point.)

## Anti-patterns

- Dropping a "don't" / "only" / "except" because it looked like filler — these
  invert the meaning and must survive.
- Compressing into a telegraphic fragment that's shorter but ambiguous. Cheaper
  is worthless if the model now does the wrong thing.
- Paraphrasing quoted text, code, or examples instead of reproducing them.
- Replacing a precise domain term with a shorter vague one.
- Adding your own commentary, preamble, or "here's your tightened prompt:" — just
  give the result and the stat line.
