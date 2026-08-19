// demo_api_ui/src/pages/FootprintLiveShellPage.jsx
// Live costume shell: selected chrome hosting the Privilege MCP client panel.
import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FootprintChrome } from "../components/aiFootprintMocks/ChromeFrames";
import { MOCK_CATALOG, readMockSelection } from "../components/aiFootprintMocks/mockSelection";
import { FootprintThemeToggle } from "../components/aiFootprintMocks/FootprintThemeToggle";
import { FootprintSkinPicker } from "../components/aiFootprintMocks/FootprintSkinPicker";
import { PrivilegeShellPanel } from "../components/aiFootprintMocks/PrivilegeShellPanel";
import { useFootprintTheme } from "../hooks/useFootprintTheme";
import "./FootprintMockGalleryPage.css";

const PATH_TO_CATEGORY = {
  "vscode-copilot": "vscode",
  "chatgpt-desktop": "chatgpt",
  "saas-embedded": "saas",
  "coding-agent": "coding",
  "claude-desktop": "claude-desktop",
};

/**
 * @param {{ category?: string }} [props] — optional override; else from :shellSlug
 */
export default function FootprintLiveShellPage({ category: categoryProp } = {}) {
  const { shellSlug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useFootprintTheme();
  const category = categoryProp || PATH_TO_CATEGORY[shellSlug] || "vscode";

  // Variant comes from the ?v= query first so switching variants within a
  // category (which reuses one route) actually changes the URL and re-renders —
  // without it only the first variant in a group ever showed (same-route
  // navigation is a React Router no-op). Fall back to the persisted pick, then
  // the category's first variant.
  const variant = useMemo(() => {
    const fromQuery = searchParams.get("v");
    if (MOCK_CATALOG[category]?.variants?.some((v) => v.id === fromQuery)) return fromQuery;
    const sel = readMockSelection();
    const id = sel[category];
    const known = MOCK_CATALOG[category]?.variants?.some((v) => v.id === id);
    return known ? id : MOCK_CATALOG[category]?.variants?.[0]?.id;
  }, [category, searchParams]);

  return (
    <div className="afm-live-shell" data-testid={`footprint-live-${category}`} data-theme={theme}>
      <div className="afm-shell-controls">
        <FootprintSkinPicker
          category={category}
          variant={variant}
          className="afm-skin-picker"
        />
        <FootprintThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
      <FootprintChrome
        category={category}
        variant={variant}
        onExit={() => navigate("/demo/footprint-picks")}
      >
        <PrivilegeShellPanel skin={category === "claude-desktop" ? "claude-desktop" : category} />
      </FootprintChrome>
    </div>
  );
}
