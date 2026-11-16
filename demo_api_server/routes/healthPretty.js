'use strict';

/**
 * Pretty HTML rendering for health endpoints.
 *
 * When a health endpoint's JSON is opened directly in a browser (Accept
 * prefers text/html), render it as a styled page with syntax-highlighted
 * JSON and a Formatted/Raw toggle instead of a wall of unstyled text.
 * API callers (curl, monitoring, fetch) send Accept: any / application/json
 * and get the plain JSON response unchanged.
 */

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Minimal JSON syntax highlighter over JSON.stringify(obj, null, 2).
function highlightJson(json) {
  return escapeHtml(json).replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'num';
      if (match.startsWith('"')) cls = match.endsWith(':') ? 'key' : 'str';
      else if (match === 'true' || match === 'false') cls = 'bool';
      else if (match === 'null') cls = 'null';
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

function renderHealthPage(title, jsonText) {
  const ok = /"status"\s*:\s*"healthy"|"status"\s*:\s*"(ok|alive|ready)"|"ok"\s*:\s*true|"ready"\s*:\s*true/.test(jsonText);
  const degraded = /"status"\s*:\s*"degraded"|"unhealthy"|"(ok|ready)"\s*:\s*false/.test(jsonText);
  const dot = degraded ? '#f59e0b' : ok ? '#10b981' : '#6b7280';
  const label = degraded ? 'DEGRADED' : ok ? 'HEALTHY' : 'STATUS';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d1117; color: #c9d1d9; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  header { display: flex; align-items: center; gap: 14px; padding: 14px 20px; border-bottom: 1px solid #21262d; background: #161b22; position: sticky; top: 0; }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; color: #e6edf3; flex: 1; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: ${dot}; box-shadow: 0 0 8px ${dot}; }
  .badge { font-size: 11px; font-weight: 700; letter-spacing: .08em; color: ${dot}; border: 1px solid ${dot}; border-radius: 4px; padding: 2px 8px; }
  .toggle { display: inline-flex; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
  .toggle button { background: transparent; color: #8b949e; border: 0; padding: 6px 14px; font: inherit; font-size: 12px; cursor: pointer; }
  .toggle button.active { background: #21262d; color: #e6edf3; }
  main { padding: 20px; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55; }
  .raw { color: #c9d1d9; }
  .key { color: #79c0ff; }
  .str { color: #a5d6ff; }
  .num { color: #f2cc60; }
  .bool { color: #ff7b72; }
  .null { color: #ff7b72; }
  footer { padding: 10px 20px; color: #484f58; font-size: 11px; border-top: 1px solid #21262d; }
</style>
</head>
<body>
<header>
  <span class="dot" title="${label}"></span>
  <h1>${escapeHtml(title)}</h1>
  <span class="badge">${label}</span>
  <span class="toggle" role="group" aria-label="Display mode">
    <button id="btn-pretty" class="active" type="button">Formatted</button>
    <button id="btn-raw" type="button">Raw</button>
  </span>
</header>
<main>
  <pre id="pretty">${highlightJson(jsonText)}</pre>
  <pre id="raw" class="raw" hidden>${escapeHtml(jsonText)}</pre>
</main>
<footer>GET ${escapeHtml(title)} &middot; JSON highlighted for readability &middot; API clients still receive plain JSON</footer>
<script>
  var pretty = document.getElementById('pretty');
  var raw = document.getElementById('raw');
  var bp = document.getElementById('btn-pretty');
  var br = document.getElementById('btn-raw');
  function show(isPretty) {
    pretty.hidden = !isPretty;
    raw.hidden = isPretty;
    bp.classList.toggle('active', isPretty);
    br.classList.toggle('active', !isPretty);
  }
  bp.addEventListener('click', function () { show(true); });
  br.addEventListener('click', function () { show(false); });
</script>
</body>
</html>`;
}

/**
 * Express middleware: intercepts res.json on health routes. Browser
 * navigations (Accept prefers text/html) get the styled page; every other
 * caller gets plain JSON exactly as before.
 */
function prettyHealthJson(routeName) {
  return (req, res, next) => {
    const accept = req.headers.accept || '';
    const htmlIdx = accept.indexOf('text/html');
    const jsonIdx = accept.indexOf('application/json');
    const isBrowserNav =
      htmlIdx !== -1 &&
      !req.xhr &&
      !(req.headers['sec-fetch-dest'] && !/^empty$|^document$/.test(req.headers['sec-fetch-dest'])) &&
      (jsonIdx === -1 || htmlIdx < jsonIdx);

    if (!isBrowserNav) return next();

    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (res.headersSent) return origJson(body);
      let jsonText;
      try {
        jsonText = JSON.stringify(body, null, 2);
      } catch {
        return origJson(body);
      }
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'no-store');
      res.status(res.statusCode).send(renderHealthPage(routeName, jsonText));
      return res;
    };
    next();
  };
}

module.exports = { prettyHealthJson };
