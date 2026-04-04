import type {
  RunnerAdapter,
  RunnerCapabilities,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import {
  runCommandSafe,
  runCommandSafeWithStdin,
  parseBaseCommand,
  wrapLegacyExec,
  type SafeExecFn,
  type SafeExecWithStdinFn,
  type LegacyExecFn,
} from "./utils.js";

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
    exec?: LegacyExecFn;
    /** @deprecated Use safeExecWithStdin */
    execWithStdin?: (cmd: string, stdin: string, opts?: Record<string, unknown>) => { exitCode: number; stdout: string; stderr: string };
  }) {
    this.capabilities = opts.capabilities ?? { nativeParallel: false };
    this.executeCmd = opts.execute;
    this.listCmd = opts.list;
    this.safeExecFn = opts.safeExec ?? (opts.exec ? wrapLegacyExec(opts.exec) : runCommandSafe);
    this.safeExecWithStdinFn = opts.safeExecWithStdin ??
      (opts.execWithStdin
        ? (cmd, args, stdin, o) => opts.execWithStdin!(`${cmd} ${args.join(" ")}`, stdin, o)
        : runCommandSafeWithStdin);
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const input = JSON.stringify({ tests, opts });
    const { cmd, args } = parseBaseCommand(this.executeCmd);
    const { stdout } = this.safeExecWithStdinFn(cmd, args, input, opts);
    return JSON.parse(stdout) as ExecuteResult;
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const { cmd, args } = parseBaseCommand(this.listCmd);
    const { stdout } = this.safeExecFn(cmd, args, opts);
    return JSON.parse(stdout) as TestId[];
  }
}
