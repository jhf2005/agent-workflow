import { describe, it, expect } from "vitest";
import { canonicalJson, sha256 } from "@workspace/core";

describe("canonical json", () => {
  it("produces order-independent hashes", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(sha256({ b: 2, a: 1 })).toBe(sha256({ a: 1, b: 2 }));
  });
});
