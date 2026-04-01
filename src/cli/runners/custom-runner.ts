import type {
  RunnerAdapter,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import { runCommand, runCommandWithStdin } from "./utils.js";
import type { CommandResult } from "./utils.js";

export type ExecFn = (
  cmd: string,
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

export type ExecWithStdinFn = (
  cmd: string,
  stdin: string,
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

export class CustomRunner implements RunnerAdapter {
  name = "custom";
  private executeCmd: string;
  private listCmd: string;
  private execFn: ExecFn;
  private execWithStdinFn: ExecWithStdinFn;

  constructor(opts: {
    execute: string;
    list: string;
    exec?: ExecFn;
    execWithStdin?: ExecWithStdinFn;
  }) {
    this.executeCmd = opts.execute;
    this.listCmd = opts.list;
    this.execFn = opts.exec ?? runCommand;
    this.execWithStdinFn = opts.execWithStdin ?? runCommandWithStdin;
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const input = JSON.stringify({ tests, opts });
    const { stdout, stderr, exitCode } = this.execWithStdinFn(
      this.executeCmd,
      input,
      opts,
    );
    return JSON.parse(stdout) as ExecuteResult;
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const { stdout } = this.execFn(this.listCmd, opts);
    return JSON.parse(stdout) as TestId[];
  }
}
