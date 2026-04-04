import type { TestCaseResult } from "../adapters/types.js";
import type {
  RunnerAdapter,
  RunnerCapabilities,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import {
  runCommandSafe,
  parseBaseCommand,
  wrapLegacyExec,
  type SafeExecFn,
  type LegacyExecFn,
} from "./utils.js";

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
        durationMs: assertion.duration ?? 0,
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
  const files: string[] = JSON.parse(stdout);
  return files.map((f) => ({ suite: f, testName: f }));
}

export class VitestRunner implements RunnerAdapter {
  name = "vitest";
  capabilities: RunnerCapabilities = { nativeParallel: true };
  private baseCommand: string;
  private safeExecFn: SafeExecFn;

  constructor(opts?: { command?: string; exec?: LegacyExecFn; safeExec?: SafeExecFn }) {
    this.baseCommand = opts?.command ?? "pnpm vitest";
    this.safeExecFn = opts?.safeExec ?? (opts?.exec ? wrapLegacyExec(opts.exec) : runCommandSafe);
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const suiteFiles = [...new Set(tests.map((t) => t.suite))];
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const runArgs = [...args, "run", ...suiteFiles, "--reporter", "json"];
    if (opts?.workers) {
      runArgs.push("--pool=threads", `--poolOptions.threads.maxThreads=${opts.workers}`);
    }
    const start = Date.now();
    const { exitCode, stdout, stderr } = this.safeExecFn(cmd, runArgs, opts);
    const durationMs = Date.now() - start;

    let results: TestCaseResult[] = [];
    try {
      const all = parseVitestJson(stdout);
      const selectedNames = new Set(tests.map((t) => t.testName));
      results = all.filter((r) => selectedNames.has(r.testName));
    } catch {
      // parse failure — return empty results
    }
    return { exitCode, results, durationMs, stdout, stderr };
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const { stdout } = this.safeExecFn(cmd, [...args, "--list", "--reporter", "json"], opts);
    return parseVitestList(stdout);
  }
}
