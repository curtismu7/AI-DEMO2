const SECRET_KEY = /(authorization|cookie|token|secret|password|api[-_]?key|client[-_]?secret)/i;
const SECRET_ARG = /(--?(?:api[-_]?key|token|secret|password|client[-_]?secret))=([^\s]+)/gi;

function redactUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) url.searchParams.delete(key);
    }
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}

function redactCommand(value) {
  return typeof value === 'string' ? value.replace(SECRET_ARG, '$1=[REDACTED]') : value;
}

export function redactRecord(record = {}) {
  const output = structuredClone(record);
  if (output.endpoint) output.endpoint = redactUrl(output.endpoint);
  if (output.process?.command) output.process.command = redactCommand(output.process.command);
  delete output.headers;
  delete output.environment;
  return output;
}
