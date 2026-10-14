import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { createMinimalPptx, validatePptx, ValidationError } from "@workspace/core";

describe("pptx", () => {
  it("creates and validates a minimal presentation", () => {
    const folder = mkdtempSync(join(tmpdir(), "ppt-"));
    try {
      const path = join(folder, "slides.pptx");
      createMinimalPptx(path, 4);
      expect(validatePptx(path, 4).slides).toBe(4);
      expect(() => validatePptx(path, 5)).toThrow(ValidationError);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
