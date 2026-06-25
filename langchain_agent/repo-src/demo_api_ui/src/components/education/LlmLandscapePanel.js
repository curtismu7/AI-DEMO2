import React from "react";
import EducationDrawer from "../shared/EducationDrawer";

// ── Helpers ────────────────────────────────────────────────────────────────

const Code = ({ children }) => (
  <code
    style={{
      display: "block",
      background: "var(--code-bg, #f1f5f9)",
      borderRadius: 6,
      padding: "0.75rem 1rem",
      fontFamily: "inherit",
      fontSize: "0.78rem",
      whiteSpace: "pre",
      overflowX: "auto",
      margin: "0.5rem 0",
    }}
  >
    {children}
  </code>
);

function ModelCard({
  name,
  maker,
  context,
  params,
  color,
  strengths,
  note,
  children,
}) {
  return (
    <div
      style={{
        borderLeft: `4px solid ${color}`,
        background: "var(--edu-card-bg, #f8fafc)",
        borderRadius: "0 8px 8px 0",
        padding: "0.85rem 1rem",
        marginBottom: "0.85rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
          marginBottom: "0.3rem",
        }}
      >
        <strong style={{ fontSize: "0.92rem" }}>{name}</strong>
        {maker && (
          <span
            style={{
              fontSize: "0.73rem",
              background: color,
              color: "#fff",
              borderRadius: 4,
              padding: "1px 6px",
            }}
          >
            {maker}
          </span>
        )}
        {params && (
          <span
            style={{
              fontSize: "0.73rem",
              background: "#e2e8f0",
              color: "#475569",
              borderRadius: 4,
              padding: "1px 6px",
            }}
          >
            {params}
          </span>
        )}
        {context && (
          <span
            style={{
              fontSize: "0.73rem",
              background: "#dbeafe",
              color: "var(--brand-navy)",
              borderRadius: 4,
              padding: "1px 6px",
            }}
          >
            {context}
          </span>
        )}
      </div>
      {strengths && (
        <p
          style={{
            margin: "0.2rem 0 0.1rem",
            fontSize: "0.83rem",
            color: "#334155",
          }}
        >
          {strengths}
        </p>
      )}
      {note && (
        <p
          style={{
            margin: "0.2rem 0 0",
            fontSize: "0.78rem",
            color: "#64748b",
            fontStyle: "italic",
          }}
        >
          {note}
        </p>
      )}
      {children}
    </div>
  );
}

// ── Tab content components ─────────────────────────────────────────────────

function CommercialContent() {
  return (
    <div>
      <p style={{ color: "#475569", marginBottom: "1rem", fontSize: "0.9rem" }}>
        Commercial LLMs are closed-source models provided as a paid API. You
        don't see the weights — you call an endpoint and pay per token. They
        tend to lead on benchmark performance and safety investment, but require
        trusting the vendor with your data.
      </p>

      <ModelCard
        name="GPT-4o / GPT-4o mini"
        maker="OpenAI"
        context="128K tokens"
        color="#059669"
        strengths="Multimodal (text, image, audio natively), fast, strong coding, function calling, best Assistants API integration."
        note="GPT-4o mini: 2-3× cheaper with ~80% of quality — ideal for high-volume pipelines. Available via OpenAI API, Azure OpenAI Service, GitHub Models."
      />

      <ModelCard
        name="o1 / o3 / o4-mini"
        maker="OpenAI"
        context="128K–200K"
        color="#059669"
        strengths='Extended chain-of-thought reasoning ("thinking" models) — excel at math, science, coding, multi-step logic. o4-mini is the cost-efficient reasoning option.'
        note="Higher latency (thinking tokens) — match the model to the task. Best for complex analysis, agentic planning, multi-step reasoning."
      />

      <ModelCard
        name="Claude 4 — Opus 4.7 / Sonnet 4.6 / Haiku 4.5"
        maker="Anthropic"
        context="200K tokens"
        color="#7c3aed"
        strengths="Claude 4 family (2025): Opus 4.7 is Anthropic's most capable model; Sonnet 4.6 is the best price/performance sweet-spot; Haiku 4.5 is fastest/cheapest for high-volume tasks. All support extended thinking mode."
        note="Exceptional instruction-following, 200K context, Constitutional AI safety, strong agentic tool use. Available via Anthropic API, AWS Bedrock, Google Vertex AI."
      />

      <ModelCard
        name="Gemini 2.5 Pro / 2.0 Flash"
        maker="Google DeepMind"
        context="1M+ tokens"
        color="var(--brand-navy)"
        strengths="Gemini 2.5 Pro: state-of-the-art reasoning, coding, and math (2025 benchmarks); extended thinking mode. 2.0 Flash: fastest Gemini, best for high-volume multimodal pipelines."
        note="Native multimodal (text/image/audio/video), Google Search grounding, industry-leading 1M+ context. Available via Google AI Studio, Vertex AI, Gemini API."
      />

      <ModelCard
        name="Phi-4"
        maker="Microsoft"
        params="14B params"
        context="16K tokens"
        color="#0ea5e9"
        strengths="Exceptional reasoning and coding relative to model size. Runs on-device or edge hardware. Open-weight (MIT license)."
        note="Best for cost-sensitive deployments, edge inference, or strong coding without GPT-4o costs."
      />

      <ModelCard
        name="Mistral Large 2 / Small 3"
        maker="Mistral AI"
        context="128K tokens"
        color="#dc2626"
        strengths="Competitive with GPT-4o on coding benchmarks. Strong multilingual (French HQ). European data residency option."
        note="Mistral Small 3 (24B): fastest Mistral model. Available via Mistral API, Azure AI Foundry, AWS Bedrock, Google Vertex AI."
      />

      <ModelCard
        name="Command A / Command R+"
        maker="Cohere"
        context="256K tokens"
        color="#0a7ea4"
        strengths="Enterprise-focused. Command A (2025): frontier performance at 1/4 the cost of comparable models, 256K context. Command R+: best-in-class RAG with grounded generation and citation support."
        note="Connectors for Google Drive, SharePoint, web search. Available via Cohere API, Azure AI Foundry, AWS Bedrock."
      />
    </div>
  );
}

