import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';

// ── Helpers ────────────────────────────────────────────────────────────────

function VendorHeader({ emoji, name, tagline, color }) {
  return (
    <div style={{
      borderLeft: `5px solid ${color}`, background: 'var(--edu-card-bg, #f8fafc)',
      borderRadius: '0 8px 8px 0', padding: '0.85rem 1rem', marginBottom: '1rem',
    }}>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>{emoji} {name}</div>
      <div style={{ fontSize: '0.84rem', color: '#374151', marginTop: '0.15rem', fontStyle: 'italic' }}>{tagline}</div>
    </div>
  );
}

function ToolCard({ name, category, description, color }) {
  return (
    <div style={{
      borderLeft: `3px solid ${color}`, background: '#fff',
      border: `1px solid #e2e8f0`, borderLeftColor: color,
      borderRadius: '0 6px 6px 0', padding: '0.65rem 0.85rem', marginBottom: '0.6rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
        <strong style={{ fontSize: '0.88rem', color: '#1e293b' }}>{name}</strong>
        <span style={{ fontSize: '0.71rem', background: color, color: '#fff', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{category}</span>
      </div>
      <p style={{ margin: 0, fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>{description}</p>
    </div>
  );
}

// ── Tab content ────────────────────────────────────────────────────────────

function AwsContent() {
  const c = '#f97316';
  return (
    <div>
      <VendorHeader emoji="🟠" name="Amazon Web Services" tagline="Build with the broadest AI/ML portfolio on the planet" color={c} />
      <ToolCard name="Amazon Bedrock" category="Foundation Model API" color={c}
        description="Managed serverless API for 30+ foundation models (Anthropic Claude, Meta Llama, Mistral, Titan, etc.). No GPU management; pay-per-token. Supports RAG via Knowledge Bases, multi-step agents via Bedrock Agents, and fine-tuning." />
      <ToolCard name="Amazon SageMaker" category="ML Platform" color={c}
        description="End-to-end ML lifecycle: data prep, training, deployment, monitoring. Supports custom models, distributed training, real-time and batch inference. JumpStart library for pre-trained models." />
      <ToolCard name="Amazon Q" category="Enterprise AI Assistant" color={c}
        description="Generative AI assistant for developers (Q Developer, integrated in VS Code/JetBrains) and business users (Q Business for document Q&A). Fine-tunable on company data." />
      <ToolCard name="Amazon Rekognition" category="Vision AI" color={c}
        description="Image/video analysis: object detection, facial recognition, content moderation, text in image. REST API, no ML expertise required." />
      <ToolCard name="Amazon Comprehend" category="NLP" color={c}
        description="Entity recognition, sentiment analysis, topic modeling, key phrase extraction. Supports custom entity/classification models trained on your data." />
      <ToolCard name="Amazon Lex" category="Conversational AI" color={c}
        description="Build chatbots and voice bots with NLU. Integrates with Lambda for fulfilment. Powers Alexa." />
      <ToolCard name="Amazon Kendra" category="Enterprise Search" color={c}
        description="Intelligent search backed by NLP. Connects to S3, SharePoint, Salesforce. Bedrock Knowledge Bases is the newer evolution for RAG workloads." />
      <ToolCard name="Amazon Polly / Transcribe / Translate" category="Speech & Language" color={c}
        description="Polly: text-to-speech. Transcribe: speech-to-text with custom vocabulary. Translate: 75+ language pairs with neural machine translation." />
      <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '0.65rem 0.85rem', marginTop: '0.5rem', fontSize: '0.82rem', color: '#9a3412' }}>
        <strong>Key note:</strong> AWS Bedrock Agents support multi-step agentic workflows with tool use; integrate with Step Functions for orchestration. IAM-native auth — no separate identity layer needed for AWS-internal agents.
      </div>
    </div>
  );
}

function MicrosoftContent() {
  const c = 'var(--brand-navy)';
  return (
    <div>
      <VendorHeader emoji="🔷" name="Microsoft Azure AI" tagline="AI everywhere, from infrastructure to copilots" color={c} />
      <ToolCard name="Azure OpenAI Service" category="Foundation Model API" color={c}
        description="Microsoft-hosted GPT-4o, o1, DALL-E, Whisper. Same models as OpenAI.com with enterprise SLAs, data residency, private networking (VNet), and Azure AD auth. Fine-tuning available." />
      <ToolCard name="Azure AI Foundry" category="AI Development Platform" color={c}
        description="Unified portal (formerly Azure AI Studio) for model catalog, prompt flow, evaluations, and agent deployment. Model catalog includes Llama, Mistral, Cohere, Phi, and more." />
      <ToolCard name="Microsoft Copilot Studio" category="Agent Builder" color={c}
        description="Low-code/no-code agent builder (formerly Power Virtual Agents). Build custom copilots with GPT-4 backbone, publish to Teams, web, Phone. Supports autonomous triggers and MCP." />
      <ToolCard name="Azure AI Search" category="RAG Backbone" color={c}
        description="Vector + keyword hybrid search with integrated chunking, embedding, and reranking. Core component of RAG pipelines on Azure. Semantic ranker powered by Microsoft's Bing ranking models." />
      <ToolCard name="Azure Machine Learning" category="ML Platform" color={c}
        description="End-to-end ML: experiments, pipelines, model registry, deployment to managed endpoints. MLflow integration." />
      <ToolCard name="Azure AI Content Safety" category="Safety & Moderation" color={c}
        description="API for detecting harmful content (hate, violence, sexual, self-harm) in text and images. Used to gate LLM inputs/outputs in production." />
      <ToolCard name="Microsoft Semantic Kernel" category="Agent SDK" color={c}
        description="Open-source SDK (C#, Python, Java) for building LLM-powered apps and agents. Plugin/tool model, memory connectors, planner. Microsoft's answer to LangChain." />
      <ToolCard name="Phi-3 / Phi-4 (SLMs)" category="Small Language Models" color={c}
        description="Microsoft's open-weight small models (3.8B–14B params). Strong reasoning relative to size; deployable on-device or edge. Available via HuggingFace and Azure AI Foundry." />
    </div>
  );
}

function GoogleContent() {
  const c = '#16a34a';
  return (
    <div>
      <VendorHeader emoji="🟢" name="Google Cloud AI" tagline="From research breakthroughs to production AI" color={c} />
      <ToolCard name="Vertex AI" category="AI Platform" color={c}
        description="Google Cloud's unified ML/AI platform: train, deploy, and manage models. Model Garden hosts 160+ models (Gemini, Llama, Mistral, Claude via Anthropic partnership). AutoML for no-code training." />
      <ToolCard name="Gemini API / Google AI Studio" category="Foundation Model API" color={c}
        description="Direct API access to Gemini 1.5 Pro/Flash/Nano and Gemini 2.x. Google AI Studio for rapid prototyping. 1M+ token context window. Multimodal: text, image, audio, video." />
      <ToolCard name="Vertex AI Agent Builder" category="Agent Framework" color={c}
        description="Build grounded agents with RAG (data store connectors), multi-turn conversation, and Google Search grounding. Replaces CCAI and Dialogflow CX for new projects." />
      <ToolCard name="Gemini for Google Workspace" category="Enterprise Copilot" color={c}
        description="AI embedded in Gmail, Docs, Sheets, Meet. NotebookLM for document-grounded Q&A. Summarise, draft, and analyse directly in productivity tools." />
      <ToolCard name="Google Cloud Natural Language API" category="NLP" color={c}
        description="Syntax analysis, entity recognition, sentiment, content classification. Pre-trained REST API with Healthcare NL and multilingual support." />
      <ToolCard name="Vision AI / Document AI / Video AI" category="Multimodal AI" color={c}
        description="Vision: image labeling, OCR, face detection. Document AI: extract structured data from PDFs/forms. Video AI: transcription, content moderation, object tracking." />
      <ToolCard name="BigQuery ML" category="ML in Data Warehouse" color={c}
        description="Run ML models (linear regression, classification, ARIMA forecasting, even LLMs) directly in SQL on BigQuery data. No data movement necessary." />
      <ToolCard name="Cloud TPUs / Hyperdisk ML" category="AI Infrastructure" color={c}
        description="Custom AI accelerators (TPU v5e/v5p); Hyperdisk ML for fast model loading. Foundation for training large models at Google scale." />
    </div>
  );
}

function IbmContent() {
  const c = 'var(--brand-navy)';
  return (
    <div>
      <VendorHeader emoji="🔵" name="IBM watsonx" tagline="Enterprise AI built for trust, transparency, and governance" color={c} />
      <ToolCard name="watsonx.ai" category="AI Studio" color={c}
        description="Train, validate, tune, and deploy foundation models and ML models. Model library includes IBM Granite (open-source), Llama, Mistral. Prompt Lab for prompt engineering." />
      <ToolCard name="IBM Granite Models" category="Foundation Models" color={c}
        description="IBM's own open-source model family (Granite-13B, Granite-3B, Code models). Apache 2.0 licensed with full transparency on training data (curated, documented lineage). Designed for enterprise: smaller, cost-efficient, auditable." />
      <ToolCard name="watsonx.data" category="Data Lakehouse" color={c}
        description="Open lakehouse architecture (Presto, Apache Spark, Apache Iceberg). Connects AI to governed data at scale. Reduces data warehouse costs by up to 50%." />
      <ToolCard name="watsonx.governance" category="AI Governance ⭐" color={c}
        description="Automated model risk management: bias detection, drift monitoring, explainability, regulatory compliance (EU AI Act, SR 11-7). This is IBM's key differentiator vs. other vendors." />
      <ToolCard name="Watson Assistant" category="Conversational AI" color={c}
        description="Enterprise chatbot builder. Integrates with watsonx.ai for LLM backbone. Deploys to web, phone, Slack, Salesforce." />
      <ToolCard name="Watson Discovery" category="Enterprise Search" color={c}
        description="AI-powered document search and NLP enrichment. RAG-ready with watsonx.ai integration." />
      <ToolCard name="IBM OpenScale / OpenPages" category="Risk & Compliance" color={c}
        description="OpenScale: AI fairness, bias, and explainability monitoring. OpenPages: integrated risk management platform with AI for regulated industries." />
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '0.65rem 0.85rem', marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--brand-navy)' }}>
        <strong>IBM differentiator:</strong> IBM's focus is enterprise governance and transparency — auditability, bias monitoring, and compliance for regulated industries (banking, healthcare, insurance). Granite models publish full data lineage.
      </div>
    </div>
  );
}

function AnthropicContent() {
  const c = '#7c3aed';
  return (
    <div>
      <VendorHeader emoji="🟣" name="Anthropic" tagline="AI safety focused — powerful, steerable, and honest" color={c} />
      <ToolCard name="Claude 3.5 Sonnet / Haiku / Opus 3" category="Foundation Models" color={c}
        description="Claude is Anthropic's frontier model family. Sonnet 3.5: best price/performance balance; Haiku 3.5: fastest/cheapest; Opus 3: most capable for complex reasoning. 200K token context window." />
      <ToolCard name="Claude API (api.anthropic.com)" category="Direct API" color={c}
        description="REST API with Messages endpoint. Tool use (function calling), vision (image inputs), streaming. Claude.ai for direct consumer access." />
      <ToolCard name="Claude on Amazon Bedrock" category="Hosted API via AWS" color={c}
        description="Claude 3 family available via AWS Bedrock. Enterprise customers access Claude with AWS IAM, VPC, and data residency controls." />
      <ToolCard name="Claude on Google Vertex AI" category="Hosted API via GCP" color={c}
        description="Claude 3 family available via Vertex AI Model Garden. GCP-native auth, compliance, and private networking." />
      <ToolCard name="Constitutional AI (CAI)" category="Safety Technique" color={c}
        description="Anthropic's training methodology: models are trained to follow a 'constitution' of principles (harmlessness, helpfulness, honesty). RLHF guided by AI feedback rather than purely human labels — more scalable." />
      <ToolCard name="Model Card & Eval Transparency" category="Safety & Research" color={c}
        description="Published evals for jailbreaks, CBRN risk, autonomy, deception. Responsible Scaling Policy: capability thresholds trigger additional safety work before deployment." />
      <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: '0.65rem 0.85rem', marginTop: '0.5rem', fontSize: '0.82rem', color: '#4c1d95' }}>
        <strong>Important note:</strong> Anthropic does not offer a full cloud AI platform — they are a model company. Their competitive advantage is frontier capability with safety-first training. Integrations via AWS Bedrock and Google Vertex AI cover enterprise deployment needs.
      </div>
    </div>
  );
}

function OpenAiContent() {
  const c = '#059669';
  return (
    <div>
      <VendorHeader emoji="🟩" name="OpenAI" tagline="From research lab to the AI infrastructure of the internet" color={c} />
      <ToolCard name="GPT-4o / GPT-4o mini / o1 / o3" category="Foundation Models" color={c}
        description="GPT-4o: multimodal (text/image/audio), fast, strong coding. o1/o3: reasoning models with extended chain-of-thought. GPT-4o mini: cost-optimised for high-volume pipelines." />
      <ToolCard name="OpenAI API — Chat Completions" category="Direct API" color={c}
        description="Chat Completions, Files, Embeddings, Fine-tuning, Moderation, TTS, Whisper (STT), DALL-E (image gen). Batch API for async processing at 50% discount." />
      <ToolCard name="Assistants API" category="Agent Platform" color={c}
        description="Threads, Messages, Runs, Tool calls (Code Interpreter, File Search, Function Calling). Stateful: OpenAI manages conversation history and context automatically." />
      <ToolCard name="OpenAI Realtime API" category="Voice AI" color={c}
        description="Low-latency audio-in / audio-out via WebSocket. Powers voice agents with sub-300ms response time. Supports function calling mid-conversation." />
      <ToolCard name="DALL-E 3 / Sora" category="Generative Media" color={c}
        description="DALL-E 3: text-to-image, available via API and ChatGPT. Sora: text-to-video (limited access); sets state-of-the-art for video generation quality." />
      <ToolCard name="ChatGPT Enterprise / Team" category="Enterprise SaaS" color={c}
        description="Data not used for training, SSO/SCIM, higher rate limits, custom GPTs, GPT-4o and o1 access for all employees." />
      <ToolCard name="OpenAI Embeddings (text-embedding-3-large)" category="RAG Backbone" color={c}
        description="State-of-the-art text embeddings for semantic search. 3072 dimensions; supports Matryoshka compression to 256 dimensions with minimal quality loss." />
      <ToolCard name="Fine-tuning" category="Customisation" color={c}
        description="Fine-tune GPT-4o, GPT-4o mini, GPT-3.5 Turbo on custom datasets. Supports function calling and vision fine-tuning." />
      <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, padding: '0.65rem 0.85rem', marginTop: '0.5rem', fontSize: '0.82rem', color: '#065f46' }}>
        <strong>Ecosystem note:</strong> ChatGPT has 200M+ weekly active users. The OpenAI platform is the most widely adopted developer AI API. Microsoft Azure OpenAI Service mirrors the API with enterprise controls and data residency.
      </div>
    </div>
  );
}

