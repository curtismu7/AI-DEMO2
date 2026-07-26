// demo_api_ui/src/pages/FootprintLiveShellPage.jsx
// Live costume shell: selected chrome + real BankingAgent via surfaceHostEl.
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FootprintChrome } from "../components/aiFootprintMocks/ChromeFrames";
import { MOCK_CATALOG, readMockSelection } from "../components/aiFootprintMocks/mockSelection";
import { useAgentSurfaceHost } from "../hooks/useAgentSurfaceHost";
import "./FootprintMockGalleryPage.css";

const PATH_TO_CATEGORY = {
  "vscode-copilot": "vscode",
  "chatgpt-desktop": "chatgpt",
  "saas-embedded": "saas",
  "coding-agent": "coding",
};

/**
 * @param {{ category?: string }} [props] — optional override; else from :shellSlug
 */
export default function FootprintLiveShellPage({ category: categoryProp } = {}) {
  const { shellSlug } = useParams();
  const navigate = useNavigate();
  const category = categoryProp || PATH_TO_CATEGORY[shellSlug] || "vscode";
  const hostRef = useAgentSurfaceHost();

  const variant = useMemo(() => {
    const sel = readMockSelection();
    const id = sel[category];
    const known = MOCK_CATALOG[category]?.variants?.some((v) => v.id === id);
    return known ? id : MOCK_CATALOG[category]?.variants?.[0]?.id;
  }, [category]);

  return (
    <div className="afm-live-shell" data-testid={`footprint-live-${category}`}>
      <FootprintChrome
        category={category}
        variant={variant}
        hostRef={hostRef}
        onExit={() => navigate("/demo/footprint-picks")}
      />
    </div>
  );
}
