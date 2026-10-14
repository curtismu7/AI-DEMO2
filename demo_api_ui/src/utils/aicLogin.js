// aic_login_enabled arrives from /api/admin/config as a string; one parse for every reader.
export function isAicLoginEnabled(cfg) {
  return String(cfg?.aic_login_enabled).toLowerCase() === 'true';
}
