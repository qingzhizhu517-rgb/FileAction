const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 8788,
  dataDir: 'var',
  timeoutMs: 30000,
});

function parseInteger(value, name, { min, max, defaultValue }) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${name}: expected an integer from ${min} to ${max}`);
  }
  return parsed;
}

function optionalString(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

export function loadConfig(env = process.env) {
  const baseUrl = optionalString(env.LLM_BASE_URL);
  const apiKey = optionalString(env.LLM_API_KEY);
  const model = optionalString(env.LLM_MODEL);
  return {
    host: DEFAULTS.host,
    port: parseInteger(env.PORT, 'PORT', { min: 1, max: 65535, defaultValue: DEFAULTS.port }),
    dataDir: optionalString(env.DATA_DIR) ?? DEFAULTS.dataDir,
    llm: {
      configured: Boolean(baseUrl && apiKey && model),
      baseUrl,
      apiKey,
      model,
      timeoutMs: parseInteger(env.LLM_TIMEOUT_MS, 'LLM_TIMEOUT_MS', {
        min: 1,
        max: 2147483647,
        defaultValue: DEFAULTS.timeoutMs,
      }),
    },
  };
}
