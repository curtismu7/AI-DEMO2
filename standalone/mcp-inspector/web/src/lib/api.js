// Tiny fetch wrapper — same origin as the server in production, proxied
// through Vite's dev server (see vite.config.js) in development.
async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // No JSON body (e.g. 204).
  }
  if (!res.ok && !(data && typeof data === 'object')) {
    throw new Error(`${method} ${path} failed (${res.status})`);
  }
  return { ok: res.ok, status: res.status, data };
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  del: (path) => request('DELETE', path),
};
