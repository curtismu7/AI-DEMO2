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
      {/* Everything in this row is OURS. None of it exists in the product being
          simulated, so none of it belongs inside the costume's title bar —
          which is where the badge and Exit used to live, in five duplicated
          copies. Keeping the honesty badge here rather than dropping it means
          the shell still says plainly what it is, one line above the window
          instead of painted into VS Code's chrome. */}
      <div className="afm-shell-controls">
        <span className="afm-badge afm-badge--pill afm-shell-controls__label">
          Simulated shell &middot; Ping Privilege MCP client
        </span>
        <FootprintSkinPicker
          category={category}
          variant={variant}
          className="afm-skin-picker"
        />
        <FootprintThemeToggle theme={theme} onToggle={toggleTheme} />
        <button
          type="button"
          className="afm-badge afm-badge--pill"
          onClick={() => navigate("/demo/footprint-picks")}
        >
          Exit
        </button>
      </div>
      <FootprintChrome category={category} variant={variant}>
        <PrivilegeShellPanel skin={category === "claude-desktop" ? "claude-desktop" : category} />
      </FootprintChrome>
    </div>
  );
}
