/**
 * Minimal `{{key}}` template rendering. Non-string values are JSON-serialized
 * (pretty-printed) before substitution, matching the Python prototype.
 */
export function renderTemplate(text: string, values: Record<string, unknown>): string {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    const replacement = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    out = out.split(`{{${key}}}`).join(replacement);
  }
  return out;
}
