import type {
  RunnerAdapter,
  RunnerCapabilities,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import { runCommandSafe, runCommandSafeWithStdin } from "./utils.js";
import type { CommandResult } from "./utils.js";

export type SafeExecFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

export type SafeExecWithStdinFn = (
  cmd: string,
  args: string[],
  stdin: string,
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

function parseCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.split(/\s+/).filter(Boolean);
  return { cmd: parts[0], args: parts.slice(1) };
}

export class CustomRunner implements RunnerAdapter {
  name = "custom";
  capabilities: RunnerCapabilities;
  private executeCmd: string;
  private listCmd: string;
  private safeExecFn: SafeExecFn;
  private safeExecWithStdinFn: SafeExecWithStdinFn;

  constructor(opts: {
    execute: string;
    list: string;
    capabilities?: RunnerCapabilities;
    safeExec?: SafeExecFn;
    safeExecWithStdin?: SafeExecWithStdinFn;
    /** @deprecated Use safeExec */
    exec?: (cmd: string, opts?: Record<string, unknown>) => CommandResult;
    /** @deprecated Use safeExecWithStdin */
    execWithStdin?: (cmd: string, stdin: string, opts?: Record<string, unknown>) => CommandResult;
  }) {
    this.capabilities = opts.capabilities ?? { nativeParallel: false };
    this.executeCmd = opts.execute;
    this.listCmd = opts.list;
    if (opts.safeExec) {
      this.safeExecFn = opts.safeExec;
    } else if (opts.exec) {
      this.safeExecFn = (cmd, args, o) => opts.exec!(`${cmd} ${args.join(" ")}`, o);
    } else {
      this.safeExecFn = runCommandSafe;
    }
    if (opts.safeExecWithStdin) {
      this.safeExecWithStdinFn = opts.safeExecWithStdin;
    } else if (opts.execWithStdin) {
      this.safeExecWithStdinFn = (cmd, args, stdin, o) => opts.execWithStdin!(`${cmd} ${args.join(" ")}`, stdin, o);
    } else {
      this.safeExecWithStdinFn = runCommandSafeWithStdin;
    }
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const input = JSON.stringify({ tests, opts });
    const { cmd, args } = parseCommand(this.executeCmd);
    const { stdout } = this.safeExecWithStdinFn(cmd, args, input, opts);
    return JSON.parse(stdout) as ExecuteResult;
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const { cmd, args } = parseCommand(this.listCmd);
    const { stdout } = this.safeExecFn(cmd, args, opts);
    return JSON.parse(stdout) as TestId[];
  }
}
