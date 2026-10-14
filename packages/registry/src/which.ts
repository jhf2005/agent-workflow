import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

const PATHEXT = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);

/**
 * Resolve a command name to an absolute path, mirroring the shell's PATH lookup.
 * Windows-first: also tries each `PATHEXT` extension so `claude` matches
 * `claude.exe`. Returns `undefined` when the command is not found.
 */
export function whichCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!command) return undefined;
  if (command.includes("/") || command.includes("\\") || isAbsolute(command)) {
    const resolved = resolve(command);
    return existsSync(resolved) ? resolved : undefined;
  }
  const pathEntries = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathEntries) {
    const base = join(dir, command);
    if (existsSync(base)) return base;
    for (const ext of PATHEXT) {
      const candidate = base + ext.toLowerCase();
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
