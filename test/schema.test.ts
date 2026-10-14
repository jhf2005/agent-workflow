import { describe, it, expect } from "vitest";
import { validateSchema, ValidationError } from "@workspace/core";

describe("validateSchema", () => {
  it("enforces required and additionalProperties", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    };

    expect(() => validateSchema({ name: "ok" }, schema)).not.toThrow();
    expect(() => validateSchema({}, schema)).toThrow(ValidationError);
    expect(() => validateSchema({ name: "ok", extra: true }, schema)).toThrow(ValidationError);
  });
});
