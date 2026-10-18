import "./ShadowAiDetectorPage.css";
import PageHeader from '../components/common/PageHeader';

const SIGNALS = [
  {
    title: "AI sites and API traffic",
    detail:
      "Recognizes configured AI domains and common model endpoints, including chat, completion, embedding, generation, message, prompt, inference, and agent paths.",
    examples: "ChatGPT, Claude, Gemini, Copilot, Perplexity, GitHub Copilot, Slack AI, Salesforce Einstein, Zoom AI",
  },
  {
    title: "OAuth consent",
    detail:
      "Looks for OAuth and OpenID-style authorization URLs associated with AI services, then scores requested scopes, redirect targets, and missing client IDs.",
    examples: "mail.read, mail.send, drive, files.readwrite, calendars.readwrite, directory.read.all, offline_access",
  },
  {
    title: "Installed AI extensions",
    detail:
      "Checks enabled browser extensions against known IDs and name patterns such as ChatGPT, Claude, Copilot, Grammarly, Merlin, Sider, and AI assistant.",
    examples: "Known extension ID match or an extension name containing a configured AI keyword",
  },
  {
    title: "Sensitive-data movement",
    detail:
      "Records metadata about large pastes, copied text, uploads, downloads, voice input, and media capture. It classifies signals locally rather than uploading clipboard text.",
    examples: "Email-shaped text, phone-shaped text, code-like text, document archives, spreadsheets, PDFs, and data files",
  },
  {
    title: "Browser-native AI",
    detail:
      "Detects supported built-in browser AI capabilities such as window.ai, the Prompt API, Gemini Nano surfaces, and navigator.ml where the browser exposes them.",
    examples: "Gemini Nano and other on-device AI capability signals",
  },
];

const SCORE_RULES = [
  ["Low", "0–29", "Limited signal"],
  ["Medium", "30–59", "Meaningful AI or data-flow signal"],
  ["High", "60–79", "Strong AI, OAuth, token, or sensitive-data signal"],
  ["Critical", "80–100", "Multiple or especially risky signals"],
];

export default function ShadowAiDetectorPage() {
  return (
    <main className="shadow-detector-page">
      <PageHeader className="shadow-detector-hero" eyebrow="AI-Gateway learning page" title="Shadow AI Detector" summary={<>A browser-side visibility layer for AI usage, OAuth-connected agents,
          and sensitive data flows. This page documents the signals the
          unpacked Chrome extension actually records.</>}>
        <div className="shadow-detector-hero-note">
          <span aria-hidden="true">🔍</span>
          <span>
            The detector reports activity and risk. It does not prove that an
            agent is malicious or inspect an agent&apos;s reasoning.
          </span>
        </div>
      </PageHeader>

      <section className="shadow-detector-section">
        <div className="shadow-detector-section-heading">
          <span className="shadow-detector-index">01</span>
          <div>
            <h2>What it watches</h2>
            <p>Detection is driven by domains, URL patterns, browser events, and extension metadata.</p>
          </div>
        </div>
        <div className="shadow-detector-signal-grid">
          {SIGNALS.map((signal) => (
            <article className="shadow-detector-signal" key={signal.title}>
              <h3>{signal.title}</h3>
              <p>{signal.detail}</p>
              <dl>
                <dt>Examples</dt>
                <dd>{signal.examples}</dd>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="shadow-detector-section shadow-detector-section--split">
        <div className="shadow-detector-section-heading">
          <span className="shadow-detector-index">02</span>
          <div>
            <h2>How risk is scored</h2>
            <p>Individual events receive a capped score, then a severity label.</p>
          </div>
        </div>
        <div className="shadow-detector-score-table" role="table" aria-label="Risk score bands">
          {SCORE_RULES.map(([level, range, meaning]) => (
            <div className={`shadow-detector-score-row shadow-detector-score-row--${level.toLowerCase()}`} role="row" key={level}>
              <strong role="cell">{level}</strong>
              <span role="cell">{range}</span>
              <span role="cell">{meaning}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="shadow-detector-section">
        <div className="shadow-detector-section-heading">
          <span className="shadow-detector-index">03</span>
          <div>
            <h2>What can raise a score</h2>
            <p>
              The bundled risk model combines a few concrete signals. It does
              not use an LLM judgment of the user, agent, or prompt.
            </p>
          </div>
        </div>
        <ul className="shadow-detector-rule-list">
          <li>Long AI visits, high API volume, or repeated visits to the same AI service.</li>
          <li>High-risk OAuth scopes, a missing client ID, or an off-box redirect URI.</li>
          <li>Redirects involving ngrok or localtunnel.</li>
          <li>Bearer-token use to an AI endpoint; only a short token prefix is recorded.</li>
          <li>Large or sensitive-looking clipboard transfers and file transfers.</li>
          <li>Known AI browser extensions or detected browser-native AI capability.</li>
        </ul>
      </section>

      <section className="shadow-detector-section shadow-detector-section--limits">
        <div className="shadow-detector-section-heading">
          <span className="shadow-detector-index">04</span>
          <div>
            <h2>What it does not detect</h2>
            <p>These boundaries matter when interpreting a dashboard finding.</p>
          </div>
        </div>
        <div className="shadow-detector-limits">
          <p>
            It does not determine whether an agent is malicious, inspect model
            reasoning, validate tool descriptions, evaluate MCP or A2A Agent
            Cards, or prove that sensitive data was actually exfiltrated.
          </p>
          <p>
            It also relies on known domains and URL shapes. A new provider,
            private endpoint, renamed extension, or novel API route can be
            missed. Conversely, a legitimate integration can look risky when
            it requests broad scopes or moves a large file.
          </p>
        </div>
      </section>

      <section className="shadow-detector-section shadow-detector-section--split">
        <div className="shadow-detector-section-heading">
          <span className="shadow-detector-index">05</span>
          <div>
            <h2>Permissions and telemetry</h2>
            <p>The extension has broad browser visibility, but the events it queues are mostly metadata.</p>
          </div>
        </div>
        <div className="shadow-detector-telemetry-grid">
          <div>
            <h3>Granted permissions</h3>
            <p>
              All-site access, tabs, web requests, downloads, extension management,
              web navigation, scripting, storage, and alarms. It injects a content
              monitor at document start and can inspect request headers and request
              bodies for matching traffic.
            </p>
          </div>
          <div>
            <h3>Event metadata</h3>
            <p>
              Event metadata such as URLs, domains, scopes, counts, file names, and
              risk scores can be sent to the configured backend. Clipboard events
              include lengths and classification flags; bearer events include only
              a short token prefix, not the full token.
            </p>
          </div>
        </div>
      </section>

      <footer className="shadow-detector-footer">
        <strong>Evidence reviewed</strong>
        <span>Chrome Manifest V3 bundle, version 1.0.0, loaded as an unpacked extension.</span>
        <span>Default event destination: http://localhost:8008/shadowai/events</span>
      </footer>
    </main>
  );
}
