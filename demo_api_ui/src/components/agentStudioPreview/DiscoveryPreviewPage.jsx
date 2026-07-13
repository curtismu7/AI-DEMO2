// DiscoveryPreviewPage.jsx — "Discovery (Preview)": Flow 3's two stories
// (browser/device, cloud) from Tarun Madiraju's diagram, walked step by
// step. Completing either story surfaces a pending agent into the shared
// mock store for the Agent Studio Preview page's Admin tab to review.
import React, { useState, useCallback } from "react";
import { FLOWS } from "../../data/agentOnboardingFlows";
import { agentStudioMockStore } from "../../data/agentStudioMockStore";
import PreviewBanner from "./PreviewBanner";
import WizardStepper from "./WizardStepper";
import "./agentStudioPreview.css";

const STORIES = [
  { id: "browserDevice", label: "Story A · Browser & Device" },
  { id: "cloud", label: "Story B · Cloud" },
];

export default function DiscoveryPreviewPage() {
  const [story, setStory] = useState("browserDevice");

  const onDiscoverComplete = useCallback((storyId) => {
    if (storyId === "browserDevice") {
      agentStudioMockStore.addDiscovered({
        name: "cursor-shadow-session (unmanaged)",
        source: "Browser & Device",
        detectedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
    } else {
      agentStudioMockStore.addDiscovered({
        name: "vertex-batch-agent (unmanaged)",
        source: "Cloud — Vertex AI",
        detectedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
    }
  }, []);

  const activeStory = FLOWS.admin.stories[story];

  return (
    <div className="asp-root">
      <div className="asp-page">
        <PreviewBanner />
        <div className="asp-hero">
          <span className="asp-eyebrow">Agent Studio · Preview</span>
          <h1>Discovery</h1>
          <p>Two stories, sixteen steps — walk either one from the diagram.</p>
        </div>

        <div className="asp-tabs" role="tablist" aria-label="Discovery story">
          {STORIES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={story === s.id}
              className={`asp-tab${story === s.id ? " active" : ""}`}
              onClick={() => setStory(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <WizardStepper
          key={story}
          steps={activeStory.steps}
          outcome={activeStory.outcome}
          onComplete={() => onDiscoverComplete(story)}
        />
      </div>
    </div>
  );
}
