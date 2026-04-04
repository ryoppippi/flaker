import type { TestCaseResult } from "../adapters/types.js";
import { playwrightAdapter } from "../adapters/playwright.js";
import type {
  RunnerAdapter,
  RunnerCapabilities,
  TestId,
  ExecuteOpts,
  ExecuteResult,
} from "./types.js";
import { escapeRegex, runCommandSafe } from "./utils.js";
import type { CommandResult } from "./utils.js";

export type ExecFn = (
  cmd: string,
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

export type SafeExecFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
) => CommandResult;

interface PlaywrightListSpec {
  title: string;
  file: string;
}

interface PlaywrightListSuite {
  title: string;
  file?: string;
  suites?: PlaywrightListSuite[];
  specs?: PlaywrightListSpec[];
}

interface PlaywrightListOutput {
  suites: PlaywrightListSuite[];
}

function collectSpecs(
  suite: PlaywrightListSuite,
  currentFile: string | null,
  currentTaskId: string | null,
  out: TestId[],
): void {
  const nextFile = suite.file ?? currentFile ?? suite.title;
  const nextTaskId = currentTaskId ?? suite.title;
  if (suite.specs) {
    for (const spec of suite.specs) {
      out.push({
        suite: spec.file ?? nextFile,
        testName: spec.title,
        taskId: nextTaskId,
      });
    }
  }
  if (suite.suites) {
    for (const child of suite.suites) {
      collectSpecs(child, nextFile, child.title, out);
    }
  }
}

export function parsePlaywrightList(stdout: string): TestId[] {
  const data: PlaywrightListOutput = JSON.parse(stdout);
  const ids: TestId[] = [];
  for (const suite of data.suites) {
    collectSpecs(suite, suite.file ?? null, suite.title, ids);
  }
  return ids;
}

/** Parse a command string like "pnpm exec playwright test" into [cmd, ...args] */
function parseBaseCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.split(/\s+/).filter(Boolean);
  return { cmd: parts[0], args: parts.slice(1) };
}

export class PlaywrightRunner implements RunnerAdapter {
  name = "playwright";
  capabilities: RunnerCapabilities = { nativeParallel: true };
  private baseCommand: string;
  private safeExecFn: SafeExecFn;

  constructor(opts?: { command?: string; exec?: ExecFn; safeExec?: SafeExecFn }) {
    this.baseCommand = opts?.command ?? "pnpm exec playwright test";
    if (opts?.safeExec) {
      this.safeExecFn = opts.safeExec;
    } else if (opts?.exec) {
      this.safeExecFn = (cmd, args, o) => opts.exec!(`${cmd} ${args.join(" ")}`, o);
    } else {
      this.safeExecFn = runCommandSafe;
    }
  }

  async execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult> {
    const pattern = tests.map((t) => escapeRegex(t.testName)).join("|");
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const runArgs = [...args, "--grep", pattern, "--reporter", "json"];
    if (opts?.workers) {
      runArgs.push(`--workers=${opts.workers}`);
    }
    const start = Date.now();
    const { exitCode, stdout, stderr } = this.safeExecFn(cmd, runArgs, opts);
    const durationMs = Date.now() - start;

    let results: TestCaseResult[] = [];
    try {
      results = playwrightAdapter.parse(stdout);
    } catch {
      // parse failure — return empty results
    }
    return { exitCode, results, durationMs, stdout, stderr };
  }

  async listTests(opts?: ExecuteOpts): Promise<TestId[]> {
    const { cmd, args } = parseBaseCommand(this.baseCommand);
    const { stdout } = this.safeExecFn(cmd, [...args, "--list", "--reporter", "json"], opts);
    return parsePlaywrightList(stdout);
  }
}
