import React from 'react';
import './AgentLifecyclePage.css';

function RegistrationSlot() {
  return (
    <section className="alp-slot alp-slot--video">
      <h2 className="alp-slot__title">1. Register agent + scoped consent</h2>
      <p className="alp-slot__desc">
        A user registers an AI agent and delegates account access via a
        scoped consent screen. Recorded walkthrough (live registration isn't
        built yet):
      </p>
      <video
        className="alp-video"
        src="/media/contractor-lcm-ai-agent.mp4"
        controls
        aria-label="Agent registration and consent walkthrough"
      />
    </section>
  );
}

export default function AgentLifecyclePage() {
  return (
    <div className="alp-wrap">
      <h1 className="alp-title">Agent Lifecycle</h1>
      <p className="alp-subtitle">
        Register, call, step up, and revoke — one AI agent's full access
        lifecycle end to end.
      </p>
      <RegistrationSlot />
    </div>
  );
}
