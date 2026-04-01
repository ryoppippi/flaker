import type { TestCaseResult } from "../adapters/types.js";
import type {
  RunnerAdapter,
  RunnerCapabilities,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import { escapeRegex, runCommand } from "./utils.js";
import type { CommandResult } from "./utils.js";

export type ExecFn = (
  cmd: string,
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

interface VitestAssertionResult {
  fullName: string;
  status: "passed" | "failed";
  duration: number;
  failureMessages?: string[];
}

interface VitestTestResult {
  name: string;
  assertionResults: VitestAssertionResult[];
}

interface VitestJsonOutput {
  testResults: VitestTestResult[];
}

export function parseVitestJson(stdout: string): TestCaseResult[] {
  const data: VitestJsonOutput = JSON.parse(stdout);
  const results: TestCaseResult[] = [];
  for (const file of data.testResults) {
    for (const assertion of file.assertionResults) {
      const parts = assertion.fullName.split(" > ");
      const testName = parts.pop() ?? assertion.fullName;
      const suite = parts.join(" > ") || file.name;
      results.push({
        suite,
        testName,
        status: assertion.status === "passed" ? "passed" : "failed",
        durationMs: assertion.duration,
        retryCount: 0,
        errorMessage: assertion.failureMessages?.length
          ? assertion.failureMessages.join("\n")
          : undefined,
      });
    }
  }
  return results;
}

export function parseVitestList(stdout: string): TestId[] {
  // vitest --list --reporter json outputs an array of file paths
  // We return them as TestIds with the file as suite
  const files: string[] = JSON.parse(stdout);
  return files.map((f) => ({ suite: f, testName: f }));
}

export class VitestRunner implements RunnerAdapter {
  name = "vitest";
  capabilities: RunnerCapabilities = { nativeParallel: true };
  private baseCommand: string;
  private execFn: ExecFn;

  constructor(opts?: { command?: string; exec?: ExecFn }) {
    this.baseCommand = opts?.command ?? "pnpm vitest";
    this.execFn = opts?.exec ?? runCommand;
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const pattern = tests.map((t) => escapeRegex(t.testName)).join("|");
    const workerArgs = opts?.workers
      ? ` --pool=threads --poolOptions.threads.maxThreads=${opts.workers}`
      : "";
    const cmd = `${this.baseCommand} run -t "${pattern}" --reporter json${workerArgs}`;
    const start = Date.now();
    const { exitCode, stdout, stderr } = this.execFn(cmd, opts);
    const durationMs = Date.now() - start;

    let results: TestCaseResult[] = [];
    try {
      results = parseVitestJson(stdout);
    } catch {
      // parse failure — return empty results
    }
    return { exitCode, results, durationMs, stdout, stderr };
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const cmd = `${this.baseCommand} --list --reporter json`;
    const { stdout } = this.execFn(cmd, opts);
    return parseVitestList(stdout);
  }
}
