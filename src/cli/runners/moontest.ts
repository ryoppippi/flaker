import type { TestCaseResult } from "../adapters/types.js";
import type {
  RunnerAdapter,
  RunnerCapabilities,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import { runCommand } from "./utils.js";
import type { CommandResult } from "./utils.js";

export type ExecFn = (
  cmd: string,
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

export function parseMoonTestOutput(stdout: string): TestCaseResult[] {
  const results: TestCaseResult[] = [];
  const regex = /^test\s+(\S+)\s+\.\.\.\s+(ok|FAILED)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stdout)) !== null) {
    const fullName = match[1];
    const status = match[2] === "ok" ? "passed" : "failed";
    // Split "pkg/module/test_name" into suite and testName
    const lastSlash = fullName.lastIndexOf("/");
    const suite = lastSlash >= 0 ? fullName.substring(0, lastSlash) : "";
    const testName = lastSlash >= 0 ? fullName.substring(lastSlash + 1) : fullName;
    results.push({
      suite,
      testName,
      status,
      durationMs: 0,
      retryCount: 0,
    });
  }
  return results;
}

export function parseMoonTestList(stdout: string): TestId[] {
  const ids: TestId[] = [];
  const regex = /^test\s+(\S+)/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stdout)) !== null) {
    const fullName = match[1];
    const lastSlash = fullName.lastIndexOf("/");
    const suite = lastSlash >= 0 ? fullName.substring(0, lastSlash) : "";
    const testName = lastSlash >= 0 ? fullName.substring(lastSlash + 1) : fullName;
    ids.push({ suite, testName });
  }
  return ids;
}

export class MoonTestRunner implements RunnerAdapter {
  name = "moontest";
  capabilities: RunnerCapabilities = { nativeParallel: false, maxBatchSize: 50 };
  private baseCommand: string;
  private execFn: ExecFn;

  constructor(opts?: { command?: string; exec?: ExecFn }) {
    this.baseCommand = opts?.command ?? "moon test";
    this.execFn = opts?.exec ?? runCommand;
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const filters = tests.map((t) => `${t.suite}::${t.testName}`);
    const cmd = `${this.baseCommand} --filter "${filters.join("|")}"`;
    const start = Date.now();
    const { exitCode, stdout, stderr } = this.execFn(cmd, opts);
    const durationMs = Date.now() - start;

    const results = parseMoonTestOutput(stdout);
    return { exitCode, results, durationMs, stdout, stderr };
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const cmd = `${this.baseCommand} --dry-run`;
    const { stdout } = this.execFn(cmd, opts);
    return parseMoonTestList(stdout);
  }
}
