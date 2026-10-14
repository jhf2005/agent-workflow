const SECRET_KEY_RE =
  /^(api[_-]?key|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|password|authorization|cookie)$/i;

/**
 * Recursively redact secret values before they are persisted or logged.
 *
 * Keys that exactly match a known secret name are masked; string values are
 * additionally scanned for bearer tokens and `key=value` / `key: value`
 * assignments. The matching is deliberately conservative so that unrelated
 * fields (e.g. `color_tokens`) are left untouched.
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_RE.test(key) ? "***" : redact(item);
    }
    return out;
  }
  if (typeof value === "string") {
    let s = value;
    s = s.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***");
    s = s.replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)\S+/gi, "$1***");
    return s;
  }
  return value;
}
