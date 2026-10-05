// Light/dark for the AI-footprint costume pages (gallery, locked picks, live shell).
// It is the app's own theme, not a separate setting: the top-menu moon, the shells'
// Light/Dark pill and a reload all read and write the same ThemeContext, so the
// costumes can never disagree with the nav above them. `useThemeOptional` keeps
// these pages renderable without a provider (always light, toggle inert).
import { useThemeOptional } from "../context/ThemeContext";

export function useFootprintTheme() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  return [darkMode ? "dark" : "light", toggleDarkMode];
}
