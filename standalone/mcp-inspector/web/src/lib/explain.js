// Turns the raw failure text the server relays into a sentence that says what to
// check. The original text stays in parentheses so nothing is hidden.
export function explainFailure(raw, { subject = 'the server' } = {}) {
  const text = String(raw || '').trim();
  if (!text) return `Could not load from ${subject}.`;
  const lower = text.toLowerCase();
  let hint;
  if (/econnrefused|enotfound|fetch failed|network|socket hang up|eai_again/.test(lower)) {
    hint = `Could not reach ${subject} — is it running, and is the URL right?`;
  } else if (/timed out|timeout|etimedout/.test(lower)) {
    hint = `${subject[0].toUpperCase()}${subject.slice(1)} took too long to answer — try Refresh.`;
  } else if (/\b401\b|unauthori[sz]ed|invalid authentication/.test(lower)) {
    hint = `${subject[0].toUpperCase()}${subject.slice(1)} rejected the credentials — check this server's auth header.`;
  } else if (/\b403\b|forbidden/.test(lower)) {
    hint = `You are signed in but not allowed to use ${subject}.`;
  } else if (/\b404\b|not found/.test(lower)) {
    hint = `${subject[0].toUpperCase()}${subject.slice(1)} answered "not found" — check the URL path.`;
  } else {
    return text;
  }
  return `${hint} (${text})`;
}
