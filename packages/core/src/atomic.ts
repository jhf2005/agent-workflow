import { mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Write a file atomically: write to a sibling temp file, then rename over the
 * target so a crash never leaves a half-written file behind. Synchronous so
 * state persistence completes before control returns (matching the Python
 * prototype's `os.replace` semantics).
 */
export function atomicWriteText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, path);
  } finally {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // temp file already gone; nothing to clean up
    }
  }
}

export function atomicWriteJson(path: string, value: unknown): void {
  atomicWriteText(path, JSON.stringify(value, null, 2) + "\n");
}
