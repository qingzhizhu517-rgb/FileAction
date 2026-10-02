const SECRET_KEY = /(?:api[-_]?key|access[-_]?token|secret|password|authorization)/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : sanitize(child),
    ]));
  }
  return value;
}

export function createLogger(sink = line => process.stdout.write(`${line}\n`)) {
  function write(level, event) {
    const safeEvent = sanitize(event && typeof event === 'object' ? event : { message: String(event) });
    sink(JSON.stringify({ time: new Date().toISOString(), level, ...safeEvent }));
  }
  return {
    info: event => write('info', event),
    error: event => write('error', event),
  };
}
