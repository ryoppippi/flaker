import { spawnSync } from "node:child_process";

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command safely using spawnSync with argument array.
 * Avoids shell interpretation of metacharacters.
 */
export function runCommandSafe(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
): CommandResult {
  const result = spawnSync(cmd, args, {
    encoding: "utf-8",
    cwd: opts?.cwd,
    timeout: opts?.timeout,
    env: opts?.env ? { ...process.env, ...opts.env } : undefined,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Run a command safely with stdin, using spawnSync with argument array.
 */
export function runCommandSafeWithStdin(
  cmd: string,
  args: string[],
  stdin: string,
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
): CommandResult {
  const result = spawnSync(cmd, args, {
    encoding: "utf-8",
    input: stdin,
    cwd: opts?.cwd,
    timeout: opts?.timeout,
    env: opts?.env ? { ...process.env, ...opts.env } : undefined,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
