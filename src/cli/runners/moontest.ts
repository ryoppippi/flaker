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

export function parseMoonTestOutput(stdout: string): TestCaseResult[] {
  const results: TestCaseResult[] = [];

  // Verbose format: [package] test file:line ("name") ok|FAILED
  const verboseRegex = /^\[([^\]]+)\]\s+test\s+(\S+:\d+)\s+\("([^"]+)"\)\s+(ok|FAILED)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = verboseRegex.exec(stdout)) !== null) {
    const pkg = match[1];
    const fileLine = match[2];
    const testName = match[3];
    const status = match[4] === "ok" ? "passed" : "failed";
    results.push({ suite: `${pkg}/${fileLine}`, testName, status, durationMs: 0, retryCount: 0 });
  }

  if (results.length > 0) return results;

  // Non-verbose format: test <name> ... ok|FAILED
  const regex = /^test\s+(\S+)\s+\.\.\.\s+(ok|FAILED)\s*$/gm;
  while ((match = regex.exec(stdout)) !== null) {
    const fullName = match[1];
    const status = match[2] === "ok" ? "passed" : "failed";
    const lastSlash = fullName.lastIndexOf("/");
    const suite = lastSlash >= 0 ? fullName.substring(0, lastSlash) : "";
    const testName = lastSlash >= 0 ? fullName.substring(lastSlash + 1) : fullName;
    results.push({ suite, testName, status, durationMs: 0, retryCount: 0 });
  }
  return results;
}

export function parseMoonTestList(stdout: string): TestId[] {
  const ids: TestId[] = [];

  // Verbose format: [package] test file:line ("name") ok|FAILED
  const verboseRegex = /^\[([^\]]+)\]\s+test\s+(\S+:\d+)\s+\("([^"]+)"\)\s+(ok|FAILED)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = verboseRegex.exec(stdout)) !== null) {
    const pkg = match[1];
    const fileLine = match[2];
    const testName = match[3];
    ids.push({ suite: `${pkg}/${fileLine}`, testName });
  }

  if (ids.length > 0) return ids;

  // Non-verbose format: test <name>
  const regex = /^test\s+(\S+)/gm;
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
  private safeExecFn: SafeExecFn;

  constructor(opts?: { command?: string; exec?: LegacyExecFn; safeExec?: SafeExecFn }) {
    this.baseCommand = opts?.command ?? "moon test";
    this.safeExecFn = opts?.safeExec ?? (opts?.exec ? wrapLegacyExec(opts.exec) : runCommandSafe);
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const filters = tests.map((t) => `${t.suite}::${t.testName}`);
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const runArgs = [...args, "--filter", filters.join("|")];
    const start = Date.now();
    const { exitCode, stdout, stderr } = this.safeExecFn(cmd, runArgs, opts);
    const durationMs = Date.now() - start;
    return { exitCode, results: parseMoonTestOutput(stdout), durationMs, stdout, stderr };
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    // Try --dry-run first; if it yields no tests, fall back to actual execution
    const { stdout: dryStdout } = this.safeExecFn(cmd, [...args, "--dry-run"], opts);
    const dryList = parseMoonTestList(dryStdout);
    if (dryList.length > 0) return dryList;

    // Fallback: run tests and parse output (moon test -v doesn't support --dry-run well on JS target)
    const { stdout } = this.safeExecFn(cmd, args, opts);
    return parseMoonTestList(stdout);
  }
}
