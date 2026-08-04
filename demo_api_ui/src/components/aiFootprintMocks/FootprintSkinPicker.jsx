// demo_api_ui/src/components/aiFootprintMocks/FootprintSkinPicker.jsx
// Costume switcher shared by the Privilege MCP client page and the live shells,
// so a skin can be changed from inside a costume without backing out first.
import { useNavigate } from "react-router-dom";
import { MOCK_CATALOG, writeMockSelection } from "./mockSelection";

const CLIENT_ROUTE = "/privilege-mcp-client";

/**
 * @param {{
 *   category?: string,   // costume currently shown, if any
 *   variant?: string,    // variant currently shown, if any
 *   className?: string,  // host-specific wrapper class
 *   label?: string,
 * }} props
 */
export function FootprintSkinPicker({
  category,
  variant,
  className = "afm-skin-picker",
  label = "Skin",
}) {
  const navigate = useNavigate();
  const value = category && variant ? `${category}:${variant}` : "";

  const onChange = (e) => {
    const next = e.target.value;
    if (!next) {
      navigate(CLIENT_ROUTE);
      return;
    }
    const [nextCategory, nextVariant] = next.split(":");
    if (!nextCategory || !nextVariant) return;
    writeMockSelection(nextCategory, nextVariant);
    navigate(MOCK_CATALOG[nextCategory].route);
  };

  return (
    <label className={className}>
      <span>{label}</span>
      <select value={value} onChange={onChange} title="Switch costume shell">
        <option value="">Cursor IDE (client page)</option>
        {Object.entries(MOCK_CATALOG).map(([cat, meta]) => (
          <optgroup key={cat} label={meta.label}>
            {meta.variants.map((v) => (
              <option key={v.id} value={`${cat}:${v.id}`}>
                {v.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
