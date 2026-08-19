// demo_api_ui/src/components/aiFootprintMocks/FootprintSkinPicker.jsx
// Costume switcher shared by the Privilege MCP client page and the live shells,
// so a skin can be changed from inside a costume without backing out first.
import { useNavigate } from "react-router-dom";
import { PRIVILEGE_CLIENT_SKINS, writeMockSelection } from "./mockSelection";

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
    const skin = PRIVILEGE_CLIENT_SKINS.find((item) => item.id === next);
    if (!skin) return;
    if (next) {
      const [nextCategory, nextVariant] = next.split(":");
      writeMockSelection(nextCategory, nextVariant);
    }
    navigate(skin.route);
  };

  return (
    <label className={className}>
      <span>{label}</span>
      <select value={value} onChange={onChange} title="Switch client skin">
        {PRIVILEGE_CLIENT_SKINS.map((skin) => (
          <option key={skin.id || "cursor"} value={skin.id}>
            {skin.name}
          </option>
        ))}
      </select>
    </label>
  );
}
