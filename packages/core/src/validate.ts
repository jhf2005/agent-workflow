import { ValidationError } from "./errors.js";

type Check = (v: unknown) => boolean;

const TYPE_CHECKS: Record<string, Check> = {
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === "string",
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  number: (v) => typeof v === "number" && !Number.isNaN(v),
  boolean: (v) => typeof v === "boolean",
  null: (v) => v === null,
};

/**
 * Minimal JSON Schema validator covering the subset this project relies on:
 * `type`, `properties`, `required`, `additionalProperties`, and `items`.
 * Boolean values are rejected for `integer`/`number` (JS `typeof` quirk).
 */
export function validateSchema(value: unknown, schema: Record<string, unknown>, path = "$"): void {
  const expected = schema.type as string | undefined;
  if (expected !== undefined && expected in TYPE_CHECKS) {
    const check = TYPE_CHECKS[expected];
    if (expected === "integer" && typeof value === "boolean") {
      throw new ValidationError(`${path} must be integer`);
    }
    if (expected === "number" && typeof value === "boolean") {
      throw new ValidationError(`${path} must be number`);
    }
    if (!check(value)) {
      throw new ValidationError(`${path} must be ${expected}`);
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const properties = (schema.properties as Record<string, unknown>) ?? {};
    for (const key of (schema.required as string[]) ?? []) {
      if (!(key in obj)) {
        throw new ValidationError(`${path}.${key} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      const extras = Object.keys(obj)
        .filter((k) => !(k in properties))
        .sort();
      if (extras.length > 0) {
        throw new ValidationError(`${path} has unexpected properties: ${extras}`);
      }
    }
    for (const [key, item] of Object.entries(obj)) {
      if (key in properties) {
        validateSchema(item, properties[key] as Record<string, unknown>, `${path}.${key}`);
      }
    }
  }

  if (Array.isArray(value) && "items" in schema) {
    (value as unknown[]).forEach((item, i) => {
      validateSchema(item, schema.items as Record<string, unknown>, `${path}[${i}]`);
    });
  }
}
