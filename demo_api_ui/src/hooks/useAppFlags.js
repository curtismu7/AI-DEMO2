import { useEffect, useState, useCallback } from "react";
import { loadPublicConfig } from "../services/configService";

// Event dispatched by useAuth.js after a successful /api/admin/config fetch
// + IDB write — useAppFlags listens for it so the IDB-vs-HTTP race on cold
// visits doesn't leave flags stuck at hard-coded defaults.
const PUBLIC_CONFIG_UPDATED_EVENT = "publicConfigUpdated";

function mapCfgToFlags(cfg) {
  const isAdvanced = cfg.agent_ui_mode === "advanced";
  return {
    showEducationPanel:
      cfg.show_education_panel !== false &&
      cfg.show_education_panel !== "false",
    enableTokenChainDisplay:
      isAdvanced ||
      (cfg.enable_token_chain_display !== false &&
        cfg.enable_token_chain_display !== "false"),
    agentUiMode: cfg.agent_ui_mode || "standard",
    debugShowTokenDetails:
      isAdvanced ||
      cfg.debug_show_token_details === true ||
      cfg.debug_show_token_details === "true",
    debugShowApiCalls:
      isAdvanced ||
      cfg.debug_show_api_calls === true ||
      cfg.debug_show_api_calls === "true",
    logFilterCategories: cfg.log_filter_categories || "",
    copilotMode:
      cfg.copilot_mode_enabled === true ||
      cfg.copilot_mode_enabled === "true",
    showUseCaseLauncher:
      cfg.ff_use_cases_launcher !== false &&
      cfg.ff_use_cases_launcher !== "false",
    // Spinner appearance. Values arrive as strings from configStore but as real
    // booleans/numbers straight off the config page's own save, so each is
    // normalized rather than trusted — the same string-or-boolean dance every
    // other flag above does.
    spinnerVariant: cfg.spinner_variant || "neural",
    spinnerSize: Number(cfg.spinner_size) || 88,
    spinnerAccent:
      !cfg.spinner_accent || cfg.spinner_accent === "default"
        ? ""
        : cfg.spinner_accent,
    // Off by default: the spinner overlay follows the app's light/dark theme
    // (see LoadingOverlay.css's [data-theme="dark"] rules) rather than always
    // rendering the dark card. An admin can still force it on via configStore.
    spinnerDarkCard:
      cfg.spinner_dark_card === true || cfg.spinner_dark_card === "true",
    spinnerActivityFeed:
      cfg.spinner_activity_feed !== false &&
      cfg.spinner_activity_feed !== "false",
  };
}

export function useAppFlags() {
  const [appFlags, setAppFlags] = useState({
    showEducationPanel: true,
    enableTokenChainDisplay: true,
    agentUiMode: "standard",
    debugShowTokenDetails: false,
    debugShowApiCalls: false,
    logFilterCategories: "",
    copilotMode: false,
    showUseCaseLauncher: true,
    spinnerVariant: "neural",
    spinnerSize: 88,
    spinnerAccent: "",
    spinnerDarkCard: false,
    spinnerActivityFeed: true,
  });

  const refresh = useCallback(() => {
    loadPublicConfig()
      .then((cfg) => {
        if (cfg) setAppFlags(mapCfgToFlags(cfg));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Initial IDB read on mount (may be empty on cold visit).
    refresh();
    // Re-read whenever useAuth signals it just wrote /api/admin/config to IDB.
    // Closes the race where the initial IDB read beats the HTTP+IDB write.
    const onUpdate = () => refresh();
    window.addEventListener(PUBLIC_CONFIG_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(PUBLIC_CONFIG_UPDATED_EVENT, onUpdate);
  }, [refresh]);

  return { appFlags };
}
