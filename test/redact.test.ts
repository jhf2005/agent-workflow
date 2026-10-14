import { describe, it, expect } from "vitest";
import { redact } from "@workspace/core";

describe("redact", () => {
  it("masks secrets while preserving unrelated fields", () => {
    const value = redact({
      api_key: "abc",
      nested: { token: "xyz" },
      color_tokens: { accent: "#C9472D" },
      message: "Authorization: Bearer secret-value",
    }) as Record<string, unknown>;

    expect(value.api_key).toBe("***");
    expect((value.nested as Record<string, unknown>).token).toBe("***");
    expect(value.color_tokens).toEqual({ accent: "#C9472D" });
    expect(value.message).not.toContain("secret-value");
  });
});
