// demo_api_ui/src/components/aiFootprintMocks/ChromeFrames.jsx
import "./chrome.css";

const SAMPLE_TS = `export async function createTransfer(req) {
  const { amount, from, to } = req.body;
  return gateway.invoke("create_transfer", {
    amount, fromAccount: from, toAccount: to,
  });
}`;

/** Honesty badge shared by all costume shells. */
export function SimulatedBadge({ pill = false }) {
  return (
    <span className={`afm-badge${pill ? " afm-badge--pill" : ""}`}>
      Simulated shell · Ping demo agent
    </span>
  );
}

/**
 * @param {{ variant: string, hostRef?: (el: HTMLElement|null) => void, preview?: boolean, onExit?: () => void }} props
 */
export function VsCodeChrome({ variant = "classic-dark", hostRef, preview = false, onExit }) {
  const light = variant === "light";
  const studio = variant === "copilot-studio";
  const cls = [
    "afm-vcs",
    light ? "afm-vcs--light" : "",
    studio ? "afm-vcs--studio" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} data-variant={variant}>
      <div className="afm-vcs-title">
        <div className="afm-vcs-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <strong>banking-demo — Visual Studio Code</strong>
        <SimulatedBadge />
        {onExit ? (
          <button type="button" className="afm-badge" onClick={onExit}>
            Exit
          </button>
        ) : null}
      </div>
      <div className="afm-vcs-body">
        <div className="afm-vcs-act" aria-hidden="true">
          <span className="is-on" />
          <span />
          <span />
        </div>
        <aside className="afm-vcs-side">
          <div className="lbl">Explorer</div>
          <div className="f">README.md</div>
          <div className="f on">transfer.ts</div>
          <div className="f">oauth.ts</div>
        </aside>
        <div className="afm-vcs-main">
          <section className="afm-vcs-editor">
            <div className="afm-vcs-tabs">
              <div className="tab">transfer.ts</div>
            </div>
            <pre className="afm-vcs-code">{SAMPLE_TS}</pre>
          </section>
          <aside className="afm-vcs-copilot">
            <div className="afm-vcs-chead">
              <span>Copilot Chat</span>
              <span style={{ opacity: 0.6 }}>{studio ? "studio" : "chat"}</span>
            </div>
            <div
              ref={hostRef}
              className={`afm-host${preview ? " afm-host--preview" : ""}`}
            >
              {preview ? "Agent host (live on demo route)" : null}
            </div>
          </aside>
        </div>
      </div>
      <div className="afm-vcs-status">
        <span>main*</span>
        <span>Ping demo agent</span>
      </div>
    </div>
  );
}

/**
 * @param {{ variant: string, hostRef?: (el: HTMLElement|null) => void, preview?: boolean, onExit?: () => void }} props
 */
export function ChatGptChrome({ variant = "desktop-dark", hostRef, preview = false, onExit }) {
  const light = variant === "desktop-light";
  const web = variant === "web";
  const cls = [
    "afm-cgpt",
    light ? "afm-cgpt--light" : "",
    web ? "afm-cgpt--web" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} data-variant={variant}>
      <div className="afm-cgpt-title">
        <div className="afm-vcs-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <strong>{web ? "ChatGPT — Web" : "ChatGPT"}</strong>
        <SimulatedBadge pill />
        {onExit ? (
          <button type="button" className="afm-badge afm-badge--pill" onClick={onExit}>
            Exit
          </button>
        ) : null}
      </div>
      <div className="afm-cgpt-body">
        <aside className="afm-cgpt-side">
          <div className="new">+ New chat</div>
          <div className="item on">Banking balances and transfer</div>
          <div className="item">Explain token exchange</div>
          <div className="item">Mortgage rate questions</div>
        </aside>
        <section className="afm-cgpt-main">
          <div className="afm-cgpt-mhead">
            ChatGPT
            <span>endpoint-native · Ping-backed</span>
          </div>
          <div
            ref={hostRef}
            className={`afm-host${preview ? " afm-host--preview" : ""}`}
          >
            {preview ? "Agent host (live on demo route)" : null}
          </div>
          <div className="afm-cgpt-foot">
            Simulated chrome. Messages use the Ping demo banking agent.
          </div>
        </section>
      </div>
    </div>
  );
}

const SAAS_COPY = {
  zendesk: {
    logo: "Support Desk",
    tabs: ["Tickets", "Customers", "Apps"],
    cards: [
      { h: "Ticket #4821 — Wire transfer question", p: "Customer asks an agent to move $500 to savings." },
      { h: "Macro: Verify identity", p: "Before money movement, Ping HITL / MFA must fire." },
    ],
    agentTitle: "Support AI",
  },
  glean: {
    logo: "Work Search",
    tabs: ["Home", "Chat", "Collections"],
    cards: [
      { h: "Ask across company knowledge", p: "Assistant can also call banking tools when authorized." },
      { h: "Result: Transfer policy", p: "Cite Ping Authorize decision + scopes." },
    ],
    agentTitle: "Assistant",
  },
  generic: {
    logo: "Vendor SaaS",
    tabs: ["Inbox", "Reports", "Admin"],
    cards: [
      { h: "Embedded agent drawer", p: "Vendor owns runtime; Ping owns identity + step-up." },
      { h: "Action: Show accounts", p: "Distinct client_id in Token Chain." },
    ],
    agentTitle: "In-app agent",
  },
};

