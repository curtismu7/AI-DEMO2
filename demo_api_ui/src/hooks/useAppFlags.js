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