function OpenSourceContent() {
  return (
    <div>
      <p style={{ color: "#475569", marginBottom: "1rem", fontSize: "0.9rem" }}>
        Open-source (or "open-weight") LLMs publish their model weights — you
        can download, fine-tune, and run them on your own hardware. Licenses
        vary: some are fully permissive (Apache 2.0), others have commercial
        restrictions (Llama 3 Community License). "Open-weight" ≠ "open training
        data."
      </p>

      <ModelCard
        name="Meta Llama 4 — Scout / Maverick / 3.3 70B"
        maker="Meta"
        params="Scout: 17B MoE / Maverick: 400B MoE"
        context="10M tokens (Scout)"
        color="#f97316"
        strengths="Llama 4 (2025): Scout is a natively multimodal MoE model with a 10M token context window. Maverick rivals GPT-4o and Claude Sonnet at frontier quality. Llama 3.3 70B remains the best dense open-weight option."
        note="License: Llama 4 Community (commercial use permitted). Available via HuggingFace, Meta AI, AWS Bedrock, Azure AI Foundry, Ollama."
      />

      <ModelCard
        name="Mistral 7B / Mixtral 8×7B / 8×22B"
        maker="Mistral AI"
        context="32K–64K tokens"
        color="#dc2626"
        strengths="Sparse Mixture-of-Experts — GPT-3.5 quality at lower inference cost. Strong multilingual. Fast inference relative to quality."
        note="Apache 2.0 for base models. Mixtral 8×22B: 141B total / 39B active, GPT-4 class quality."
      />

      <ModelCard
        name="Alibaba Qwen 3"
        maker="Alibaba Cloud"
        params="0.6B – 235B MoE"
        context="128K tokens"
        color="#d97706"
        strengths="Qwen 3 (2025): hybrid thinking model — toggle between extended reasoning and fast response modes. 235B MoE flagship rivals frontier commercial models. Extremely strong multilingual (Chinese + English) and coding."
        note="Apache 2.0. Available via HuggingFace, Ollama, Alibaba Cloud. Qwen3-Coder is state-of-the-art open-source code model."
      />

      <ModelCard
        name="DeepSeek V3 / R1"
        maker="DeepSeek"
        params="671B MoE / 37B active"
        context="128K tokens"
        color="#4f46e5"
        strengths="Frontier-class quality at open-source pricing. DeepSeek R1 matches OpenAI o1 on math/coding benchmarks. MIT license enables distillation into smaller models."
        note="Data residency note: DeepSeek is a Chinese company — evaluate per your enterprise policy. R1 distillations (1.5B–70B) bring reasoning to consumer hardware."
      />

      <ModelCard
        name="Google Gemma 3"
        maker="Google DeepMind"
        params="1B / 4B / 12B / 27B"
        context="128K tokens"
        color="#0d9488"
        strengths="Gemma 3 (2025): natively multimodal across all sizes, 128K context window (up from 8K in Gemma 2). 27B achieves near-GPT-4o quality on key benchmarks. Lightweight 1B/4B for on-device inference."
        note="Gemma Terms of Use (permissive commercial). Available via HuggingFace, Google AI Studio, Vertex AI, Ollama."
      />

      <div
        style={{
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          borderRadius: 8,
          padding: "0.85rem 1rem",
          marginTop: "1rem",
          fontSize: "0.84rem",
          color: "#166534",
        }}
      >
        <strong>Local inference:</strong>{" "}
        <a
          href="https://ollama.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#166534" }}
        >
          Ollama
        </a>{" "}
        lets you run Llama, Mistral, Qwen, Gemma, and DeepSeek locally with one
        command (<code>ollama run llama3</code>). <strong>LM Studio</strong>{" "}
        provides a desktop GUI. Quantised models (GGUF via llama.cpp) reduce
        memory significantly — a 7B Q4 model runs on 8 GB RAM.
      </div>
    </div>
  );
}