/**
 * @param {{ variant: string, hostRef?: (el: HTMLElement|null) => void, preview?: boolean, onExit?: () => void }} props
 */
export function SaasChrome({ variant = "zendesk", hostRef, preview = false, onExit }) {
  const copy = SAAS_COPY[variant] || SAAS_COPY.zendesk;
  return (
    <div className={`afm-saas afm-saas--${variant}`} data-variant={variant}>
      <div className="afm-saas-top">
        <div className="logo">{copy.logo}</div>
        <div className="tabs">
          {copy.tabs.map((t, i) => (
            <em key={t}>{i === 0 ? t : t}</em>
          ))}
        </div>
        <SimulatedBadge />
        {onExit ? (
          <button type="button" className="afm-badge" onClick={onExit}>
            Exit
          </button>
        ) : null}
      </div>
      <div className="afm-saas-body">
        <div className="afm-saas-main">
          {copy.cards.map((c) => (
            <div className="afm-saas-card" key={c.h}>
              <h4>{c.h}</h4>
              <p>{c.p}</p>
            </div>
          ))}
        </div>
        <aside className="afm-saas-agent">
          <div className="ah">
            <span>{copy.agentTitle}</span>
            <span style={{ opacity: 0.7, fontWeight: 400 }}>saas-embedded</span>
          </div>
          <div
            ref={hostRef}
            className={`afm-host${preview ? " afm-host--preview" : ""}`}
          >
            {preview ? "Agent host (live on demo route)" : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * @param {{ variant: string, hostRef?: (el: HTMLElement|null) => void, preview?: boolean, onExit?: () => void }} props
 */
export function CodingChrome({ variant = "claude-code", hostRef, preview = false, onExit }) {
  if (variant === "claude-code") {
    return (
      <div className="afm-code" data-variant={variant}>
        <div className="afm-code-bar">
          <strong>coding-agent — terminal</strong>
          <SimulatedBadge />
          {onExit ? (
            <button type="button" className="afm-badge" onClick={onExit}>
              Exit
            </button>
          ) : null}
        </div>
        <div className="afm-code-body">
          <div className="afm-code-term">
            <span className="prompt">$</span> agent &quot;find transfer scope checks&quot;{"\n"}
            <span className="dim">→ searching MCP code_search …</span>
            {"\n"}
            <span className="dim">→ get_code oauth.ts</span>
            {"\n\n"}
            <span className="prompt">agent&gt;</span> ready for next instruction
          </div>
          <aside className="afm-code-panel">
            <div className="ph">
              <span>Agent</span>
              <span style={{ opacity: 0.6 }}>coding</span>
            </div>
            <div
              ref={hostRef}
              className={`afm-host${preview ? " afm-host--preview" : ""}`}
            >
              {preview ? "Agent host (live on demo route)" : null}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  if (variant === "vscode-inline") {
    return (
      <div className="afm-code afm-code--inline" data-variant={variant}>
        <div className="afm-code-bar">
          <strong>banking-demo — inline assistant</strong>
          <SimulatedBadge />
          {onExit ? (
            <button type="button" className="afm-badge" onClick={onExit}>
              Exit
            </button>
          ) : null}
        </div>
        <div className="afm-code-body">
          <div className="afm-code-editor">
            <pre>{SAMPLE_TS}</pre>
            <div className="afm-code-ghost">
              ghost suggestion: add requireScopes(&quot;banking:write&quot;) before invoke
            </div>
          </div>
          <aside className="afm-code-panel">
            <div className="ph">
              <span>Inline chat</span>
              <span style={{ opacity: 0.6 }}>coding</span>
            </div>
            <div
              ref={hostRef}
              className={`afm-host${preview ? " afm-host--preview" : ""}`}
            >
              {preview ? "Agent host (live on demo route)" : null}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // cursor-shaped
  return (
    <div className="afm-code afm-code--cursor" data-variant={variant}>
      <div className="afm-code-bar">
        <strong>AI IDE — composer</strong>
        <SimulatedBadge />
        {onExit ? (
          <button type="button" className="afm-badge" onClick={onExit}>
            Exit
          </button>
        ) : null}
      </div>
      <div className="afm-code-body">
        <div className="afm-code-editor">
          <pre>{SAMPLE_TS}</pre>
        </div>
        <aside className="afm-code-panel">
          <div className="ph">
            <span>Composer</span>
            <span style={{ opacity: 0.6 }}>coding</span>
          </div>
          <div
            ref={hostRef}
            className={`afm-host${preview ? " afm-host--preview" : ""}`}
          >
            {preview ? "Agent host (live on demo route)" : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Render chrome for a catalog category + variant id.
 */
export function FootprintChrome({ category, variant, hostRef, preview, onExit }) {
  if (category === "vscode") {
    return <VsCodeChrome variant={variant} hostRef={hostRef} preview={preview} onExit={onExit} />;
  }
  if (category === "chatgpt") {
    return <ChatGptChrome variant={variant} hostRef={hostRef} preview={preview} onExit={onExit} />;
  }
  if (category === "saas") {
    return <SaasChrome variant={variant} hostRef={hostRef} preview={preview} onExit={onExit} />;
  }
  if (category === "coding") {
    return <CodingChrome variant={variant} hostRef={hostRef} preview={preview} onExit={onExit} />;
  }
  return null;
}
