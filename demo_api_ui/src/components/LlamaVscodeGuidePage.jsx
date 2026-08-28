import React from "react";

/**
 * LlamaVscodeGuidePage
 *
 * In-app host for the beginner "Set Up llama-vscode" guide.
 * The guide itself is a self-contained HTML file served from
 * /public/downloads/llama-vscode-setup-guide.html so there is a single
 * source of truth — this page embeds it and offers open/print actions.
 */
const GUIDE_URL = "/downloads/llama-vscode-setup-guide.html";

export default function LlamaVscodeGuidePage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 64px)",
        background: "#0f1117",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 20px",
          borderBottom: "1px solid #2c3140",
          background: "#1a1d27",
          color: "#e7e9ee",
        }}
      >
        <span style={{ fontSize: 22 }}>🧠</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>llama-vscode Setup Guide</div>
          <div style={{ fontSize: 13, color: "#a7adba" }}>
            Beginner walkthrough for running a local AI coding helper in VS Code
          </div>
        </div>
        <a
          href={GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: "#7c5cff",
            color: "#fff",
            textDecoration: "none",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Open in new tab ↗
        </a>
        <a
          href={GUIDE_URL}
          download="llama-vscode-setup-guide.html"
          style={{
            background: "transparent",
            color: "#a7adba",
            textDecoration: "none",
            border: "1px solid #2c3140",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Download
        </a>
      </div>
      <iframe
        title="llama-vscode Setup Guide"
        src={GUIDE_URL}
        style={{ flex: 1, width: "100%", border: "none" }}
      />
    </div>
  );
}