function HowLlmsWorkContent() {
  return (
    <div>
      <p style={{ color: "#475569", marginBottom: "1rem", fontSize: "0.9rem" }}>
        LLMs are neural networks trained to predict the next token in a
        sequence. Understanding how they work helps you use them better — and
        explain them to colleagues, customers, and auditors.
      </p>

      <h4 style={{ margin: "1.2rem 0 0.4rem", color: "#1e293b" }}>
        Transformers — the architecture
      </h4>
      <p
        style={{ fontSize: "0.85rem", color: "#334155", margin: "0 0 0.5rem" }}
      >
        All modern LLMs are based on the{" "}
        <strong>Transformer architecture</strong> (Vaswani et al., 2017 —
        "Attention Is All You Need"). The key innovation is{" "}
        <strong>self-attention</strong>: each token can attend to every other
        token in the context window, capturing long-range dependencies that RNNs
        couldn't. Decoder-only transformers (GPT architecture) generate text
        autoregressively — each new token is predicted from all previous tokens.
      </p>
      <p
        style={{
          fontSize: "0.83rem",
          color: "#64748b",
          fontStyle: "italic",
          margin: "0 0 0.75rem",
        }}
      >
        Simple analogy: think of self-attention as "every word in the sentence
        votes on how much it should influence every other word's meaning."
      </p>

      <h4 style={{ margin: "1.2rem 0 0.4rem", color: "#1e293b" }}>
        Training pipeline
      </h4>
      <Code>{`1. Pre-training           2. Supervised Fine-tuning   3. RLHF / RLAIF
──────────────            ─────────────────────────   ────────────────
Raw web text              Curated Q&A pairs            Human raters score
(trillions of tokens)     Instruction following        model outputs
      │                         │                             │
Predict next token         Learn to follow prompts     Train reward model
Cross-entropy loss         (SFT on demonstrations)     PPO / DPO to score
      │                         │                             │
General knowledge          More helpful                Less harmful,
learned from data          responses                   more aligned`}</Code>
      <ul
        style={{
          fontSize: "0.84rem",
          color: "#334155",
          paddingLeft: "1.2rem",
          marginTop: "0.5rem",
        }}
      >
        <li>
          <strong>Pre-training:</strong> The model sees enormous amounts of text
          and learns to predict the next word — this is where factual knowledge
          and language patterns are absorbed (weeks/months, millions of $
          compute).
        </li>
        <li>
          <strong>SFT (Supervised Fine-Tuning):</strong> The pre-trained model
          is fine-tuned on curated prompt/response pairs to follow instructions.
        </li>
        <li>
          <strong>RLHF:</strong> Human raters compare pairs of responses. A
          reward model is trained on their preferences; the LLM is then updated
          via PPO or DPO to maximise the reward signal.
        </li>
        <li>
          <strong>Constitutional AI (Anthropic):</strong> A set of principles
          ("the constitution") guides AI-generated feedback — more scalable than
          human rating for every preference.
        </li>
      </ul>

      <h4 style={{ margin: "1.2rem 0 0.4rem", color: "#1e293b" }}>
        Key concepts
      </h4>
      <ul
        style={{ fontSize: "0.84rem", color: "#334155", paddingLeft: "1.2rem" }}
      >
        <li>
          <strong>Context window:</strong> The maximum tokens the model can
          "see" at once. GPT-4o: 128K. Gemini 1.5 Pro: 1M. Everything outside
          the window is forgotten.
        </li>
        <li>
          <strong>Temperature:</strong> Controls randomness. 0 = deterministic.
          1 = more creative. Above 1 = often incoherent.
        </li>
        <li>
          <strong>Top-p (nucleus sampling):</strong> Picks from the smallest set
          of tokens whose cumulative probability ≥ p. top_p=0.9 means "pick from
          the 90% probability mass."
        </li>
        <li>
          <strong>Tokens vs words:</strong> ~1 token ≈ ¾ of a word in English.
          "ChatGPT is great!" ≈ 6 tokens. Pricing is per input + output token.
        </li>
        <li>
          <strong>Hallucination:</strong> The model generates confident-sounding
          text that is factually wrong. Root cause: predicting plausible
          sequences, not retrieving ground truth. Mitigations: RAG, temperature
          0, instruction to say "I don't know."
        </li>
        <li>
          <strong>System prompt:</strong> The instruction defining the model's
          persona, constraints, and context — processed before the user's
          message.
        </li>
      </ul>

      <h4 style={{ margin: "1.2rem 0 0.4rem", color: "#1e293b" }}>
        Inference concepts
      </h4>
      <ul
        style={{ fontSize: "0.84rem", color: "#334155", paddingLeft: "1.2rem" }}
      >
        <li>
          <strong>KV cache:</strong> Cached key-value attention pairs avoid
          recomputing attention for already-processed tokens — critical for fast
          generation.
        </li>
        <li>
          <strong>Quantisation:</strong> Reducing weights from 32-bit to 8-bit
          or 4-bit floats. Cuts memory 4-8×; small quality loss. GGUF
          (llama.cpp) is the dominant format for quantised local inference.
        </li>
        <li>
          <strong>Speculative decoding:</strong> A small "draft" model generates
          candidate tokens; the large model verifies them in parallel — 2-3×
          throughput gain.
        </li>
        <li>
          <strong>Batch size:</strong> Process multiple requests simultaneously
          on the same GPU. High batch size = better hardware utilisation, larger
          latency per individual request.
        </li>
      </ul>

      <h4 style={{ margin: "1.2rem 0 0.4rem", color: "#1e293b" }}>
        Mixture of Experts (MoE)
      </h4>
      <p
        style={{ fontSize: "0.85rem", color: "#334155", margin: "0 0 0.5rem" }}
      >
        MoE is an architecture where the model contains many "expert"
        sub-networks but only activates a small fraction per token. A{" "}
        <strong>router</strong> selects 2–8 experts for each token, so a
        671B-parameter model like DeepSeek V3 only uses ~37B active parameters
        per forward pass — achieving frontier quality at a fraction of the
        compute cost.
      </p>
      <ul
        style={{
          fontSize: "0.84rem",
          color: "#334155",
          paddingLeft: "1.2rem",
          marginTop: "0.5rem",
        }}
      >
        <li>
          <strong>Examples:</strong> DeepSeek V3/R1 (671B total / 37B active),
          Qwen 3 235B MoE, Llama 4 Scout and Maverick, Mixtral 8×7B.
        </li>
        <li>
          <strong>Trade-off:</strong> Lower inference cost but higher memory
          footprint (all weights must be loaded; only a subset computed).
        </li>
        <li>
          <strong>Why it matters:</strong> MoE enables frontier-class quality at
          open-source cost — DeepSeek V3 matches GPT-4o on many benchmarks at
          ~10× lower API price.
        </li>
      </ul>

      <h4 style={{ margin: "1.2rem 0 0.4rem", color: "#1e293b" }}>
        Extended Thinking / Reasoning Models
      </h4>
      <p
        style={{ fontSize: "0.85rem", color: "#334155", margin: "0 0 0.5rem" }}
      >
        "Reasoning models" generate an internal chain-of-thought before
        producing their final answer. The thinking tokens are consumed by the
        model but may or may not be shown to the user depending on the API.
      </p>
      <ul
        style={{
          fontSize: "0.84rem",
          color: "#334155",
          paddingLeft: "1.2rem",
          marginTop: "0.5rem",
        }}
      >
        <li>
          <strong>Examples:</strong> OpenAI o3/o4-mini, Claude Sonnet 4.6
          (thinking mode), Gemini 2.5 Pro, Qwen 3 (hybrid think/fast), DeepSeek
          R1.
        </li>
        <li>
          <strong>When to use:</strong> Complex multi-step math, scientific
          reasoning, code debugging, planning — tasks where showing your work
          matters.
        </li>
        <li>
          <strong>Trade-off:</strong> Higher latency and cost (thinking tokens
          count against context and billing); not worth it for simple Q&A or
          classification.
        </li>
        <li>
          <strong>Budget tokens:</strong> Many APIs expose a{" "}
          <code>thinking_budget</code> or <code>max_reasoning_tokens</code>{" "}
          parameter to cap thinking cost.
        </li>
      </ul>
    </div>
  );
}