function ComparisonContent() {
  const thStyle = { padding: '0.5rem 0.65rem', background: '#1e293b', color: '#f1f5f9', fontSize: '0.75rem', textAlign: 'left', whiteSpace: 'nowrap' };
  const tdStyle = { padding: '0.4rem 0.65rem', fontSize: '0.76rem', color: '#334155', borderBottom: '1px solid #e2e8f0', verticalAlign: 'top' };
  const trAlt = { background: '#f8fafc' };
  const headers = ['Feature', 'AWS', 'Microsoft', 'Google', 'IBM', 'Anthropic', 'OpenAI'];
  const rows = [
    ['Primary models', 'Titan + Bedrock hosted', 'GPT-4o / Phi', 'Gemini', 'Granite', 'Claude', 'GPT-4o / o1'],
    ['Model hosting', 'Bedrock (30+ models)', 'Azure OpenAI / AI Foundry', 'Vertex AI Model Garden', 'watsonx.ai', 'API + Bedrock/Vertex', 'API + Azure'],
    ['Agent framework', 'Bedrock Agents', 'Copilot Studio / Semantic Kernel', 'Vertex AI Agent Builder', 'Watson Assistant', 'None native', 'Assistants API'],
    ['RAG / enterprise search', 'Bedrock KB + Kendra', 'Azure AI Search', 'Vertex AI RAG / Agent Builder', 'Watson Discovery + watsonx.data', 'None native', 'File Search (Assistants)'],
    ['Fine-tuning', 'Bedrock + SageMaker', 'Azure OpenAI fine-tuning', 'Vertex AI supervised tuning', 'watsonx.ai fine-tuning', 'Not public', 'GPT-4o fine-tuning'],
    ['Open-source models', 'Llama/Mistral via Bedrock', 'Phi-3/4, Llama via Foundry', 'Gemma, Llama via Vertex', 'Granite (Apache 2.0) ⭐', 'None', 'None (proprietary)'],
    ['AI governance / safety', 'SageMaker Clarify (bias)', 'Azure AI Content Safety', 'Vertex Model Monitoring', 'watsonx.governance ⭐', 'Constitutional AI', 'Moderation API'],
    ['Multimodal', 'Bedrock + Rekognition', 'GPT-4o via Azure OpenAI', 'Gemini natively', 'Limited', 'Claude 3 (image)', 'GPT-4o natively'],
    ['On-premises / air-gapped', 'AWS Outposts', 'Azure Stack', 'Distributed Cloud', 'watsonx on-prem ⭐', 'None', 'None'],
    ['Pricing model', 'Per-token + compute', 'Per-token + compute', 'Per-token + compute', 'Per-token + platform', 'Per-token', 'Per-token'],
  ];
  const bestFor = [
    ['AWS', '#f97316', 'Existing AWS shops; broadest model choice + deep AWS service integration.'],
    ['Microsoft', 'var(--brand-navy)', 'Office 365 / Teams shops that want enterprise copilots with Azure compliance.'],
    ['Google', '#16a34a', 'Very long context windows, multimodal (text/image/audio/video natively), or BigQuery ML.'],
    ['IBM', 'var(--brand-navy)', 'Banking, insurance, or healthcare needing auditable AI governance + regulatory compliance.'],
    ['Anthropic', '#7c3aed', 'Safety-critical applications, or when Claude\'s instruction-following quality is essential.'],
    ['OpenAI', '#059669', 'Largest developer ecosystem, most mature Assistants API, or real-time voice AI.'],
  ];

  return (
    <div>
      <h4 style={{ margin: '0 0 0.6rem', color: '#1e293b' }}>Platform Feature Matrix</h4>
      <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
        <table className="edu-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr>{headers.map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={i % 2 === 1 ? trAlt : {}}>
                {row.map((cell, j) => (
                  <td key={j} style={{ ...tdStyle, fontWeight: j === 0 ? 600 : 400 }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ margin: '0 0 0.6rem', color: '#1e293b' }}>How to choose</h4>
      {bestFor.map(([vendor, color, text]) => (
        <div key={vendor} style={{
          display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
          marginBottom: '0.45rem', fontSize: '0.84rem',
        }}>
          <span style={{ background: color, color: '#fff', borderRadius: 4, padding: '1px 7px', whiteSpace: 'nowrap', fontSize: '0.76rem', marginTop: '0.1rem' }}>{vendor}</span>
          <span style={{ color: '#475569' }}>{text}</span>
        </div>
      ))}

      <p style={{ fontSize: '0.78rem', color: '#374151', marginTop: '1.2rem', fontStyle: 'italic' }}>
        ⭐ = significant differentiator. Table reflects public information as of early 2026. Check each vendor's docs for current pricing and feature availability.
      </p>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

export default function AiPlatformLandscapePanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    { id: 'aws',        label: 'AWS',        content: <AwsContent /> },
    { id: 'microsoft',  label: 'Microsoft',  content: <MicrosoftContent /> },
    { id: 'google',     label: 'Google',     content: <GoogleContent /> },
    { id: 'ibm',        label: 'IBM',        content: <IbmContent /> },
    { id: 'anthropic',  label: 'Anthropic',  content: <AnthropicContent /> },
    { id: 'openai',     label: 'OpenAI',     content: <OpenAiContent /> },
    { id: 'comparison', label: 'Comparison', content: <ComparisonContent /> },
  ];
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="AI Platform Landscape"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
