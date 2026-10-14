import { resolve } from "node:path";
import { WorkflowError } from "./errors.js";

/** Resolve `candidate` and assert it stays inside `root`. */
export function resolveInside(root: string, candidate: string): string {
  const r = resolve(root);
  const c = resolve(candidate);
  if (!isRelativeTo(c, r)) {
    throw new WorkflowError(`path escapes allowed root: ${c}`);
  }
  return c;
}

export function isRelativeTo(path: string, root: string): boolean {
  const rel = resolve(root);
  const target = resolve(path);
  return target === rel || target.startsWith(rel.endsWith("/") ? rel : rel + "/") || target.startsWith(rel + "\\");
}
