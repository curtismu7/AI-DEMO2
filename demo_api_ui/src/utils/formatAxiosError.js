// banking_api_ui/src/utils/formatAxiosError.js
/**
 * Normalize API errors so the UI shows the server's message (not generic axios text).
 * @param {import('axios').AxiosError} err
 * @param {string} fallback
 */
export function formatAxiosError(err, fallback) {
  const d = err.response?.data;
  const msg =
    (typeof d?.message === 'string' && d.message.trim()) ||
    (typeof d?.error_description === 'string' && d.error_description.trim()) ||
    (typeof d?.error === 'string' && d.error.trim());
  if (msg) return msg;
  if (err.response?.status === 401) {
    return 'Not authorized (401). Sign out and sign in again — MCP needs a live OAuth token in your session.';
  }
  return err.message || fallback;
}