function ComparisonContent() {
  const thStyle = {
    padding: "0.5rem 0.65rem",
    background: "#1e293b",
    color: "#f1f5f9",
    fontSize: "0.78rem",
    textAlign: "left",
    whiteSpace: "nowrap",
  };
  const tdStyle = {
    padding: "0.45rem 0.65rem",
    fontSize: "0.78rem",
    color: "#334155",
    borderBottom: "1px solid #e2e8f0",
    verticalAlign: "top",
  };
  const trAlt = { background: "#f8fafc" };

  return (
    <div>
      <h4 style={{ margin: "0 0 0.6rem", color: "#1e293b" }}>
        Commercial Models
      </h4>
      <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
        <table
          className="edu-table"
          style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}
        >
          <thead>
            <tr>
              {[
                "Model",
                "Maker",
                "Context",
                "Multimodal",
                "Best at",
                "Access",
              ].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              [
                "GPT-4o / 4o mini",
                "OpenAI",
                "128K",
                "Text/Image/Audio",
                "General purpose, function calling",
                "API, Azure",
              ],
              [
                "o3 / o4-mini",
                "OpenAI",
                "128K–200K",
                "Text/Image",
                "Reasoning, math, coding",
                "API, Azure",
              ],
              [
                "Claude Opus 4.7",
                "Anthropic",
                "200K",
                "Text/Image",
                "Most capable, extended thinking",
                "API, Bedrock, Vertex",
              ],
              [
                "Claude Sonnet 4.6",
                "Anthropic",
                "200K",
                "Text/Image",
                "Best price/perf, agentic tool use",
                "API, Bedrock, Vertex",
              ],
              [
                "Claude Haiku 4.5",
                "Anthropic",
                "200K",
                "Text/Image",
                "Fast, cheap, classification/RAG",
                "API, Bedrock, Vertex",
              ],
              [
                "Gemini 2.5 Pro",
                "Google",
                "1M+",
                "Text/Image/Audio/Video",
                "Reasoning, coding, long context",
                "AI Studio, Vertex",
              ],
              [
                "Gemini 2.0 Flash",
                "Google",
                "1M",
                "Text/Image/Audio/Video",
                "Fast multimodal, high volume",
                "AI Studio, Vertex",
              ],
              [
                "Mistral Large 2",
                "Mistral AI",
                "128K",
                "Text",
                "Multilingual, EU data",
                "Mistral API, Azure, AWS",
              ],
              [
                "Command A",
                "Cohere",
                "256K",
                "Text",
                "RAG, enterprise, citations",
                "Cohere API, Azure, AWS",
              ],
            ].map((row, i) => (
              <tr key={i} style={i % 2 === 1 ? trAlt : {}}>
                {row.map((cell, j) => (
                  <td key={j} style={tdStyle}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ margin: "0 0 0.6rem", color: "#1e293b" }}>
        Open-Source Models
      </h4>
      <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
        <table
          className="edu-table"
          style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}
        >
          <thead>
            <tr>
              {[
                "Model",
                "Maker",
                "Params",
                "Context",
                "License",
                "Strengths",
                "Local",
              ].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              [
                "Llama 4 Scout",
                "Meta",
                "17B MoE",
                "10M",
                "Llama 4 Community",
                "Multimodal, ultra-long context",
                "✅ (GPU)",
              ],
              [
                "Llama 4 Maverick",
                "Meta",
                "400B MoE",
                "1M",
                "Llama 4 Community",
                "Frontier quality, multimodal",
                "✅ (multi-GPU)",
              ],
              [
                "Llama 3.3 70B",
                "Meta",
                "70B",
                "128K",
                "Llama 3 Community",
                "Best dense open-weight",
                "✅ (GPU)",
              ],
              [
                "Qwen 3 235B MoE",
                "Alibaba",
                "235B/22B active",
                "128K",
                "Apache 2.0",
                "Frontier MoE, hybrid thinking",
                "✅ (multi-GPU)",
              ],
              [
                "Qwen 3 32B",
                "Alibaba",
                "32B",
                "128K",
                "Apache 2.0",
                "Chinese/English, coding",
                "✅ (GPU)",
              ],
              [
                "DeepSeek V3",
                "DeepSeek",
                "671B/37B active",
                "128K",
                "MIT",
                "Frontier quality, cheap API",
                "✅ (multi-GPU)",
              ],
              [
                "DeepSeek R1",
                "DeepSeek",
                "671B/37B active",
                "128K",
                "MIT",
                "Reasoning rival to o3",
                "✅ (multi-GPU)",
              ],
              [
                "DeepSeek R1 7B",
                "DeepSeek (distil)",
                "7B",
                "128K",
                "MIT",
                "Reasoning on small model",
                "✅ (consumer GPU)",
              ],
              [
                "Gemma 3 27B",
                "Google",
                "27B",
                "128K",
                "Gemma Terms",
                "Multimodal, near-GPT-4o quality",
                "✅",
              ],
            ].map((row, i) => (
              <tr key={i} style={i % 2 === 1 ? trAlt : {}}>
                {row.map((cell, j) => (
                  <td key={j} style={tdStyle}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ margin: "0 0 0.5rem", color: "#1e293b" }}>How to choose</h4>
      <ul
        style={{ fontSize: "0.84rem", color: "#334155", paddingLeft: "1.2rem" }}
      >
        <li>
          <strong>Best overall quality (commercial):</strong> Claude Sonnet 4.6
          or GPT-4o — Claude wins on instruction-following and long docs; GPT-4o
          wins on multimodal.
        </li>
        <li>
          <strong>Reasoning / extended thinking:</strong> o3/o4-mini, Claude
          Opus 4.7 (thinking mode), Gemini 2.5 Pro, or DeepSeek R1 — use when
          step-by-step reasoning matters.
        </li>
        <li>
          <strong>Largest context window:</strong> Llama 4 Scout (10M tokens) or
          Gemini 2.5 Pro (1M+) — process entire codebases or multi-hour
          transcripts.
        </li>
        <li>
          <strong>Best open-source general purpose:</strong> Llama 3.3 70B
          (dense) or Llama 4 Maverick (MoE frontier quality).
        </li>
        <li>
          <strong>Best open-source coding:</strong> Qwen3-Coder or DeepSeek V3 —
          state-of-the-art open-source code models.
        </li>
        <li>
          <strong>Cheapest capable model:</strong> Claude Haiku 4.5, GPT-4o
          mini, or Gemini 2.0 Flash — strong for high-volume pipelines.
        </li>
        <li>
          <strong>Local inference / privacy:</strong> Ollama + Llama 3.3 70B
          (GPU) or Qwen 3 8B (consumer GPU) — runs with quantisation.
        </li>
        <li>
          <strong>European data residency:</strong> Mistral Large 2 (Le Chat /
          Azure EU regions) or open-source Mistral on EU infra.
        </li>
        <li>
          <strong>This demo:</strong> The Super Banking LangChain agent is
          model-agnostic — configurable via <code>OPENAI_MODEL</code> env var in{" "}
          <code>langchain_agent/</code>.
        </li>
      </ul>

      <p
        style={{
          fontSize: "0.78rem",
          color: "#94a3b8",
          marginTop: "1rem",
          fontStyle: "italic",
        }}
      >
        Benchmarks and pricing change frequently. Verify current performance at{" "}
        <a
          href="https://lmsys.org/chat"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#94a3b8" }}
        >
          lmsys.org/chat
        </a>{" "}
        (Chatbot Arena) and{" "}
        <a
          href="https://artificialanalysis.ai"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#94a3b8" }}
        >
          artificialanalysis.ai
        </a>
        .
      </p>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

export default function LlmLandscapePanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    { id: "commercial", label: "Commercial", content: <CommercialContent /> },
    { id: "opensource", label: "Open-Source", content: <OpenSourceContent /> },
    {
      id: "howllmswork",
      label: "How LLMs Work",
      content: <HowLlmsWorkContent />,
    },
    { id: "comparison", label: "Comparison", content: <ComparisonContent /> },
  ];
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="LLM Landscape"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
